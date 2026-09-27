// Phase 3 / test 1: the control. Every Phase 3 change is compared against this.
//
//   node tools/p3-baseline.mjs <dir> [prefix]

import fs from 'node:fs';
const DIR = process.argv[2], PREFIX = process.argv[3] || 'base3';
let rows = [];
for (let i = 0; i < 8; i++) {
  const f = `${DIR}/${PREFIX}_${i}.json`;
  if (fs.existsSync(f)) { try { rows.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* partial */ } }
}
const errs = rows.filter((r) => r.error);
rows = rows.filter((r) => !r.error);
const med = (xs) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

console.log(`=== PHASE 2 BASELINE -- ${rows.length} marches, ${errs.length} errors ===\n`);
console.log(`overall finish            ${pct(rows.filter((r) => r.won).length, rows.length)}`);
console.log(`median completion         ${med(rows.map((r) => r.hours)).toFixed(1)} h`);
console.log(`median deaths             ${med(rows.map((r) => r.deaths))}`);
console.log(`median King attempts      ${med(rows.map((r) => r.kingAttempts))}`);
console.log(`median dps (contaminated) ${med(rows.map((r) => r.dps)).toFixed(0)}`);
console.log(`median taken/s            ${med(rows.map((r) => r.takenPerSec)).toFixed(0)}`);
console.log(`median measured mitigation ${(med(rows.map((r) => r.mitigation)) * 100).toFixed(0)}%`);
console.log(`median gross healing/s    ${med(rows.map((r) => r.heal.grossPerSec)).toFixed(0)}`);
console.log(`median effective healing/s ${med(rows.map((r) => r.heal.effPerSec)).toFixed(0)}`);
console.log(`median OVERHEAL           ${(med(rows.map((r) => r.heal.overhealPct)) * 100).toFixed(0)}%`);
console.log(`median casts/min          ${med(rows.map((r) => r.pacing.castsPerMin)).toFixed(0)}`);
console.log(`median kill gap           ${med(rows.map((r) => r.pacing.medianKillGapSec)).toFixed(0)}s`);
console.log(`median p95 kill gap       ${med(rows.map((r) => r.pacing.p95KillGapSec)).toFixed(0)}s`);
console.log(`median longest fight      ${med(rows.map((r) => r.pacing.longestFightSec)).toFixed(0)}s`);
console.log(`worst no-kill period      ${Math.max(...rows.map((r) => r.worstGapMin)).toFixed(1)} min`);
console.log(`sanity failures (NaN/Inf) ${rows.filter((r) => r.sanity).length}`);

console.log('\nBY CLASS      n  finish   hours  deaths  king  mitig  overheal  offStat  expressible');
for (const c of ['warrior', 'hunter', 'priest', 'warlock']) {
  const rs = rows.filter((r) => r.cls === c); if (!rs.length) continue;
  console.log(c.padEnd(12) + String(rs.length).padStart(3) + pct(rs.filter((r) => r.won).length, rs.length).padStart(8)
    + med(rs.map((r) => r.hours)).toFixed(1).padStart(8) + String(med(rs.map((r) => r.deaths))).padStart(8)
    + String(med(rs.map((r) => r.kingAttempts))).padStart(6)
    + `${(med(rs.map((r) => r.mitigation)) * 100).toFixed(0)}%`.padStart(7)
    + `${(med(rs.map((r) => r.heal.overhealPct)) * 100).toFixed(0)}%`.padStart(10)
    + `${(mean(rs.map((r) => r.gear.offStatShare)) * 100).toFixed(0)}%`.padStart(9)
    + `${(mean(rs.map((r) => r.gear.expressible)) * 100).toFixed(0)}%`.padStart(13));
}

console.log('\nDEATHS BY ZONE BLOCK');
const NB = rows[0].blocks.length;
const blocks = Array.from({ length: NB }, () => ({ deaths: 0, kills: 0, seconds: 0, taken: 0, dealt: 0, healed: 0, upgrades: 0, hpInSum: 0, hpOutSum: 0, fights: 0, restSum: 0 }));
for (const r of rows) for (let i = 0; i < NB; i++) for (const k of Object.keys(blocks[i])) blocks[i][k] += (r.blocks[i][k] || 0);
const totalD = blocks.reduce((s, b) => s + b.deaths, 0);
console.log('zones     deaths   share  kills  sec/kill  taken/s  upgrades');
const SZ = 100 / NB;
for (let i = 0; i < NB; i++) {
  const b = blocks[i];
  console.log(`${i * SZ + 1}-${i * SZ + SZ}`.padEnd(10) + String(b.deaths).padStart(7)
    + pct(b.deaths, totalD).padStart(8) + String(b.kills).padStart(7)
    + (b.kills ? (b.seconds / b.kills).toFixed(1) : '-').padStart(10)
    + (b.seconds ? (b.taken / b.seconds).toFixed(0) : '-').padStart(9)
    + String(b.upgrades).padStart(10));
}

console.log('\nKING ATTEMPTS BY ARCHETYPE');
const byStyle = {};
for (const r of rows) (byStyle[r.style] ||= []).push(r);
const ks = Object.entries(byStyle).map(([k, v]) => [k, med(v.map((r) => r.kingAttempts)), med(v.map((r) => r.hours)), v.filter((r) => r.won).length / v.length]);
ks.sort((a, b) => a[1] - b[1]);
for (const [k, kk, hh, ff] of ks) console.log('  ' + k.padEnd(14) + String(kk).padStart(4) + '  ' + hh.toFixed(1) + 'h  ' + (ff * 100).toFixed(0) + '%');

console.log('\nFINAL STAT DISTRIBUTION (median across all marches)');
for (const k of ['power', 'crit', 'haste', 'armor', 'maxHp', 'critDmg', 'dotDmg', 'abilityDmg', 'autoDmg', 'petPow', 'leech', 'thorns', 'healPow']) {
  const v = rows.map((r) => r.stats[k]).filter((x) => Number.isFinite(x));
  const lo = [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.1)];
  const hi = [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.9)];
  console.log('  ' + k.padEnd(12) + med(v).toFixed(2).padStart(10) + `   p10-p90  ${lo.toFixed(2)} .. ${hi.toFixed(2)}`);
}

console.log('\nGEAR');
const rar = {};
for (const r of rows) for (const [k, v] of Object.entries(r.gear.rarity || {})) rar[k] = (rar[k] || 0) + v;
console.log('  rarities equipped over all marches: ' + JSON.stringify(rar));
console.log(`  median items taken ${med(rows.map((r) => r.gear.taken))}, passed ${med(rows.map((r) => r.gear.passed))}`);
console.log(`  median set pieces ${med(rows.map((r) => r.setPieces))}, sets broken ${med(rows.map((r) => r.gear.setBroken))}`);
console.log(`  median final gear ilvl total ${med(rows.map((r) => r.gear.ilvl))}`);

console.log('\nHEALING BY SOURCE (gross -> effective, overheal share)');
const hs = {};
for (const r of rows) for (const [k, v] of Object.entries(r.heal.bySource || {})) {
  (hs[k] ||= { gross: 0, eff: 0 }); hs[k].gross += v.gross; hs[k].eff += v.eff;
}
for (const [k, v] of Object.entries(hs).sort((a, b) => b[1].gross - a[1].gross)) {
  console.log('  ' + k.padEnd(18) + (v.gross / 1e6).toFixed(1).padStart(8) + 'm -> ' + (v.eff / 1e6).toFixed(1).padStart(7) + 'm   ' + ((1 - v.eff / v.gross) * 100).toFixed(0) + '% wasted');
}
