// Phase 2 / test 7: how good is the suggested kit, really?
//
// Phase 1 reported that 34 of 71 candidate abilities beat the game's own recommendation
// and called the suggester broken. That measurement has a flaw. tools/abilities.mjs
// swaps the candidate into the LAST slot of the baseline kit, and the last slot is
// where suggestedKit puts the guaranteed sustain ability -- so every candidate was
// really being measured against "kit with the heal removed", which flatters it.
//
// The honest question is not "does ability X beat the heal" but "is the kit the game
// picked close to the best kit available". This enumerates every three-ability
// combination and runs each one through the real combat loop, then reports where the
// suggested kit lands in that ranking.
//
//   node tools/p2-kit.mjs [class] [level] [trials]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedBuild } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent } from '../js/data/talents.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const ONLY = process.argv[2] || null;
const LEVEL = Number(process.argv[3] || 45);
const TRIALS = Number(process.argv[4] || 6);
const WINDOW = 90;

const ZONE_FOR_LEVEL = { 5: 3, 10: 7, 15: 14, 20: 22, 25: 31, 30: 40, 35: 50, 40: 58, 45: 68, 50: 76, 55: 86, 60: 94 };
function zoneForLevel(level) {
  const keys = Object.keys(ZONE_FOR_LEVEL).map(Number).sort((a, b) => a - b);
  if (level <= keys[0]) return Math.max(1, Math.round(level * 0.6));
  for (let i = 1; i < keys.length; i++) {
    if (level <= keys[i]) {
      const a = keys[i - 1], b = keys[i], f = (level - a) / (b - a);
      return Math.round(ZONE_FOR_LEVEL[a] + (ZONE_FOR_LEVEL[b] - ZONE_FOR_LEVEL[a]) * f);
    }
  }
  return ZONE_FOR_LEVEL[60];
}

function character(classId, level, solo, seed) {
  setLootRng(mulberry32(seed));
  const s = newSave(classId, 'K');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  const tree = TALENTS[classId].filter((t) => !(solo && isPetTalent(t))).filter((t) => level >= (t.req || 0));
  let pts = earnedTalentPoints(level);
  s.talents = {};
  for (const t of tree) {
    while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; }
    if (pts <= 0) break;
  }
  const zone = zoneForLevel(level);
  s.zone = zone; s.checkpoint = zone;
  for (const slot of Object.keys(s.equipped)) {
    let best = null;
    for (const z of [Math.max(1, Math.round(zone * 0.55)), Math.max(1, Math.round(zone * 0.8)), zone]) {
      for (let i = 0; i < 14; i++) {
        const d = rollDrop(classId, z, i % 7 === 0, { solo, level });
        if (d && d.slot === slot && (!best || itemScore(d) > itemScore(best))) best = d;
      }
    }
    if (best) s.equipped[slot] = best;
  }
  return s;
}

/** Damage dealt AND survival, because a kit that dies is not a good kit. */
function trial(save, seed) {
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(save, () => {});
  let dealt = 0, deaths = 0, kills = 0;
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (amount, ...rest) => { dealt += amount; real(amount, ...rest); };
  let t = 0;
  while (t < WINDOW) {
    const r = enc.tick(STEP);
    t += STEP;
    if (r === 'win') { kills++; enc.reset(); enc.spawn(); }
    else if (r === 'lose') { deaths++; enc.revive(); enc.spawn(); }
  }
  return { dps: dealt / WINDOW, kills, deaths };
}

function combos(arr, k) {
  const out = [];
  const walk = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); walk(i + 1, cur); cur.pop(); }
  };
  walk(0, []);
  return out;
}

const classes = ONLY ? [ONLY] : ['warrior', 'hunter', 'priest', 'warlock'];
const summary = [];

for (const classId of classes) {
  for (const solo of (CLASSES[classId].companion ? [false, true] : [false])) {
    const label = classId + (CLASSES[classId].companion ? (solo ? ' (solo)' : ' (pet)') : '');
    const pool = CLASSES[classId].abilities.filter((a) => a.unlock <= LEVEL);
    const all = combos(pool.map((a) => a.id), MAX_ACTIVE_ABILITIES);

    const chars = [];
    for (let k = 0; k < TRIALS; k++) chars.push(character(classId, LEVEL, solo, 700 + LEVEL * 13 + k * 211));

    const scored = [];
    for (const kit of all) {
      let dps = 0, deaths = 0, kills = 0;
      for (let k = 0; k < TRIALS; k++) {
        const s = chars[k];
        for (const a of CLASSES[classId].abilities) s.abilityToggles[a.id] = kit.includes(a.id);
        const r = trial(s, 3000 + k * 17);
        dps += r.dps; deaths += r.deaths; kills += r.kills;
      }
      scored.push({ kit, dps: dps / TRIALS, deaths: deaths / TRIALS, kills: kills / TRIALS });
    }
    // Rank on kills: throughput that gets you killed is not progress.
    scored.sort((a, b) => (b.kills - a.kills) || (b.dps - a.dps));

    const picked = suggestedBuild(classId, LEVEL, solo).kit;
    const key = (k) => [...k].sort().join('|');
    const rank = scored.findIndex((s) => key(s.kit) === key(picked));
    const best = scored[0];
    const mine = scored[rank] || { dps: 0, kills: 0, deaths: 0 };
    const pctOfBest = best.kills > 0 ? (mine.kills / best.kills) * 100 : 0;

    console.log(`\n=== ${label}, level ${LEVEL}, ${all.length} possible kits ===`);
    console.log(`  best kit        : ${best.kit.join(', ')}`);
    console.log(`                    ${best.kills.toFixed(1)} kills, ${best.dps.toFixed(0)} dps, ${best.deaths.toFixed(1)} deaths`);
    console.log(`  suggested kit   : ${picked.join(', ')}`);
    console.log(`                    ${mine.kills.toFixed(1)} kills, ${mine.dps.toFixed(0)} dps, ${mine.deaths.toFixed(1)} deaths`);
    console.log(`  RANK            : ${rank + 1} of ${all.length}  (top ${(((rank + 1) / all.length) * 100).toFixed(0)}%)`);
    console.log(`  kills vs best   : ${pctOfBest.toFixed(0)}%`);
    console.log('  top five kits:');
    for (const s of scored.slice(0, 5)) {
      console.log(`    ${s.kills.toFixed(1)} kills  ${s.dps.toFixed(0)} dps  ${s.deaths.toFixed(1)} deaths   ${s.kit.join(', ')}`);
    }
    summary.push({ label, rank: rank + 1, n: all.length, pctOfBest, picked, best: best.kit });
  }
}

console.log('\n\n=== summary ===');
console.log('build            suggested kit rank   percentile   kills vs best kit');
for (const s of summary) {
  console.log(
    s.label.padEnd(17) + `${s.rank} / ${s.n}`.padStart(17) +
    `top ${((s.rank / s.n) * 100).toFixed(0)}%`.padStart(13) + `${s.pctOfBest.toFixed(0)}%`.padStart(20),
  );
}
