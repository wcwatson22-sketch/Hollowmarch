// Phase 2 / test 1d: prove the sustain threshold is CAUSAL, not correlated.
//
// p2-king3.mjs found a perfect rank correlation: heal back >=90% of incoming and you
// win every trial, heal back <60% and you lose every trial. That is suggestive and
// nothing more -- the builds that heal are also the builds with different damage,
// health and gear, so any of those could be the real cause.
//
// The test: take the character that loses, change NOTHING except how much it heals,
// and see where it flips. Then take the character that wins and take its healing away.
// If the flip tracks the healing knob and nothing else moved, sustain is the mechanism.
//
//   node tools/p2-sustain.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 12);
const ROSTER = JSON.parse(fs.readFileSync('tools/.p2-roster.json', 'utf8'));

/**
 * One King fight with an artificial healing multiplier applied to the player.
 *
 * `healMul` scales every heal the character receives. It is a probe, not a proposed
 * change -- the point is to move exactly one quantity and watch the outcome.
 */
function probe(save, seed, { healMul = 1, ap = 1, hp = 1, flatHps = 0 } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  enc.enemy.maxHp = Math.round(enc.enemy.maxHp * hp);
  enc.enemy.hp = enc.enemy.maxHp;
  enc.enemy.ap *= ap;

  // Intercept healing at the single place it is applied.
  if (healMul !== 1) {
    const realHeal = enc.healPlayer.bind(enc);
    enc.healPlayer = (amount, source) => realHeal(amount * healMul, source);
  }

  let t = 0, res = null;
  while (t < 900) {
    // A flat regeneration probe, to separate "healing" from "the abilities that heal".
    if (flatHps) enc.player.hp = Math.min(enc.player.maxHp, enc.player.hp + flatHps * STEP);
    const r = enc.tick(STEP);
    t += STEP;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  return { won: res === 'win', seconds: t };
}

const rate = (id, opts) => {
  let w = 0;
  for (let k = 0; k < TRIALS; k++) if (probe(ROSTER[id].save, 33000 + k * 2087, opts).won) w++;
  return w / TRIALS;
};

// --- 1. give the losers more healing, change nothing else ---------------------------

const LOSERS = ['hun-pack', 'hun-poison', 'pri-faith', 'pri-shadow', 'lok-demo'];
const WINNERS = ['war-bleed', 'lok-fire', 'war-auto'];

console.log('=== 1. scale the LOSERS\' healing, hold everything else fixed ===');
console.log('If sustain is the mechanism, each build flips at the point where its healing');
console.log('crosses its incoming damage -- and nothing else about it has changed.\n');
console.log('build          x1     x2     x4     x8    x16    x32');
for (const id of LOSERS) {
  let line = id.padEnd(14);
  for (const m of [1, 2, 4, 8, 16, 32]) line += `${(rate(id, { healMul: m }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}

console.log('\n=== 2. take the WINNERS\' healing away ===');
console.log('build          x1.00  x0.75  x0.50  x0.25   x0.00');
for (const id of WINNERS) {
  let line = id.padEnd(14);
  for (const m of [1, 0.75, 0.5, 0.25, 0]) line += `${(rate(id, { healMul: m }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}

// --- 3. flat regeneration: is it healing, or is it the heal ABILITIES? ---------------

console.log('\n=== 3. flat regeneration instead of heals ===');
console.log('Pure health per second, no ability involved. If a flat trickle flips the same');
console.log('builds, the mechanism is the sustain NUMBER, not the abilities that provide it.\n');
console.log('build             0    200    400    600    800   1000  hp/s');
for (const id of LOSERS) {
  let line = id.padEnd(14);
  for (const f of [0, 200, 400, 600, 800, 1000]) line += `${(rate(id, { flatHps: f }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}

// --- 4. the counterfactual: more health instead of more healing ----------------------

console.log('\n=== 4. the control: give them a bigger health pool instead ===');
console.log('Same builds, no extra healing, the King simply hits softer -- which is the');
console.log('same thing as a proportionally larger pool. Compare against test 1.\n');
console.log('build          ap x1.00  x0.85  x0.70  x0.55  x0.40');
for (const id of LOSERS) {
  let line = id.padEnd(14);
  for (const a of [1, 0.85, 0.7, 0.55, 0.4]) line += `${(rate(id, { ap: a }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}

console.log('\n=== 5. and the King\'s health, for completeness ===');
console.log('build          hp x1.00  x0.75  x0.55  x0.40  x0.25');
for (const id of LOSERS) {
  let line = id.padEnd(14);
  for (const h of [1, 0.75, 0.55, 0.4, 0.25]) line += `${(rate(id, { hp: h }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}
