// Solves the two per-class balance knobs at once:
//
//   dmgMult -> clearing speed parity (kills per unit time on ordinary mobs)
//   defMult -> boss parity (how long you survive relative to how long the boss takes)
//
// These interact: raising a class's damage shortens boss fights, which flatters its
// survival, so solving them separately oscillates. Each pass measures both and nudges
// both, with damping.
//
//   node tools/tune.mjs           report the solved values
//   node tools/tune.mjs --write   solve, then write them into js/data/classes.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, autoSlot } from '../js/data/classes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const STEP = 0.1;

// Clearing checks deliberately avoid boss zones (multiples of 10).
const CHECKS = [
  { level: 4,  zone: 2  },
  { level: 8,  zone: 5  },
  { level: 14, zone: 9  },
  { level: 20, zone: 14 },
  { level: 26, zone: 19 },
];
const BOSS_CHECKS = [
  { level: 11, zone: 10 },
  { level: 20, zone: 20 },
  { level: 27, zone: 30 },
];
const TRIALS = 8;
// Share of the defMult correction that comes from boss parity rather than trash.
// Was 0.7 while boss walls were the main killer. Once mob damage was raised to make a
// zone a real attrition run, trash became where deaths happen, and a 0.7 weighting let
// the trash spread diverge to 1.97 -- one class finding zone-clearing twice as
// comfortable as another. Even weighting is the honest setting now.
const BOSS_WEIGHT = 0.5;
const WINDOW = 240;
const FIGHT_CAP = 600;

/** A character with gear accumulated the way real play accumulates it. */
function makeChar(classId, level, gearZone) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(pick() * 4));
    const item = rollDrop(classId, z, false);
    if (!item) continue;
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
  }
  for (let b = 10; b <= gearZone; b += 10) {
    const item = rollDrop(classId, b, true);
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
  }
  if (level >= TALENT_UNLOCK_LEVEL) {
    const tree = TALENTS[classId];
    for (let i = 0; i < level - TALENT_UNLOCK_LEVEL + 1; i++) {
      const t = tree[i % tree.length];
      const cur = s.talents[t.id] || 0;
      if (cur < t.max) s.talents[t.id] = cur + 1;
    }
  }
  return s;
}

// --------------------------------------------------------------- clearing speed
function killsIn(classId, level, zone) {
  let total = 0;
  for (let n = 0; n < TRIALS; n++) {
    seed(zone * 1000 + n);
    const s = makeChar(classId, level, zone);
    s.zone = zone;
    const enc = new Encounter(s, () => {});
    let t = 0;
    while (t < WINDOW) {
      const r = enc.tick(STEP);
      t += STEP;
      if (r === 'win') { total++; enc.reset(); enc.spawn(); }
      else if (r === 'lose') { enc.revive(); enc.spawn(); }
    }
  }
  return total / TRIALS;
}

// --------------------------------------------------------------- trash attrition
/**
 * How comfortable an ordinary zone clear is: the mean fraction of health you sit at
 * across the window, divided down by how often you died in it.
 *
 * defMult used to be solved against boss fights alone, which is only half the game --
 * and the half that flatters sustain. A warlock is nearly unkillable in a long
 * single-target fight, so the boss term kept asking for less and less health while the
 * class was actually dying in normal clears, where fights are short, cleave chips at
 * you and Drain Life has no time to catch up. Correcting on both terms together stops
 * either one running away with the solve.
 */
function trashScore(classId, level, zone) {
  let sum = 0, n = 0, deaths = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    seed(zone * 1000 + trial + 900000);
    const s = makeChar(classId, level, zone);
    s.zone = zone;
    const enc = new Encounter(s, () => {});
    let t = 0;
    while (t < WINDOW) {
      const r = enc.tick(STEP);
      sum += Math.max(0, enc.player.hp) / enc.player.maxHp;
      n++;
      t += STEP;
      if (r === "win") { enc.reset(); enc.spawn(); }
      else if (r === "lose") { deaths++; enc.revive(); enc.spawn(); }
    }
  }
  // Reviving restores health, so mean health alone would quietly reward dying.
  return (sum / Math.max(1, n)) / (1 + deaths / TRIALS);
}

// --------------------------------------------------------------- boss parity
/**
 * Boss parity, scored on a continuous margin from the REAL fight -- nobody immortal.
 *
 *   won  -> 1 + (fraction of your health still left when the boss dies)   [1 .. 2]
 *   lost -> fraction of the boss health you removed before dying          [0 .. 1]
 *
 * Monotone across the win/lose boundary, so the solver always has a gradient, and it
 * cannot saturate the way a raw win rate does at 0% and 100%.
 *
 * This replaces a ratio of two clocks, each measured with one side made immortal. That
 * version had a fatal censoring bug: time-to-die was measured against a boss held at
 * full health, so the fight never ends, and a class with percentage-based sustain
 * cannot die in it at all. The warlock's Drain Life healed it for 1494% of its own max
 * health and the clock simply ran into the 600s cap -- as it did for hunter and priest
 * at the early checks too. A capped clock is a censored reading, not a measurement, so
 * the solver read "did not die" as "too tanky" and cut warlock health every pass until
 * it pinned the clamp floor at defMult 0.500: 516 max HP at zone 30, against the
 * warrior's 2278.
 */
function bossScore(classId, level, bossZone) {
  const scores = [];
  for (let n = 0; n < TRIALS; n++) {
    seed(bossZone * 1000 + n + 500000);
    const s = { ...makeChar(classId, level, bossZone), zone: bossZone, mobsKilledInZone: 0 };
    const enc = new Encounter(s, () => {});
    const bossLeft = () => Math.max(0, enc.enemy.hp) / enc.enemy.maxHp;
    let t = 0, out = null;
    while (t < FIGHT_CAP) {
      const r = enc.tick(STEP);
      if (r === "win") { out = 1 + Math.max(0, enc.player.hp) / enc.player.maxHp; break; }
      if (r === "lose") { out = 1 - bossLeft(); break; }
      t += STEP;
    }
    // Neither side died inside the cap. A stalemate is a failure to kill, scored by how
    // far the boss actually got pushed, which lands just under a bare win as it should.
    if (out === null) out = 1 - bossLeft();
    scores.push(out);
  }
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)];
}

/** Small deterministic PRNG so every pass measures against identical luck. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pin both RNGs to one seed. Every class then faces the same gear luck and crit rolls. */
let pick = Math.random; // the tool's own seeded stream, used by makeChar
function seed(n) {
  setLootRng(mulberry32(n));
  setCombatRng(mulberry32(n * 7919 + 13));
  pick = mulberry32(n * 104729 + 7);
}

const geoMean = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(Math.max(x, 0.01)), 0) / xs.length);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let best = { score: Infinity };

for (const id of CLASS_IDS) { CLASSES[id].dmgMult = 1; CLASSES[id].defMult = 1; }
console.log('Solving dmgMult (clear speed) and defMult (boss survival), from 1.0...\n');

for (let pass = 1; pass <= 8; pass++) {
  const clear = {}, boss = {}, trash = {};
  for (const id of CLASS_IDS) {
    clear[id] = geoMean(CHECKS.map((c) => killsIn(id, c.level, c.zone)));
    boss[id] = geoMean(BOSS_CHECKS.map((c) => bossScore(id, c.level, c.zone)));
    trash[id] = geoMean(CHECKS.map((c) => trashScore(id, c.level, c.zone)));
  }

  const clearTarget = geoMean(Object.values(clear));
  const bossTarget = geoMean(Object.values(boss));
  const trashTarget = geoMean(Object.values(trash));
  const clearSpread = Math.max(...Object.values(clear)) / Math.min(...Object.values(clear));
  const bossSpread = Math.max(...Object.values(boss)) / Math.min(...Object.values(boss));
  const trashSpread = Math.max(...Object.values(trash)) / Math.min(...Object.values(trash));

  console.log(`pass ${pass}   clear spread ${clearSpread.toFixed(3)}   boss spread ${bossSpread.toFixed(3)}   trash spread ${trashSpread.toFixed(3)}`);
  for (const id of CLASS_IDS) {
    console.log(
      `   ${id.padEnd(8)} clear ${clear[id].toFixed(1).padStart(6)}  boss ${boss[id].toFixed(3).padStart(5)}  trash ${trash[id].toFixed(3).padStart(5)}` +
      `   dmg ${CLASSES[id].dmgMult.toFixed(3)}  def ${CLASSES[id].defMult.toFixed(3)}`
    );
  }
  console.log('');

  // Keep the best solution seen, not merely the last one: the iteration can step past
  // a good fit, and there is no reason to ship whichever pass happened to run last.
  const score = clearSpread * bossSpread * trashSpread;
  if (score < best.score) {
    best = {
      score,
      clearSpread,
      bossSpread,
      trashSpread,
      values: Object.fromEntries(CLASS_IDS.map((id) => [id, { dmg: CLASSES[id].dmgMult, def: CLASSES[id].defMult }])),
    };
  }

  if (clearSpread < 1.12 && bossSpread < 1.10 && trashSpread < 1.10) { console.log('converged\n'); break; }

  for (const id of CLASS_IDS) {
    CLASSES[id].dmgMult = clamp(CLASSES[id].dmgMult * Math.pow(clearTarget / clear[id], 0.6), 0.4, 2.5);
    // Boss fights carry most of the weight because that is where deaths actually
    // happen -- a wall you cannot pass costs a run, where a rough trash pull costs a
    // sip of health. The trash term is a GUARD RAIL, not an equal partner: weighting
    // the two evenly let them cancel for the hunter, whose pet tanks the trash (so the
    // trash term reads "cut health") while its boss score is the weakest of the four
    // (so the boss term reads "raise it"). It landed in the middle and walled at the
    // zone-20 boss, dying 81 times in a simulated 6 hours.
    const survivalCorr =
      Math.pow(bossTarget / boss[id], BOSS_WEIGHT) * Math.pow(trashTarget / trash[id], 1 - BOSS_WEIGHT);
    CLASSES[id].defMult = clamp(CLASSES[id].defMult * Math.pow(survivalCorr, 0.6), 0.5, 2.5);
  }
}

for (const id of CLASS_IDS) {
  CLASSES[id].dmgMult = best.values[id].dmg;
  CLASSES[id].defMult = best.values[id].def;
}

console.log(`Best pass: clear spread ${best.clearSpread.toFixed(3)}, boss spread ${best.bossSpread.toFixed(3)}, trash spread ${best.trashSpread.toFixed(3)}`);

// A value sitting on a clamp bound means the solver ran out of road, not that it found
// an answer. Shipping one silently is exactly how warlock ended up on half the health
// of every other class.
const BOUNDS = { dmgMult: [0.4, 2.5], defMult: [0.5, 2.5] };
for (const id of CLASS_IDS) {
  for (const key of ['dmgMult', 'defMult']) {
    const [lo, hi] = BOUNDS[key];
    const v = CLASSES[id][key];
    // Within 10% of a bound counts. Warning only on an exact hit missed a solve that
    // put priest defMult at 0.509 against a floor of 0.5 -- not technically pinned, but
    // just as much a sign the solver had run out of road.
    const span = hi - lo;
    if (v <= lo + span * 0.1 || v >= hi - span * 0.1) {
      console.log(`  !! ${id} ${key} = ${v.toFixed(3)} is up against the clamp (${lo}-${hi}) -- suspect the metric, not the class`);
    }
  }
}

// A large spread in max health across classes is a design smell in its own right, whether
// or not any single value hit a bound.
{
  const defs = CLASS_IDS.map((id) => CLASSES[id].defMult);
  const spread = Math.max(...defs) / Math.min(...defs);
  if (spread > 2) {
    console.log(`  !! max-health spread across classes is ${spread.toFixed(2)}x -- a different game per class, not a difference in flavour`);
  }
}
for (const id of CLASS_IDS) {
  console.log(`  ${id.padEnd(8)} dmgMult ${CLASSES[id].dmgMult.toFixed(3)}   defMult ${CLASSES[id].defMult.toFixed(3)}`);
}

if (process.argv.includes('--write')) {
  const file = path.join(HERE, '..', 'js', 'data', 'classes.js');
  let src = fs.readFileSync(file, 'utf8');
  for (const id of CLASS_IDS) {
    for (const [key, val] of [['dmgMult', CLASSES[id].dmgMult], ['defMult', CLASSES[id].defMult]]) {
      const re = new RegExp(`(id: '${id}',[\\s\\S]*?${key}: )([0-9.]+)`, 'm');
      if (!re.test(src)) throw new Error(`could not find ${key} for ${id}`);
      src = src.replace(re, `$1${val.toFixed(3)}`);
    }
  }
  fs.writeFileSync(file, src);
  console.log('\nwrote js/data/classes.js');
}
