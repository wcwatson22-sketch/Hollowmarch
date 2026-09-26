// Can you play however you want and still win?
//
// Every other tool here measures the build the game would pick for you. This measures
// the builds a PLAYER picks: a bleed warrior, a thorns warrior, a poison hunter, a fire
// warlock. Each one is specced honestly -- the abilities of that flavour, and the points
// that support them -- and then walked through real progression.
//
// The answer we want is not that every playstyle is equal. It is that none of them is a
// trap: the gap should read as "slower", not as "you have ruined this character".
//
//   node tools/playstyles.mjs [simMinutes] [runsPerStyle]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedBuild } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, branchState } from '../js/data/talents.js';
import { xpToNext, MOBS_PER_ZONE, MAX_LEVEL, MAX_LIVES, STALL_DEATHS, STALL_DROP } from '../js/data/mobs.js';

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
 * The playstyles a player would describe out loud. `want` says what the build is made of
 * so both halves -- abilities and points -- can be chosen to match it.
 */
const STYLES = [
  { id: 'warrior-bleed',   cls: 'warrior', solo: false, branch: 'Bleed',      types: ['bleed'],   dots: true },
  { id: 'warrior-thorns',  cls: 'warrior', solo: false, branch: 'Thorns',     types: ['physical'], defensive: true },
  { id: 'warrior-shouts',  cls: 'warrior', solo: false, branch: 'Shouts',     types: ['physical'] },
  { id: 'hunter-ranger',   cls: 'hunter',  solo: true,  branch: 'Ranger',     types: ['physical', 'arcane'] },
  { id: 'hunter-poison',   cls: 'hunter',  solo: true,  branch: 'Assassin',   types: ['poison', 'bleed'], dots: true },
  { id: 'hunter-pack',     cls: 'hunter',  solo: false, branch: 'Pack',       types: ['physical'], pet: true },
  { id: 'priest-holy',     cls: 'priest',  solo: true,  branch: 'Holy',       types: ['holy', 'fire'] },
  { id: 'priest-shadow',   cls: 'priest',  solo: true,  branch: 'Shadow',     types: ['shadow'],  dots: true },
  { id: 'priest-faith',    cls: 'priest',  solo: false, branch: 'Faith',      types: ['holy'],    pet: true },
  { id: 'warlock-fire',    cls: 'warlock', solo: true,  branch: 'Fire',       types: ['fire'],    dots: true },
  { id: 'warlock-shadow',  cls: 'warlock', solo: true,  branch: 'Shadow',     types: ['shadow'],  dots: true },
  { id: 'warlock-demo',    cls: 'warlock', solo: false, branch: 'Demonology', types: ['fire', 'shadow'], pet: true },
];

/** Abilities of the right flavour, plus whatever sustain the class owns. */
function kitFor(style, level) {
  const pool = CLASSES[style.cls].abilities.filter((a) => a.unlock <= level);
  const wanted = pool.filter((a) => {
    if (style.pet && ['petstrike', 'buffpet'].includes(a.kind)) return true;
    if (style.solo && ['petstrike', 'buffpet', 'healpet'].includes(a.kind) && !a.solo) return false;
    return style.types.includes(a.type || 'physical');
  });
  const damage = (a) => ((a.coef || 0) * (a.ticks || 1) + (a.burst || 0) + (a.executeCoef || 0) * 0.3) / Math.max(1, a.cd || 1);
  wanted.sort((x, y) => damage(y) - damage(x));

  const kit = wanted.slice(0, MAX_ACTIVE_ABILITIES).map((a) => a.id);
  // Anything left over goes to the class's best remaining ability, so a thin flavour
  // does not leave the bar half empty.
  if (kit.length < MAX_ACTIVE_ABILITIES) {
    for (const a of pool.sort((x, y) => damage(y) - damage(x))) {
      if (kit.length >= MAX_ACTIVE_ABILITIES) break;
      if (!kit.includes(a.id)) kit.push(a.id);
    }
  }
  // One way to stay alive, as the real kit builder guarantees.
  const sustain = pool.find((a) => ['healpet', 'hot', 'drain'].includes(a.kind));
  if (sustain && !kit.some((id) => pool.find((a) => a.id === id && ['healpet','hot','drain'].includes(a.kind)))) {
    kit[kit.length - 1] = sustain.id;
  }
  return kit;
}

/** Points into the named branch first, then whatever supports the kit. */
function talentsFor(style, level, kit) {
  const tree = TALENTS[style.cls]
    .filter((t) => level >= (t.req || 0))
    .filter((t) => !(style.solo && isPetTalent(t)));
  const inBranch = tree.filter((t) => t.branch === style.branch);
  const supporting = tree.filter((t) => t.ability && kit.includes(t.ability));
  const rest = tree.filter((t) => !inBranch.includes(t) && !supporting.includes(t));
  let points = earnedTalentPoints(level);
  const out = {};
  for (const t of [...inBranch, ...supporting, ...rest]) {
    while (points > 0 && (out[t.id] || 0) < t.max) { out[t.id] = (out[t.id] || 0) + 1; points--; }
    if (points <= 0) break;
  }
  return out;
}

function run(style, seed) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));
  const s = newSave(style.cls, 'Style');
  s.petChoice = CLASSES[style.cls].companion ? (style.solo ? 'solo' : 'pet') : null;

  const respec = () => {
    const kit = kitFor(style, s.level);
    for (const a of CLASSES[style.cls].abilities) s.abilityToggles[a.id] = kit.includes(a.id);
    s.talents = talentsFor(style, s.level, kit);
  };
  respec();

  let enc = new Encounter(s, () => {});
  let t = 0, kills = 0, deaths = 0, lives = MAX_LIVES, lastLevel = 1, ended = false, streak = 0;
  const limit = MINUTES * 60;
  while (t < limit) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message }; }
    t += STEP;
    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp; s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }
      const d = rollDrop(s.classId, s.zone, mob.boss, { solo: style.solo, level: s.level });
      if (d) { const cur = s.equipped[d.slot]; if (!cur || itemScore(d) > itemScore(cur)) s.equipped[d.slot] = d; }
      if (mob.boss) { s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone; lives = Math.min(MAX_LIVES, lives + 1); }
      else { s.mobsKilledInZone++; if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; } }
      if (s.level !== lastLevel) { respec(); lastLevel = s.level; }
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
  const branches = branchState(s.classId, s.talents);
  return {
    zone: s.zone, level: s.level, kills, deaths, ended,
    ttk: kills ? limit / kills : Infinity,
    bonuses: branches.earned.filter((b) => b.on).length,
  };
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

console.log(`${MINUTES} simulated minutes, ${RUNS} runs per playstyle\n`);
console.log('playstyle          branch        zone   lvl  deaths  s/kill  branch bonuses  ended');
const results = [];
for (const style of STYLES) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(run(style, 8800 + i * 151 + style.id.length * 29));
  const err = rs.find((r) => r.error);
  if (err) { console.log(`  ${style.id}  ERROR ${err.error}`); continue; }
  const m = {
    id: style.id, branch: style.branch,
    zone: median(rs.map((r) => r.zone)), level: median(rs.map((r) => r.level)),
    deaths: median(rs.map((r) => r.deaths)), ttk: median(rs.map((r) => r.ttk)),
    bonuses: median(rs.map((r) => r.bonuses)), ended: rs.filter((r) => r.ended).length,
  };
  results.push(m);
  console.log(
    m.id.padEnd(19) + m.branch.padEnd(13) +
    String(m.zone).padStart(5) + String(m.level).padStart(6) + String(m.deaths).padStart(8) +
    m.ttk.toFixed(1).padStart(8) + String(m.bonuses).padStart(16) + String(m.ended).padStart(7)
  );
}

console.log('\n=== read-out ===');
const zones = results.map((r) => r.zone);
const best = Math.max(...zones), worst = Math.min(...zones);
console.log(`zone spread across ${results.length} playstyles: ${worst} to ${best} (${(best / Math.max(1, worst)).toFixed(2)}x)`);
const traps = results.filter((r) => r.zone < best * 0.55 || r.ended > RUNS / 2);
console.log(traps.length
  ? 'TRAPS (less than 55% of the best, or ending most runs): ' + traps.map((r) => `${r.id} (zone ${r.zone})`).join(', ')
  : 'no playstyle is a trap: every one of them finishes, the slow ones just take longer');
