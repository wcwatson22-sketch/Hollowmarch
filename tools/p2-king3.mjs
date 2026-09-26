// Phase 2 / test 1c: the King fight is decided by SUSTAIN, not by health or damage.
//
// p2-king2.mjs computed a naive "time to die" from gross incoming damage and it did not
// predict anything: war-bleed takes 882 damage a second onto a 14,786 health pool -- a
// 17-second life expectancy -- and then wins a 67-second fight, every time. The missing
// term is healing. lok-fire survives 135 seconds at over a thousand incoming.
//
// So the question the matrix could not answer becomes concrete: is the split between
// the builds that win 100% and the builds that win 0% explained by how much health they
// put back per second? This measures gross damage in, gross healing out, and the net.
//
//   node tools/p2-king3.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 12);
const ROSTER = JSON.parse(fs.readFileSync('tools/.p2-roster.json', 'utf8'));

function probe(save, seed, { hp = 1, ap = 1 } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  enc.enemy.maxHp = Math.round(enc.enemy.maxHp * hp);
  enc.enemy.hp = enc.enemy.maxHp;
  enc.enemy.ap *= ap;
  const playerMax = enc.player.maxHp;

  // Heals are reported through the event stream, which is the only place the gross
  // figure survives -- the health pool clamps at full and hides the rest.
  let healed = 0, leeched = 0;
  const onEvent = (e) => {
    if (e.type === 'heal' && e.on === 'player') healed += e.amount || 0;
  };
  const enc2 = new Encounter(s, onEvent);
  setCombatRng(mulberry32(seed));
  enc2.enemy.maxHp = Math.round(enc2.enemy.maxHp * hp);
  enc2.enemy.hp = enc2.enemy.maxHp;
  enc2.enemy.ap *= ap;

  let t = 0, res = null, php = enc2.player.hp, taken = 0;
  while (t < 900) {
    const before = enc2.player.hp;
    const r = enc2.tick(STEP);
    t += STEP;
    if (enc2.player.hp < php) taken += php - enc2.player.hp;
    php = enc2.player.hp;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  if (!res) res = 'timeout';
  return {
    won: res === 'win', seconds: t, playerMax,
    takenPerSec: taken / t,
    healedPerSec: healed / t,
    // What the pool actually has to absorb once healing is counted.
    netPerSec: (taken - healed) / t,
  };
}

const ids = Object.keys(ROSTER);
console.log('=== sustain at the King ===');
console.log('Net = damage taken minus healing received, per second. A build whose net is');
console.log('near zero is unkillable no matter how small its health pool is.\n');
console.log('build          maxHp   taken/s   healed/s     net/s   net TTD   wins   fight');
const rows = [];
for (const id of ids) {
  const rs = [];
  for (let k = 0; k < TRIALS; k++) rs.push(probe(ROSTER[id].save, 91000 + k * 1783));
  const r = {
    id,
    playerMax: rs[0].playerMax,
    taken: median(rs.map((x) => x.takenPerSec)),
    healed: median(rs.map((x) => x.healedPerSec)),
    net: median(rs.map((x) => x.netPerSec)),
    wins: rs.filter((x) => x.won).length,
    seconds: median(rs.map((x) => x.seconds)),
  };
  r.netTtd = r.net > 0 ? r.playerMax / r.net : Infinity;
  rows.push(r);
  console.log(
    id.padEnd(14) + String(r.playerMax).padStart(7) + r.taken.toFixed(0).padStart(10) +
    r.healed.toFixed(0).padStart(11) + r.net.toFixed(0).padStart(10) +
    (r.netTtd === Infinity ? '   never' : r.netTtd.toFixed(0).padStart(7) + 's') +
    `${r.wins}/${TRIALS}`.padStart(8) + r.seconds.toFixed(0).padStart(7) + 's',
  );
}

console.log('\n=== does sustain predict the outcome? ===');
const winners = rows.filter((r) => r.wins === TRIALS);
const losers = rows.filter((r) => r.wins === 0);
const mitigation = (rs) => median(rs.map((r) => r.healed / Math.max(1, r.taken)));
console.log(`builds that win every trial (${winners.map((r) => r.id).join(', ')}):`);
console.log(`  heal back ${(mitigation(winners) * 100).toFixed(0)}% of what they take`);
console.log(`builds that win none (${losers.map((r) => r.id).join(', ')}):`);
console.log(`  heal back ${(mitigation(losers) * 100).toFixed(0)}% of what they take`);

console.log('\nsorted purely by healing as a share of damage taken:');
console.log('build          heal/taken   wins');
for (const r of [...rows].sort((a, b) => (b.healed / Math.max(1, b.taken)) - (a.healed / Math.max(1, a.taken)))) {
  console.log(
    r.id.padEnd(14) + ((r.healed / Math.max(1, r.taken)) * 100).toFixed(0).padStart(9) + '%' +
    `${r.wins}/${TRIALS}`.padStart(8),
  );
}
fs.writeFileSync('tools/.p2-king3.json', JSON.stringify(rows, null, 1));
