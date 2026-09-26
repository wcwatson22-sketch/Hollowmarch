// Phase 2 / test 1f: the King is a health-POOL check, and the pool is measured in swings.
//
// The chain so far: not King health (cutting it 75% changes nothing for most builds),
// not damage output (the highest-DPS build in the study loses), not sustain in the
// abstract (granting 15% leech -- three thousand health a second -- still loses), and
// not heal routing (fixed, and pet builds still lose every fight).
//
// The trace showed why. The King swings 2,251 attack power every 1.8 seconds. Once the
// companion is down at 5-13 seconds, that lands on the player whole. Against a 7,747
// pool that is a quarter of the character per swing, so any four-swing gap in an
// inherently bursty leech stream is lethal -- lok-demo visibly oscillates 90% -> 14% ->
// 50% -> 6% before dying with 2,562 health per second of sustain running.
//
// The hypothesis this tests: what decides the fight is how many King swings the health
// pool absorbs, and everything else is noise around it.
//
//   node tools/p2-pool.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { computeStats, mitigate } from '../js/systems/stats.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 12);
const ROSTER = JSON.parse(fs.readFileSync('tools/.p2-roster.json', 'utf8'));

/** A King fight with the player's health pool scaled, nothing else touched. */
function probe(save, seed, { hpMul = 1, ap = 1, swing = 1 } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  if (hpMul !== 1) {
    // basePlayerMaxHp is the authority: applyMaxHpBuffs() recomputes player.maxHp from
    // it on every tick, so setting only player.maxHp is silently reverted one tick later.
    enc.basePlayerMaxHp = Math.round(enc.basePlayerMaxHp * hpMul);
    enc.player.maxHp = Math.round(enc.player.maxHp * hpMul);
    enc.player.hp = enc.player.maxHp;
  }
  enc.enemy.ap *= ap;
  enc.enemy.swingTime *= swing;
  let t = 0, res = null;
  while (t < 900) {
    const r = enc.tick(STEP);
    t += STEP;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  return { won: res === 'win', seconds: t };
}

const rate = (id, opts) => {
  let w = 0;
  for (let k = 0; k < TRIALS; k++) if (probe(ROSTER[id].save, 70500 + k * 1013, opts).won) w++;
  return w / TRIALS;
};

const ids = Object.keys(ROSTER);

// --- how many swings does each pool absorb, as the game currently stands? ------------

console.log('=== swings-to-live, at the current numbers ===');
console.log('One King swing is 2,251 attack power against your armour, every 1.8s.\n');
console.log('build          maxHp   armor   dmg/swing   % of pool   swings   wins now');
const table = [];
for (const id of ids) {
  const st = computeStats(ROSTER[id].save);
  const perSwing = mitigate(2251.25, st.armor, 100);
  const swings = st.maxHp / perSwing;
  const w = rate(id, {});
  table.push({ id, maxHp: st.maxHp, armor: st.armor, perSwing, swings, win: w });
  console.log(
    id.padEnd(14) + String(st.maxHp).padStart(7) + Math.round(st.armor).toString().padStart(8) +
    perSwing.toFixed(0).padStart(12) + ((perSwing / st.maxHp) * 100).toFixed(0).padStart(11) + '%' +
    swings.toFixed(1).padStart(9) + `${(w * 100).toFixed(0)}%`.padStart(11),
  );
}

const winners = table.filter((r) => r.win >= 0.5);
const losers = table.filter((r) => r.win < 0.5);
console.log(`\n  builds that win  : ${winners.map((r) => r.swings.toFixed(1)).join(', ')} swings`);
console.log(`  builds that lose : ${losers.map((r) => r.swings.toFixed(1)).join(', ')} swings`);
if (winners.length && losers.length) {
  const lo = Math.min(...winners.map((r) => r.swings));
  const hi = Math.max(...losers.map((r) => r.swings));
  console.log(`  the line sits between ${hi.toFixed(1)} and ${lo.toFixed(1)} swings`);
}

// --- scale the pool, change nothing else --------------------------------------------

console.log('\n=== scale the player health pool only ===');
console.log('build          x1.0   x1.25   x1.5   x1.75   x2.0   x2.5   x3.0');
for (const id of ids) {
  let line = id.padEnd(14);
  for (const m of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) line += `${(rate(id, { hpMul: m }) * 100).toFixed(0)}%`.padStart(7);
  console.log(line);
}

// --- the same total damage, delivered in smaller pieces ------------------------------

console.log('\n=== same DPS, smaller swings (halve AP and halve the swing timer) ===');
console.log('If the fight is about burst rather than throughput, this flips builds while');
console.log('leaving the King\'s damage per second exactly where it is.\n');
console.log('build          as-is   half-size swings   quarter-size swings');
for (const id of ids) {
  const base = rate(id, {});
  const half = rate(id, { ap: 0.5, swing: 0.5 });
  const quarter = rate(id, { ap: 0.25, swing: 0.25 });
  console.log(
    id.padEnd(14) + `${(base * 100).toFixed(0)}%`.padStart(7) +
    `${(half * 100).toFixed(0)}%`.padStart(19) + `${(quarter * 100).toFixed(0)}%`.padStart(22),
  );
}

// --- what the design target needs ----------------------------------------------------

console.log('\n=== finding the smallest King change that hits the target ===');
console.log('Target: strong builds win but are not safe; weak builds lose having taken');
console.log('a real bite out of him; nobody is deleted in under 15 seconds.\n');
console.log('ap    swing   spread of win rates across the 8 builds        median fight');
for (const ap of [1.0, 0.85, 0.7, 0.6, 0.5]) {
  for (const swing of [1.0, 0.7]) {
    const ws = ids.map((id) => rate(id, { ap, swing }));
    const secs = ids.map((id) => median([probe(ROSTER[id].save, 4242, { ap, swing }).seconds]));
    const nWin = ws.filter((w) => w >= 0.5).length;
    console.log(
      `x${ap.toFixed(2)}  x${swing.toFixed(2)}` .padEnd(14) +
      ws.map((w) => `${(w * 100).toFixed(0)}%`.padStart(5)).join('') +
      `   ${nWin}/8 win`.padStart(12) + median(secs).toFixed(0).padStart(8) + 's',
    );
  }
}
console.log('\norder: ' + ids.join(', '));
