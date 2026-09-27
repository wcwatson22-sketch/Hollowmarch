// Phase 5 / sections 1-4: reshape progression against the cost of a fight.
//
// The first pass of this tool tuned against fight DURATION and the answer came back
// impossible: holding a fifteen-second midgame and a sixteen-second endgame at once
// needs 192,000-health trash, because player damage grows 645x over a march and no
// polynomial health curve tracks that. Duration was the wrong objective.
//
// The right one is what a fight COSTS, as a share of the health bar, because that is
// what attrition is made of and what rest healing is denominated in. Measured over 300
// faithful marches:
//
//   zones  1-5    16% of the bar per fight
//   zones 16-40   29-33%     <- the wall. Rest returns 10, so a fight nets -20.
//   zones 61-80   15-22%
//   zones 81-95   11-13%     <- free. Rest covers almost the whole cost.
//
// The profile is inverted, and the cause is visible in the components: cost is incoming
// damage multiplied by fight length, and fight length PEAKS at 20.5s in the twenties,
// exactly where the health pool is still small. So the midgame is expensive because
// fights are long and the player is fragile, and the endgame is free because fights
// have collapsed to seven seconds while the pool has grown fifty-fold.
//
// Two levers, therefore, not one: mob health sets fight length, mob attack power sets
// the rate. This tries them together against a target profile that always sits above
// the rest-heal line -- so attrition always exists -- and rises toward the end.
//
//   node tools/p5-curve.mjs <dir> [prefix]

import fs from 'node:fs';
import { mobHp, mobAp } from '../js/data/mobs.js';

const DIR = process.argv[2], PREFIX = process.argv[3] || 'w4';
let rows = [];
for (let i = 0; i < 8; i++) {
  const f = `${DIR}/${PREFIX}_${i}.json`;
  if (fs.existsSync(f)) { try { rows.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* partial */ } }
}
rows = rows.filter((r) => !r.error);
if (!rows.length) { console.error('no rows'); process.exit(1); }

const NB = rows[0].blocks.length, SZ = 100 / NB;
const midZone = (i) => Math.round(i * SZ + SZ / 2);
const agg = Array.from({ length: NB }, () => ({ dealt: 0, taken: 0, seconds: 0, fights: 0, hpInSum: 0 }));
for (const r of rows) for (let i = 0; i < NB; i++) {
  const b = r.blocks[i]; if (!b) continue;
  for (const k of ['dealt', 'taken', 'seconds', 'fights']) agg[i][k] += b[k];
  agg[i].hpInSum += b.hpInSum || 0;
}
// Everything below is derived from what the marches actually did, so a candidate is
// scored against real player scaling rather than an assumed one.
const obs = agg.map((b, i) => {
  const spf = b.seconds / b.fights;
  const pdps = b.dealt / b.seconds;            // player damage per second
  const tps = b.taken / b.seconds;             // damage taken per second
  const dpf = b.taken / b.fights;
  const pool = dpf / Math.max(0.001, (1 - b.hpInSum / b.fights) + 0.10);
  return { i, z: midZone(i), spf, pdps, tps, dpf, pool, share: dpf / pool, fights: b.fights };
}).filter((o) => o.fights > 0);

// The intended profile: always above the 10% rest line so attrition is real everywhere,
// gentlest while the player is learning, and heaviest for the final twenty zones.
const targetShare = (z) => {
  if (z <= 20) return 0.15;   // Establishment
  if (z <= 40) return 0.18;   // Development -- NOT the largest wall
  if (z <= 60) return 0.18;   // Specialization
  if (z <= 80) return 0.18;   // Power -- the player pulls ahead in SPEED, not safety
  return 0.23;                // Final Test
};

const earlyPad = (z) => 1 + 1.1 * Math.exp(-(z - 1) / 3.5);
const HP = {
  current: (z) => mobHp(z),
  softer: (z) => Math.round((37.6 * Math.pow(z, 0.907) + 6.99 * Math.pow(z, 1.78)) * earlyPad(z)),
  soft2: (z) => Math.round((37.6 * Math.pow(z, 0.907) + 6.99 * Math.pow(z, 1.83)) * earlyPad(z)),
};
const AP = {
  current: (z) => mobAp(z),
  // A steeper depth term so a fight's COST keeps pace with the health pool late, rather
  // than a bigger health bar on the enemy, which would only make the fight longer.
  steepLate: (z) => 8.6 + 3.05 * (z - 1) + 0.16 * Math.pow(Math.max(0, z - 20), 2.22),
  steeper: (z) => 8.6 + 3.05 * (z - 1) + 0.16 * Math.pow(Math.max(0, z - 20), 2.32),
};

/** Predicted cost share if mob health and attack power were these curves instead. */
function predict(o, hpF, apF) {
  const spf = o.spf * (hpF(o.z) / mobHp(o.z));          // duration scales with mob health
  const tps = o.tps * (apF(o.z) / mobAp(o.z));          // rate scales with mob attack power
  return { spf, share: (tps * spf) / o.pool };
}

const COMBOS = [
  ['current / current', HP.current, AP.current],
  ['softer / current', HP.softer, AP.current],
  ['soft2 / steepLate', HP.soft2, AP.steepLate],
  ['softer / steepLate', HP.softer, AP.steepLate],
  ['softer / steeper', HP.softer, AP.steeper],
];

console.log('=== cost of a fight, as a share of the health bar ===');
console.log('Rest between pulls returns 10%. A block above that line is wearing the');
console.log('player down; a block below it cannot.\n');
let head = 'zones     target';
for (const [n] of COMBOS) head += n.split(' / ')[0].slice(0, 7).padStart(10);
console.log(head + '   (health curve / attack curve pairs below)');
for (const o of obs) {
  let line = `${o.i * SZ + 1}-${o.i * SZ + SZ}`.padEnd(10) + `${(targetShare(o.z) * 100).toFixed(0)}%`.padStart(6);
  for (const [, hpF, apF] of COMBOS) line += `${(predict(o, hpF, apF).share * 100).toFixed(0)}%`.padStart(10);
  console.log(line);
}
console.log('\ncolumns: ' + COMBOS.map(([n]) => n).join('  |  '));

console.log('\n=== fight length under each, seconds ===');
console.log('zones     ' + COMBOS.map(([n]) => n.split(' / ')[0].slice(0, 7).padStart(10)).join(''));
for (const o of obs) {
  let line = `${o.i * SZ + 1}-${o.i * SZ + SZ}`.padEnd(10);
  for (const [, hpF, apF] of COMBOS) line += `${predict(o, hpF, apF).spf.toFixed(1)}s`.padStart(10);
  console.log(line);
}

console.log('\n=== distance from the intended profile ===');
console.log('combination              mean error   worst block            max fight   min fight');
const scored = [];
for (const [n, hpF, apF] of COMBOS) {
  const errs = obs.map((o) => Math.abs(predict(o, hpF, apF).share - targetShare(o.z)));
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const wi = errs.indexOf(Math.max(...errs));
  const secs = obs.map((o) => predict(o, hpF, apF).spf);
  scored.push({ n, mean });
  console.log(
    n.padEnd(25) + `${(mean * 100).toFixed(1)}pp`.padStart(11) +
    `zone ${obs[wi].z}: ${(predict(obs[wi], hpF, apF).share * 100).toFixed(0)}% vs ${(targetShare(obs[wi].z) * 100).toFixed(0)}%`.padStart(22) +
    `${Math.max(...secs).toFixed(1)}s`.padStart(12) + `${Math.min(...secs).toFixed(1)}s`.padStart(12),
  );
}
scored.sort((a, b) => a.mean - b.mean);
console.log(`\nclosest: ${scored[0].n}`);

console.log('\n=== what the winning curves actually change ===');
const [bn, bhp, bap] = COMBOS.find((c) => c[0] === scored[0].n);
console.log('zone    mob hp now -> new      mob ap now -> new');
for (const z of [10, 25, 40, 60, 80, 90, 100]) {
  console.log(
    String(z).padStart(4) +
    `${Math.round(mobHp(z))} -> ${Math.round(bhp(z))}`.padStart(22) +
    `   (${(bhp(z) / mobHp(z)).toFixed(2)}x)` +
    `${Math.round(mobAp(z))} -> ${Math.round(bap(z))}`.padStart(18) +
    `   (${(bap(z) / mobAp(z)).toFixed(2)}x)`,
  );
}
