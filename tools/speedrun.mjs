// Speedrun: every class, solo and with a companion, played the way a player would.
//
// tools/sweep.mjs answers "is any reachable build broken". This answers a different
// question: how does the INTENDED build of each class actually feel to play -- how fast
// it clears, how often it dies, how far it gets, and what is carrying its damage. The
// point is the comparison between the solo and pet columns of the same class, because
// that choice is made once at character creation and never revisited.
//
//   node tools/speedrun.mjs [simMinutes] [runsPerCombo]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedKit } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent } from '../js/data/talents.js';
import { computeStats, computeCompanion, estimateDps } from '../js/systems/stats.js';
import { xpToNext, MOBS_PER_ZONE, MAX_LEVEL, MAX_LIVES, STALL_DEATHS, STALL_DROP, isBossZone } from '../js/data/mobs.js';

const MINUTES = Number(process.argv[2] || 90);
const RUNS = Number(process.argv[3] || 5);
const STEP = 0.1;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spend points the way the class is meant to be played: a pet build pours into its pet
 * branch first, a solo build avoids pet talents entirely (they do nothing for it).
 */
function spend(save, solo) {
  const tree = TALENTS[save.classId];
  const usable = tree.filter((t) => !(solo && isPetTalent(t)));
  const order = solo ? usable : usable.filter(isPetTalent).concat(usable);
  let points = earnedTalentPoints(save.level);
  save.talents = {};
  for (const t of order) {
    while (points > 0 && (save.talents[t.id] || 0) < t.max) {
      save.talents[t.id] = (save.talents[t.id] || 0) + 1;
      points--;
    }
    if (points <= 0) break;
  }
}

function slot(save) {
  const cls = CLASSES[save.classId];
  const keep = new Set(suggestedKit(save.classId, save.level, save.petChoice === 'solo'));
  for (const a of cls.abilities) save.abilityToggles[a.id] = keep.has(a.id);
}

function run(classId, solo, seed) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));

  const s = newSave(classId, 'Runner');
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  slot(s);
  spend(s, solo);

  let enc = new Encounter(s, () => {});
  let t = 0, kills = 0, deaths = 0, bosses = 0, streak = 0, lives = MAX_LIVES;
  let lastLevel = 1, ended = false, upgrades = 0;
  const limit = MINUTES * 60;
  // Time spent at each zone, so "where did it stall" has an answer.
  const zoneTime = {};

  while (t < limit) {
    const before = s.zone;
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message, classId, solo }; }
    t += STEP;
    zoneTime[before] = (zoneTime[before] || 0) + STEP;

    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp;
      s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }

      const drop = rollDrop(s.classId, s.zone, mob.boss, { solo: s.petChoice === 'solo' });
      if (drop) {
        const cur = s.equipped[drop.slot];
        if (!cur || itemScore(drop) > itemScore(cur)) { s.equipped[drop.slot] = drop; upgrades++; }
      }
      if (mob.boss) { bosses++; s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone; lives = Math.min(MAX_LIVES, lives + 1); }
      else {
        s.mobsKilledInZone++;
        if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
      }
      if (s.level !== lastLevel) { slot(s); spend(s, solo); lastLevel = s.level; }
      enc = new Encounter(s, () => {});
    } else if (r === 'lose') {
      deaths++;
      if (--lives <= 0) { ended = true; break; }
      streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      enc = new Encounter(s, () => {});
    }
  }

  // What is actually carrying the damage at the end of the run?
  const st = computeStats(s);
  const comp = computeCompanion(s, st);
  const total = estimateDps(s);
  const petShare = comp ? (comp.ap / comp.swingTime) / Math.max(1, total) : 0;

  const worst = Object.entries(zoneTime).sort((a, b) => b[1] - a[1])[0] || [0, 0];

  return {
    classId, solo, zone: s.zone, level: s.level, kills, deaths, bosses, ended, upgrades,
    ttk: kills > 0 ? (limit / kills) : Infinity,
    dps: total, petShare,
    crit: st.crit, haste: st.haste,
    stallZone: Number(worst[0]), stallMin: worst[1] / 60,
  };
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

console.log(`${MINUTES} simulated minutes, ${RUNS} runs per combination\n`);
console.log('class     build   zone   lvl   kills  deaths  bosses   s/kill    end dps   pet%   crit   haste');

const all = [];
for (const classId of ['warrior', 'hunter', 'priest', 'warlock']) {
  const modes = CLASSES[classId].companion ? [false, true] : [false];
  for (const solo of modes) {
    const rs = [];
    for (let i = 0; i < RUNS; i++) rs.push(run(classId, solo, 4200 + i * 131 + classId.length * 17 + (solo ? 7 : 0)));
    const bad = rs.find((r) => r.error);
    if (bad) { console.log(`  ${classId} ${solo ? 'solo' : 'pet '}  ERROR ${bad.error}`); continue; }
    const m = {
      classId, solo,
      zone: median(rs.map((r) => r.zone)), level: median(rs.map((r) => r.level)),
      kills: median(rs.map((r) => r.kills)), deaths: median(rs.map((r) => r.deaths)),
      bosses: median(rs.map((r) => r.bosses)), ttk: median(rs.map((r) => r.ttk)),
      dps: median(rs.map((r) => r.dps)), petShare: median(rs.map((r) => r.petShare)),
      crit: median(rs.map((r) => r.crit)), haste: median(rs.map((r) => r.haste)),
      ended: rs.filter((r) => r.ended).length,
    };
    all.push(m);
    console.log(
      classId.padEnd(9) +
      (CLASSES[classId].companion ? (solo ? 'solo ' : 'pet  ') : '--   ').padEnd(8) +
      String(m.zone).padStart(4) + String(m.level).padStart(6) +
      String(m.kills).padStart(8) + String(m.deaths).padStart(8) + String(m.bosses).padStart(8) +
      m.ttk.toFixed(1).padStart(9) + m.dps.toFixed(0).padStart(11) +
      (m.petShare * 100).toFixed(0).padStart(7) + (m.crit * 100).toFixed(0).padStart(7) +
      (m.haste * 100).toFixed(0).padStart(8)
    );
  }
}

// --- what the numbers say -----------------------------------------------------------
console.log('\n=== read-out ===');
const zones = all.map((m) => m.zone);
console.log(`zone spread across all eight builds: ${Math.min(...zones)} to ${Math.max(...zones)} (${(Math.max(...zones) / Math.max(1, Math.min(...zones))).toFixed(2)}x)`);

for (const classId of ['hunter', 'priest', 'warlock']) {
  const solo = all.find((m) => m.classId === classId && m.solo);
  const pet = all.find((m) => m.classId === classId && !m.solo);
  if (!solo || !pet) continue;
  const ratio = pet.zone / Math.max(1, solo.zone);
  const verdict = ratio > 1.25 ? 'PET FAVOURED' : ratio < 0.8 ? 'SOLO FAVOURED' : 'balanced';
  console.log(`${classId.padEnd(8)} solo zone ${String(solo.zone).padStart(3)} vs pet zone ${String(pet.zone).padStart(3)}  -> ${verdict} (${ratio.toFixed(2)}x), pet carries ${(pet.petShare * 100).toFixed(0)}% of its damage`);
}

const deathy = all.filter((m) => m.deaths > 12);
if (deathy.length) console.log('\nhigh death counts: ' + deathy.map((m) => `${m.classId} ${m.solo ? 'solo' : 'pet'} (${m.deaths})`).join(', '));
const ran = all.filter((m) => m.ended > 0);
if (ran.length) console.log('ran out of lives: ' + ran.map((m) => `${m.classId} ${m.solo ? 'solo' : 'pet'} (${m.ended}/${RUNS} runs)`).join(', '));
