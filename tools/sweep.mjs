// Build sweep: many different builds per class, run through real progression, with
// only the OUTLIERS reported.
//
// The other tools measure a class playing its intended build. This one measures what
// happens when a player does something else -- pours everything into one branch, takes
// three damage-over-time effects and nothing else, goes solo, or picks badly on purpose.
// A class is not balanced because its default build is; it is balanced when none of its
// reachable builds are unplayable and none of them trivialise the game.
//
//   node tools/sweep.mjs [runsPerClass] [simMinutes]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedKit } from '../js/data/classes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL, earnedTalentPoints } from '../js/data/talents.js';
import { xpToNext, MOBS_PER_ZONE, MAX_LEVEL, STALL_DEATHS, STALL_DROP, MAX_LIVES } from '../js/data/mobs.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const RUNS = Number(process.argv[2] || 30);
const MINUTES = Number(process.argv[3] || 90);
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

// --- build axes --------------------------------------------------------------------
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

/** Spend every earned point according to the plan. */
function applyTalents(save, plan) {
  const tree = TALENTS[save.classId];
  const points = earnedTalentPoints(save.level);
  save.talents = {};
  if (points <= 0) return;

  const branches = branchesOf(save.classId);
  const tier1 = (b) => tree.filter((t) => t.tier !== 2 && t.branch === b);
  const mastery = tree.filter((t) => t.tier === 2);

  let order;
  if (plan.startsWith('branch') && plan.includes('mastery')) {
    order = [...tier1(branches[0]), ...mastery];
  } else if (plan.startsWith('branch')) {
    const i = Number(plan.slice('branch'.length));
    order = [...tier1(branches[i] ?? branches[0]), ...mastery, ...tree];
  } else if (plan === 'mastery') {
    order = [...mastery, ...tree];
  } else {
    order = tree; // spread: round-robin below
  }

  let spent = 0;
  if (plan === 'spread') {
    let guard = 0;
    while (spent < points && guard++ < 5000) {
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
      save.talents[t.id] = (save.talents[t.id] || 0) + 1;
      spent++;
    }
    if (spent >= points) break;
  }
}

/** Choose which three abilities this build takes. */
function applyAbilities(save, plan) {
  const cls = CLASSES[save.classId];
  const unlocked = cls.abilities.filter((a) => save.level >= a.unlock);
  let picked;

  const isDot = (a) => a.kind === 'dot';
  const isNuke = (a) => a.kind === 'nuke' || a.kind === 'execute' || a.kind === 'stun' || a.kind === 'drain';
  const isSupport = (a) => ['healpet', 'hot', 'healself', 'hotself', 'buff', 'buffpet'].includes(a.kind);

  if (plan === 'auto') picked = suggestedKit(save.classId, save.level).map((id) => unlocked.find((a) => a.id === id)).filter(Boolean);
  else if (plan === 'dots') picked = [...unlocked.filter(isDot), ...unlocked.filter(isNuke)];
  else if (plan === 'nukes') picked = [...unlocked.filter(isNuke), ...unlocked.filter(isDot)];
  else if (plan === 'support') picked = [...unlocked.filter(isSupport), ...unlocked.filter(isDot), ...unlocked.filter(isNuke)];
  else picked = [...unlocked].reverse().filter(isSupport).concat([...unlocked].filter(isSupport)); // 'worst': support-only if possible

  if (picked.length < MAX_ACTIVE_ABILITIES) picked = picked.concat(unlocked);
  const keep = new Set(picked.slice(0, MAX_ACTIVE_ABILITIES).map((a) => a.id));
  for (const a of cls.abilities) save.abilityToggles[a.id] = keep.has(a.id);
}

/** One full progression run. */
function run(classId, talentPlan, abilityPlan, solo, seed) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));

  const s = newSave(classId, 'Sweep');
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  applyAbilities(s, abilityPlan);
  applyTalents(s, talentPlan);

  let enc = new Encounter(s, () => {});
  let t = 0, kills = 0, deaths = 0, bosses = 0, streak = 0;
  let lives = MAX_LIVES, ended = false;
  let lastKillT = 0, worstGap = 0, lastLevel = 1;
  const limit = MINUTES * 60;

  while (t < limit) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message, classId, talentPlan, abilityPlan, solo }; }
    t += STEP;

    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.gold += mob.gold;
      s.xp += mob.xp;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }
      const drop = rollDrop(s.classId, s.zone, mob.boss, { solo: s.petChoice === 'solo' });
      if (drop) {
        const cur = s.equipped[drop.slot];
        if (!cur || itemScore(drop) > itemScore(cur)) s.equipped[drop.slot] = drop;
      }
      if (mob.boss) { bosses++; s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone; lives = Math.min(MAX_LIVES, lives + 1); }
      else {
        s.mobsKilledInZone++;
        if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
      }
      // Builds re-pick as they level, the way a player would.
      if (s.level !== lastLevel) { applyAbilities(s, abilityPlan); applyTalents(s, talentPlan); lastLevel = s.level; }
      worstGap = Math.max(worstGap, t - lastKillT);
      lastKillT = t;
      enc = new Encounter(s, () => {});
    } else if (r === 'lose') {
      deaths++;
      // Out of lives ends the character, so a run cannot farm deaths for free.
      if (--lives <= 0) { ended = true; break; }
      // Mirror the anti-stall rule: a checkpoint stops being a floor after repeated
      // deaths with nothing killed in between.
      streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      enc = new Encounter(s, () => {});
    }
  }
  worstGap = Math.max(worstGap, t - lastKillT);

  return {
    classId, talentPlan, abilityPlan, solo,
    zone: s.zone, level: s.level, kills, deaths, bosses, ended, livesLeft: lives,
    ttk: kills > 0 ? limit / kills : Infinity,
    worstGap,
    stalled: worstGap > limit * 0.35,
  };
}

// --- sweep --------------------------------------------------------------------------
const combos = [];
for (const tp of TALENT_PLANS) for (const ap of ABILITY_PLANS) combos.push([tp, ap]);

const all = [];
for (const id of CLASS_IDS) {
  for (let i = 0; i < RUNS; i++) {
    const [tp, ap] = combos[i % combos.length];
    const solo = Boolean(CLASSES[id].companion) && i % 2 === 1;
    all.push(run(id, tp, ap, solo, 1000 + i * 37 + id.length * 101));
  }
}

const errors = all.filter((r) => r.error);
const ok = all.filter((r) => !r.error);

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const byClass = {};
for (const id of CLASS_IDS) byClass[id] = ok.filter((r) => r.classId === id);

console.log(`${all.length} runs (${RUNS} per class, ${MINUTES} simulated minutes each)\n`);

console.log('class     median zone   best zone   worst zone   median deaths   runs ended');
for (const id of CLASS_IDS) {
  const rs = byClass[id];
  const zones = rs.map((r) => r.zone);
  console.log(
    id.padEnd(9) +
    String(median(zones)).padStart(11) +
    String(Math.max(...zones)).padStart(12) +
    String(Math.min(...zones)).padStart(13) +
    String(median(rs.map((r) => r.deaths))).padStart(16) +
    String(rs.filter((r) => r.ended).length).padStart(9)
  );
}

// --- outliers only ------------------------------------------------------------------
const globalZone = median(ok.map((r) => r.zone));
const broken = [];

for (const id of CLASS_IDS) {
  const rs = byClass[id];
  const mz = median(rs.map((r) => r.zone));
  const md = median(rs.map((r) => r.deaths));
  for (const r of rs) {
    const tags = [];
    if (r.stalled) tags.push('STALLED (' + Math.round(r.worstGap / 60) + ' min with no kill)');
    if (r.kills === 0) tags.push('ZERO KILLS');
    if (r.zone <= 2 && MINUTES >= 45) tags.push('NEVER LEFT ZONE ' + r.zone);
    if (r.zone < mz * 0.45) tags.push('zone ' + r.zone + ' vs class median ' + mz);
    if (r.deaths > Math.max(12, md * 4)) tags.push(r.deaths + ' deaths vs median ' + md);
    if (r.zone > globalZone * 2.0) tags.push('zone ' + r.zone + ' vs overall median ' + globalZone);
    if (r.ended && r.zone < mz * 0.6) tags.push('RAN OUT OF LIVES in zone ' + r.zone);
    if (tags.length) broken.push({ r, tags });
  }
}

console.log('\n=== BROKEN ===');
if (errors.length) {
  console.log('\nRUNTIME ERRORS:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e.classId} ${e.talentPlan}/${e.abilityPlan}: ${e.error}`);
}
if (broken.length === 0 && errors.length === 0) {
  console.log('nothing unplayable or game-breaking in this sweep.');
} else {
  for (const b of broken) {
    const r = b.r;
    console.log(
      `  ${r.classId.padEnd(8)} ${r.talentPlan.padEnd(16)} ${r.abilityPlan.padEnd(8)} ${(r.solo ? 'solo' : 'pet ')}` +
      ` -> ${b.tags.join('; ')}`
    );
  }
}
