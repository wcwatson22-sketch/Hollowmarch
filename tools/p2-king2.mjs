// Phase 2 / test 1b: decompose the King fight into the two clocks that decide it.
//
// The matrix in p2-king.mjs showed the fight is bimodal -- some builds win 100% of the
// time and some win 0% -- which means "is the King too hard" is the wrong question. The
// right one is what separates the two groups.
//
// Every fight is a race between two clocks:
//   TTK -- how long the player needs to remove 1.11m health
//   TTD -- how long the player survives 2,251 AP on a 1.8s swing
// You win exactly when TTD > TTK. Measuring both separately says whether a build fails
// because it cannot hurt him or because it cannot outlast him, and those need opposite
// fixes.
//
//   node tools/p2-king2.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { computeStats, computeCompanion, mitigate } from '../js/systems/stats.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 12);
const ROSTER = JSON.parse(fs.readFileSync('tools/.p2-roster.json', 'utf8'));

/** One fight, fully instrumented: both clocks, and where the damage went. */
function probe(save, seed, { hp = 1, ap = 1 } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  enc.enemy.maxHp = Math.round(enc.enemy.maxHp * hp);
  enc.enemy.hp = enc.enemy.maxHp;
  enc.enemy.ap *= ap;

  const kingHp = enc.enemy.maxHp;
  const playerMax = enc.player.maxHp;
  let dealt = 0, taken = 0;
  const byKind = { auto: 0, ability: 0, dot: 0, pet: 0, thorns: 0 };
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (amount, source, crit, kind, school, id) => {
    dealt += amount;
    if (byKind[kind] !== undefined) byKind[kind] += amount;
    real(amount, source, crit, kind, school, id);
  };

  let t = 0, res = null, php = enc.player.hp;
  // Ramp: how much of the player's damage lands in the first 15 seconds vs later. A
  // damage-over-time build front-loads almost nothing, which is the hypothesis.
  let dealtAt15 = 0;
  while (t < 900) {
    const r = enc.tick(STEP);
    t += STEP;
    if (enc.player.hp < php) taken += php - enc.player.hp;
    php = enc.player.hp;
    if (t >= 15 && dealtAt15 === 0) dealtAt15 = dealt;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  if (!res) res = 'timeout';
  const outDps = dealt / t;
  const inDps = taken / t;
  return {
    res, won: res === 'win', seconds: t,
    outDps, inDps,
    // The two clocks, projected from the rates actually observed.
    ttk: outDps > 0 ? kingHp / outDps : Infinity,
    ttd: inDps > 0 ? playerMax / inDps : Infinity,
    removed: 1 - Math.max(0, enc.enemy.hp) / kingHp,
    playerMax, kingHp,
    rampShare: dealt > 0 ? dealtAt15 / dealt : 0,
    byKind,
  };
}

const ids = Object.keys(ROSTER);

console.log('=== the two clocks at the King, current numbers ===');
console.log('TTK = seconds of uptime needed to kill him. TTD = seconds you survive.');
console.log('You win when TTD > TTK. The margin column is TTD/TTK.\n');
console.log('build          out dps   in dps     TTK      TTD   margin   result   removed');
const rows = [];
for (const id of ids) {
  const rs = [];
  for (let k = 0; k < TRIALS; k++) rs.push(probe(ROSTER[id].save, 77000 + k * 1319));
  const r = {
    id,
    outDps: median(rs.map((x) => x.outDps)),
    inDps: median(rs.map((x) => x.inDps)),
    ttk: median(rs.map((x) => x.ttk)),
    ttd: median(rs.map((x) => x.ttd)),
    wins: rs.filter((x) => x.won).length,
    removed: median(rs.map((x) => x.removed)),
    seconds: median(rs.map((x) => x.seconds)),
    ramp: median(rs.map((x) => x.rampShare)),
    byKind: rs[0].byKind,
    playerMax: rs[0].playerMax,
  };
  r.margin = r.ttd / r.ttk;
  rows.push(r);
  console.log(
    id.padEnd(14) + r.outDps.toFixed(0).padStart(8) + r.inDps.toFixed(0).padStart(9) +
    r.ttk.toFixed(0).padStart(8) + 's' + r.ttd.toFixed(0).padStart(8) + 's' +
    r.margin.toFixed(2).padStart(9) + `${r.wins}/${TRIALS}`.padStart(9) +
    (r.removed * 100).toFixed(0).padStart(9) + '%',
  );
}

console.log('\n=== so which clock is each build losing on? ===');
console.log('build          diagnosis');
for (const r of rows.sort((a, b) => b.margin - a.margin)) {
  let d;
  if (r.margin >= 1.15) d = 'WINS COMFORTABLY -- would be trivialised by a nerf';
  else if (r.margin >= 0.95) d = 'wins on the wire -- this is the target shape';
  else if (r.ttk > 200) d = `DAMAGE-STARVED: needs ${r.ttk.toFixed(0)}s of uptime, nothing survives that`;
  else d = `SURVIVAL-STARVED: only needs ${r.ttk.toFixed(0)}s but dies at ${r.ttd.toFixed(0)}s`;
  console.log(r.id.padEnd(14) + d);
}

console.log('\n=== how much of the damage lands in the first 15 seconds? ===');
console.log('A build that front-loads is unaffected by a short fight. A ramp build is');
console.log('deleted by one. This is the mechanism behind the bimodal split.\n');
console.log('build          first 15s share   damage mix (auto/abil/dot/pet)');
for (const r of rows) {
  const tot = Object.values(r.byKind).reduce((a, b) => a + b, 0) || 1;
  const mix = ['auto', 'ability', 'dot', 'pet'].map((k) => ((r.byKind[k] / tot) * 100).toFixed(0)).join('/');
  console.log(r.id.padEnd(14) + (r.ramp * 100).toFixed(0).padStart(12) + '%     ' + mix);
}

// --- does the player's health pool explain the split? --------------------------------
console.log('\n=== what predicts survival? ===');
console.log('build          maxHp   in dps   TTD    effective HP vs raw HP');
for (const r of rows.sort((a, b) => b.ttd - a.ttd)) {
  console.log(
    r.id.padEnd(14) + String(r.playerMax).padStart(7) + r.inDps.toFixed(0).padStart(9) +
    r.ttd.toFixed(0).padStart(6) + 's' + (r.playerMax / Math.max(1, r.inDps)).toFixed(1).padStart(12) + 's per HP-pool',
  );
}

// --- the upward direction: can the King be made to threaten the strong builds? --------
console.log('\n=== testing UPWARD: does anything threaten the builds that win 100%? ===');
const strong = rows.filter((r) => r.wins === TRIALS).map((r) => r.id);
if (!strong.length) {
  console.log('(no build wins every trial at current numbers)');
} else {
  console.log('build          x1.00 ap   x1.25 ap   x1.50 ap   x1.75 ap   x2.00 ap');
  for (const id of strong) {
    let line = id.padEnd(14);
    for (const apMul of [1.0, 1.25, 1.5, 1.75, 2.0]) {
      let w = 0;
      for (let k = 0; k < TRIALS; k++) if (probe(ROSTER[id].save, 88000 + k * 911, { ap: apMul }).won) w++;
      line += `${((w / TRIALS) * 100).toFixed(0)}%`.padStart(11);
    }
    console.log(line);
  }
}

fs.writeFileSync('tools/.p2-king2.json', JSON.stringify(rows, null, 1));
