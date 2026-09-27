// Phase 4 / sections 1 and 2: the attrition curve, and what drives it.
//
// Phase 3's faithful harness put 64% of deaths in zones 11-50 and could not say why,
// because the only thing recorded per zone was a death count. This reads the ledger the
// harness now keeps -- health entering each fight, health leaving it, what the rest
// between pulls put back -- and lays the whole march out as one curve.
//
// The question it has to answer: is the midgame a wall because enemies hit too hard,
// because fights run too long, because rest healing cannot keep up, or because the
// character has nothing to recover WITH at that point in its progression.
//
//   node tools/p4-attrition.mjs <dir> [prefix]

import fs from 'node:fs';
import { mobHp, mobAp, mobArmor } from '../js/data/mobs.js';

const DIR = process.argv[2], PREFIX = process.argv[3] || 'true';
let rows = [];
for (let i = 0; i < 8; i++) {
  const f = `${DIR}/${PREFIX}_${i}.json`;
  if (fs.existsSync(f)) { try { rows.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* partial */ } }
}
rows = rows.filter((r) => !r.error);
if (!rows.length) { console.error('no rows'); process.exit(1); }

const NB = rows[0].blocks.length;
const SZ = 100 / NB;
const keys = ['deaths', 'kills', 'seconds', 'taken', 'dealt', 'healed', 'upgrades', 'hpInSum', 'hpOutSum', 'fights', 'restSum'];
const agg = Array.from({ length: NB }, () => Object.fromEntries(keys.map((k) => [k, 0])));
for (const r of rows) for (let i = 0; i < NB; i++) for (const k of keys) agg[i][k] += (r.blocks[i]?.[k] || 0);

const totalDeaths = agg.reduce((s, b) => s + b.deaths, 0);
const mid = (a, b) => Math.round((a + b) / 2);

console.log(`=== the attrition curve -- ${rows.length} faithful marches ===\n`);
console.log('The two columns that matter are hpIn and hpOut: what the character walks into');
console.log('each fight with, and what it walks out with. A stretch where hpIn falls is a');
console.log('stretch that is wearing the player down faster than it lets them recover.\n');
console.log('zones     fights   hpIn   hpOut   lost   rest   net   sec/fight  taken/s  deaths  death%');
for (let i = 0; i < NB; i++) {
  const b = agg[i];
  if (!b.fights) continue;
  const hpIn = b.hpInSum / b.fights, hpOut = b.hpOutSum / b.fights;
  const rest = b.restSum / b.fights;
  const lost = hpIn - hpOut;
  const net = rest - lost;
  console.log(
    `${i * SZ + 1}-${i * SZ + SZ}`.padEnd(10) +
    String(b.fights).padStart(7) +
    `${(hpIn * 100).toFixed(0)}%`.padStart(7) + `${(hpOut * 100).toFixed(0)}%`.padStart(8) +
    `${(lost * 100).toFixed(0)}%`.padStart(7) + `${(rest * 100).toFixed(0)}%`.padStart(7) +
    `${net >= 0 ? '+' : ''}${(net * 100).toFixed(0)}%`.padStart(6) +
    (b.seconds / b.fights).toFixed(1).padStart(11) +
    (b.taken / Math.max(1, b.seconds)).toFixed(0).padStart(9) +
    String(b.deaths).padStart(8) +
    `${((b.deaths / Math.max(1, totalDeaths)) * 100).toFixed(0)}%`.padStart(7),
  );
}

// --- what is moving underneath -------------------------------------------------------
console.log('\n=== the two sides of the race, by block ===');
console.log('Enemy numbers are the game\'s own curves; player numbers are what the marches');
console.log('actually reached. Both indexed to the first block so the divergence is visible.\n');
console.log('zones     mob hp   mob ap   dealt/s   taken/s   hp idx   ap idx   dealt idx   taken idx');
const base = { hp: mobHp(mid(1, SZ)), ap: mobAp(mid(1, SZ)), dealt: 0, taken: 0 };
for (let i = 0; i < NB; i++) {
  const b = agg[i];
  if (!b.fights) continue;
  const z = mid(i * SZ + 1, i * SZ + SZ);
  const dealt = b.dealt / Math.max(1, b.seconds), taken = b.taken / Math.max(1, b.seconds);
  if (i === 0) { base.dealt = dealt; base.taken = taken; }
  console.log(
    `${i * SZ + 1}-${i * SZ + SZ}`.padEnd(10) +
    Math.round(mobHp(z)).toString().padStart(8) + Math.round(mobAp(z)).toString().padStart(9) +
    dealt.toFixed(0).padStart(10) + taken.toFixed(0).padStart(10) +
    `${(mobHp(z) / base.hp).toFixed(1)}x`.padStart(9) + `${(mobAp(z) / base.ap).toFixed(1)}x`.padStart(9) +
    `${(dealt / Math.max(1, base.dealt)).toFixed(1)}x`.padStart(12) + `${(taken / Math.max(1, base.taken)).toFixed(1)}x`.padStart(12),
  );
}

// --- where it goes wrong, per class --------------------------------------------------
console.log('\n=== hpIn by class, so class-specific sustain is visible ===');
const classes = ['warrior', 'hunter', 'priest', 'warlock'];
let head = 'zones     ';
for (const c of classes) head += c.slice(0, 7).padStart(10);
console.log(head);
for (let i = 0; i < NB; i++) {
  let line = `${i * SZ + 1}-${i * SZ + SZ}`.padEnd(10);
  let any = false;
  for (const c of classes) {
    const rs = rows.filter((r) => r.cls === c);
    let hpInSum = 0, fights = 0;
    for (const r of rs) { hpInSum += r.blocks[i]?.hpInSum || 0; fights += r.blocks[i]?.fights || 0; }
    if (fights) { any = true; line += `${((hpInSum / fights) * 100).toFixed(0)}%`.padStart(10); }
    else line += '-'.padStart(10);
  }
  if (any) console.log(line);
}

// --- deaths per fight, the honest risk number ----------------------------------------
console.log('\n=== risk per fight ===');
console.log('zones       fights   deaths   death chance per fight');
for (let i = 0; i < NB; i++) {
  const b = agg[i];
  if (!b.fights) continue;
  const p = b.deaths / (b.fights + b.deaths);
  const bar = '#'.repeat(Math.round(p * 300));
  console.log(
    `${i * SZ + 1}-${i * SZ + SZ}`.padEnd(12) + String(b.fights).padStart(7) + String(b.deaths).padStart(9) +
    `  ${(p * 100).toFixed(2)}%  ${bar}`,
  );
}

// --- the summary the brief asks for ---------------------------------------------------
const worst = agg.map((b, i) => ({ i, p: b.deaths / Math.max(1, b.fights + b.deaths), b }))
  .filter((x) => x.b.fights > 50).sort((a, b) => b.p - a.p).slice(0, 4);
console.log('\n=== read-out ===');
console.log('deadliest stretches by death chance per fight:');
for (const w of worst) {
  const hpIn = w.b.hpInSum / w.b.fights;
  console.log(`  zones ${w.i * SZ + 1}-${w.i * SZ + SZ}: ${(w.p * 100).toFixed(2)}% per fight, entering at ${(hpIn * 100).toFixed(0)}% health, ${(w.b.seconds / w.b.fights).toFixed(1)}s per fight`);
}
