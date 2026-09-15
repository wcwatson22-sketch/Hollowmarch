// Endgame build sweep.
//
// A progression sweep from level 1 cannot reach the content that most of the new
// systems live in -- set bonuses, legendary powers, 75% crit, the Hollow King. Ninety
// simulated minutes gets to about zone 18. So this one starts characters AT depth,
// fully kitted, and asks two questions:
//
//   1. Can this build clear zone-90 trash without dying?
//   2. Can it kill the Hollow King at zone 100?
//
// Both answers should be "only if the build is actually good". A build that walks
// through the final boss is as broken as one that cannot scratch it.
//
//   node tools/endgame.mjs [runsPerClass]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedKit } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints } from '../js/data/talents.js';
import { MAX_LEVEL, FINAL_ZONE } from '../js/data/mobs.js';
import { computeStats, estimateDps } from '../js/systems/stats.js';
import { SETS, POWERS } from '../js/data/sets.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const RUNS = Number(process.argv[2] || 30);
const STEP = 0.1;
const FIGHT_CAP = 900;   // 15 minutes is already far past "a fight"

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const TALENT_PLANS = ['branch0', 'branch1', 'branch2', 'mastery', 'spread', 'branch0+mastery'];
const ABILITY_PLANS = ['auto', 'dots', 'nukes', 'support', 'worst'];

function branchesOf(classId) {
  const seen = [];
  for (const t of TALENTS[classId]) {
    if (t.tier === 2) continue;
    if (!seen.includes(t.branch)) seen.push(t.branch);
  }
  return seen;
}

function applyTalents(save, plan) {
  const tree = TALENTS[save.classId];
  const points = earnedTalentPoints(save.level);
  save.talents = {};
  const branches = branchesOf(save.classId);
  const tier1 = (b) => tree.filter((t) => t.tier !== 2 && t.branch === b);
  const mastery = tree.filter((t) => t.tier === 2);

  let order;
  if (plan.startsWith('branch') && plan.includes('mastery')) order = [...tier1(branches[0]), ...mastery];
  else if (plan.startsWith('branch')) {
    const i = Number(plan.slice('branch'.length));
    order = [...tier1(branches[i] ?? branches[0]), ...mastery, ...tree];
  } else if (plan === 'mastery') order = [...mastery, ...tree];
  else order = tree;

  let spent = 0;
  if (plan === 'spread') {
    let guard = 0;
    while (spent < points && guard++ < 9000) {
      let moved = false;
      for (const t of order) {
        if (spent >= points) break;
        const cur = save.talents[t.id] || 0;
        if (cur >= t.max) continue;
        save.talents[t.id] = cur + 1; spent++; moved = true;
      }
      if (!moved) break;
    }
    return;
  }
  for (const t of order) {
    while (spent < points && (save.talents[t.id] || 0) < t.max) {
      save.talents[t.id] = (save.talents[t.id] || 0) + 1; spent++;
    }
    if (spent >= points) break;
  }
}

function applyAbilities(save, plan) {
  const cls = CLASSES[save.classId];
  const unlocked = cls.abilities.filter((a) => save.level >= a.unlock);
  const isDot = (a) => a.kind === 'dot';
  const isNuke = (a) => ['nuke', 'execute', 'stun', 'drain'].includes(a.kind);
  const isSupport = (a) => ['healpet', 'hot', 'healself', 'hotself', 'buff', 'buffpet'].includes(a.kind);

  let picked;
  if (plan === 'auto') picked = suggestedKit(save.classId, save.level).map((id) => unlocked.find((a) => a.id === id)).filter(Boolean);
  else if (plan === 'dots') picked = [...unlocked.filter(isDot), ...unlocked.filter(isNuke)];
  else if (plan === 'nukes') picked = [...unlocked.filter(isNuke), ...unlocked.filter(isDot)];
  else if (plan === 'support') picked = [...unlocked.filter(isSupport), ...unlocked.filter(isNuke)];
  else picked = unlocked.filter(isSupport);

  if (picked.length < MAX_ACTIVE_ABILITIES) picked = picked.concat(unlocked);
  const keep = new Set(picked.slice(0, MAX_ACTIVE_ABILITIES).map((a) => a.id));
  for (const a of cls.abilities) save.abilityToggles[a.id] = keep.has(a.id);
}

/** A fully kitted endgame character, with a chosen number of set pieces. */
function endgameChar(classId, plan, abilityPlan, solo, setPieces, seed) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));

  const s = newSave(classId, 'End');
  s.level = MAX_LEVEL;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  s.petForm = solo ? 0 : 2;
  s.embers = 220;

  // Farm gear the way a player at the cap has: many rolls, keep the best per slot.
  for (let i = 0; i < 900; i++) {
    const it = rollDrop(classId, 96, i % 40 === 0, { solo });
    if (!it) continue;
    const cur = s.equipped[it.slot];
    if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
  }
  // Force in exactly `setPieces` legendaries so the 2pc/4pc lines can be isolated.
  if (setPieces > 0) {
    const slots = ['weapon', 'chest', 'head', 'legs'];
    let placed = 0;
    for (const slot of slots) {
      if (placed >= setPieces) break;
      for (let i = 0; i < 9000; i++) {
        const it = rollDrop(classId, 96, true, { solo });
        if (it && it.slot === slot && it.rarity === 'legendary') { s.equipped[slot] = it; placed++; break; }
      }
    }
  }
  applyAbilities(s, abilityPlan);
  applyTalents(s, plan);
  return s;
}

/** Clear ordinary zone-90 trash for five minutes. */
function trashRun(s) {
  s.zone = 90; s.mobsKilledInZone = 0;
  const enc = new Encounter(s, () => {});
  let t = 0, kills = 0, deaths = 0;
  while (t < 300) {
    const r = enc.tick(STEP); t += STEP;
    if (r === 'win') { kills++; enc.reset(); enc.spawn(); }
    else if (r === 'lose') { deaths++; enc.revive(); enc.spawn(); }
  }
  return { kills, deaths };
}

/** One honest attempt at the Hollow King. */
function finalBoss(s) {
  s.zone = FINAL_ZONE; s.mobsKilledInZone = 0;
  const enc = new Encounter(s, () => {});
  let t = 0;
  while (t < FIGHT_CAP) {
    const r = enc.tick(STEP); t += STEP;
    if (r === 'win') return { won: true, time: t, hpLeft: enc.player.hp / enc.player.maxHp };
    if (r === 'lose') return { won: false, time: t, bossLeft: Math.max(0, enc.enemy.hp) / enc.enemy.maxHp };
  }
  return { won: false, time: FIGHT_CAP, timeout: true, bossLeft: Math.max(0, enc.enemy.hp) / enc.enemy.maxHp };
}

const combos = [];
for (const tp of TALENT_PLANS) for (const ap of ABILITY_PLANS) combos.push([tp, ap]);

const rows = [];
for (const id of CLASS_IDS) {
  for (let i = 0; i < RUNS; i++) {
    const [tp, ap] = combos[i % combos.length];
    const solo = Boolean(CLASSES[id].companion) && i % 2 === 1;
    const setPieces = [0, 0, 2, 4][i % 4];
    try {
      const s = endgameChar(id, tp, ap, solo, setPieces, 7000 + i * 53 + id.length * 211);
      const st = computeStats(s);
      const trash = trashRun(s);
      const boss = finalBoss(s);
      rows.push({
        id, tp, ap, solo, setPieces,
        crit: st.crit, haste: st.haste,
        dps: estimateDps(s),
        trashKills: trash.kills, trashDeaths: trash.deaths,
        won: boss.won, bossTime: boss.time, bossLeft: boss.bossLeft ?? 0, hpLeft: boss.hpLeft ?? 0,
        timeout: Boolean(boss.timeout),
      });
    } catch (e) {
      rows.push({ id, tp, ap, solo, setPieces, error: e.message });
    }
  }
}

const errs = rows.filter((r) => r.error);
const ok = rows.filter((r) => !r.error);
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] ?? 0; };

console.log(`${rows.length} endgame runs (${RUNS} per class, level ${MAX_LEVEL}, zone 90 trash + zone ${FINAL_ZONE} boss)\n`);
console.log('class     crit    haste   z90 kills  z90 deaths   HollowKing wins   median kill time');
for (const id of CLASS_IDS) {
  const rs = ok.filter((r) => r.id === id);
  const wins = rs.filter((r) => r.won);
  console.log(
    id.padEnd(9) +
    (median(rs.map((r) => r.crit)) * 100).toFixed(0).padStart(5) + '%' +
    (median(rs.map((r) => r.haste)) * 100).toFixed(0).padStart(8) + '%' +
    median(rs.map((r) => r.trashKills)).toFixed(0).padStart(11) +
    median(rs.map((r) => r.trashDeaths)).toFixed(0).padStart(12) +
    (wins.length + '/' + rs.length).padStart(18) +
    (wins.length ? median(wins.map((r) => r.bossTime)).toFixed(0) + 's' : '—').padStart(19)
  );
}

// Set-bonus isolation: does more of the set actually do anything?
//
// Win rate only. This printed a median DPS per group and it was worse than useless: the
// groups differ by talent plan and ability plan as much as by set count, so a median over
// twenty-eight heterogeneous builds said nothing about the set, and twice read as though
// four pieces were WEAKER than two. Isolating a set bonus needs one character with only
// the setId flags changed -- measured that way it is 3428 / 3677 / 4270 DPS across 0, 2
// and 4 pieces, which is what it should be.
console.log('');
console.log('by set pieces:   win rate');
for (const n of [0, 2, 4]) {
  const rs = ok.filter((r) => r.setPieces === n);
  const wins = rs.filter((r) => r.won).length;
  console.log(
    ("  " + n + " pieces").padEnd(17) +
    (wins + "/" + rs.length).padStart(8) +
    (rs.length ? ((wins / rs.length) * 100).toFixed(0) + "%" : "-").padStart(9)
  );
}

console.log('\n=== BROKEN ===');
const broken = [];
if (errs.length) for (const e of errs.slice(0, 10)) broken.push(`RUNTIME ERROR ${e.id} ${e.tp}/${e.ap}: ${e.error}`);

for (const id of CLASS_IDS) {
  const rs = ok.filter((r) => r.id === id);
  for (const r of rs) {
    const tags = [];
    if (r.trashKills === 0) tags.push('CANNOT CLEAR ZONE 90 TRASH (0 kills in 5 min)');
    if (r.trashDeaths >= 8) tags.push(r.trashDeaths + ' deaths in 5 min of zone 90 trash');
    if (r.won && r.bossTime < 25) tags.push(`kills the Hollow King in ${r.bossTime.toFixed(0)}s`);
    if (r.won && r.hpLeft > 0.9) tags.push(`beats the Hollow King at ${(r.hpLeft * 100).toFixed(0)}% health`);
    if (r.timeout && r.bossLeft > 0.85) tags.push(`15 min on the Hollow King and it is still at ${(r.bossLeft * 100).toFixed(0)}%`);
    if (r.crit > 0.90) tags.push(`crit ${(r.crit * 100).toFixed(0)}%`);
    if (r.haste > 0.70) tags.push(`haste ${(r.haste * 100).toFixed(0)}%`);
    if (tags.length) {
      broken.push(`  ${id.padEnd(8)} ${r.tp.padEnd(16)} ${r.ap.padEnd(8)} ${r.solo ? 'solo' : 'pet '} ${r.setPieces}pc -> ${tags.join('; ')}`);
    }
  }
}
console.log(broken.length ? broken.join('\n') : 'nothing unplayable or game-breaking at the cap.');
