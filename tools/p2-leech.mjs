// Phase 2 / test 1e: is the King gated on one talent?
//
// The sustain trace narrowed the final boss down to health-per-second delivered to the
// player, and then the heal-routing fix moved pet builds from 0/s to 173/s and changed
// nothing -- they still lose every fight. That points past "sustain" to a specific
// asymmetry in where sustain comes from:
//
//   heal abilities scale with POWER          -- about 1,000 at level 60
//   leech scales with DAMAGE DEALT           -- about 16,000 per second at level 60
//
// A 10% leech is therefore worth roughly 1,600 health a second, while a heal ability
// worth 0.28 of power ticking every few seconds is worth a couple of hundred. If that
// is right, the King is not a check on gear, damage or defence. It is a check on
// whether the character owns the leech talent, and everything else is decoration.
//
// The test grants leech directly, changing nothing else about the character.
//
//   node tools/p2-leech.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { computeStats } from '../js/systems/stats.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 12);
const ROSTER = JSON.parse(fs.readFileSync('tools/.p2-roster.json', 'utf8'));

/** A King fight with the character's leech overridden to a fixed rate. */
function probe(save, seed, leech = null) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  if (leech !== null) enc.stats.leech = leech;

  let t = 0, res = null, healed = 0, taken = 0, php = enc.player.hp;
  const realHeal = enc.healPlayer.bind(enc);
  enc.healPlayer = (amount, source) => { healed += amount; realHeal(amount, source); };
  while (t < 900) {
    const r = enc.tick(STEP);
    t += STEP;
    if (enc.player.hp < php) taken += php - enc.player.hp;
    php = enc.player.hp;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  return { won: res === 'win', seconds: t, healPerSec: healed / t, takenPerSec: taken / t };
}

const ids = Object.keys(ROSTER);

console.log('=== current leech, by build ===');
console.log('build          leech   dps at King   leech would be worth   actual heal/s');
for (const id of ids) {
  const st = computeStats(ROSTER[id].save);
  const r = probe(ROSTER[id].save, 5150);
  console.log(
    id.padEnd(14) + (st.leech * 100).toFixed(0).padStart(5) + '%' +
    '            -' + (st.leech * 100).toFixed(0).padStart(0) +
    r.healPerSec.toFixed(0).padStart(22),
  );
}

console.log('\n=== grant leech, change nothing else ===');
console.log('If the King is a leech check, every build flips at roughly the same rate.\n');
console.log('build            0%     2%     4%     6%     8%    10%    15%');
const flip = {};
for (const id of ids) {
  let line = id.padEnd(14);
  for (const L of [0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15]) {
    let w = 0;
    for (let k = 0; k < TRIALS; k++) if (probe(ROSTER[id].save, 61000 + k * 1229, L).won) w++;
    const pct = (w / TRIALS) * 100;
    if (pct >= 50 && flip[id] === undefined) flip[id] = L;
    line += `${pct.toFixed(0)}%`.padStart(7);
  }
  console.log(line);
}

console.log('\n=== the leech rate each build needs to beat the King ===');
for (const id of ids) {
  console.log('  ' + id.padEnd(14) + (flip[id] === undefined ? 'more than 15%' : `${(flip[id] * 100).toFixed(0)}%`));
}
console.log(`\nLEECH_CAP is currently 10%.`);

// --- how does leech compare with the heal abilities, in raw numbers? ----------------
console.log('\n=== why leech dominates: the two sustain economies ===');
console.log('build          power   King dps   10% leech = hp/s   ability heals = hp/s   ratio');
for (const id of ids) {
  const st = computeStats(ROSTER[id].save);
  const base = probe(ROSTER[id].save, 5150, 0);
  const withL = probe(ROSTER[id].save, 5150, 0.10);
  // Damage per second is recovered from what 10% leech returns.
  const leechHps = withL.healPerSec - base.healPerSec;
  const abilityHps = base.healPerSec;
  console.log(
    id.padEnd(14) + Math.round(st.power).toString().padStart(6) +
    (leechHps * 10).toFixed(0).padStart(11) +
    leechHps.toFixed(0).padStart(19) + abilityHps.toFixed(0).padStart(23) +
    (abilityHps > 0 ? (leechHps / abilityHps).toFixed(1) + 'x' : '   inf').padStart(8),
  );
}
