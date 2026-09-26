// Phase 3 / test 6: how fast should the mitigation constant grow with depth?
//
// Phase 2 showed armour is not mathematically weak -- it peaks around 57% mitigation at
// zone 20 -- but that k grows 22x between zones 20 and 100 while worn armour grows only
// 8.3x, so the same gear falls from 86% mitigation to 22%. Phase 2 suggested moving the
// quadratic coefficient from 0.9 toward 0.4 and explicitly did not claim 0.4 was right.
//
// This sweeps it, first analytically across the zones the brief lists, then through
// real combat for the candidates worth taking seriously -- including the thing that
// must not happen, which is armour plus sustain adding up to something unkillable.
//
//   node tools/p3-armor.mjs [trials]

import fs from 'node:fs';
import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { computeStats, setArmorDepth, getArmorDepth } from '../js/systems/stats.js';
import { mulberry32, median, STEP, styleById, marchTo } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 10);
const ZONES = [10, 20, 40, 60, 80, 90, 100];
const COEFS = [0.9, 0.7, 0.55, 0.4, 0.3, 0.2];

// Armour a character actually wears at each depth, measured from the Phase 1/2 marches.
const ARMOR_AT = { 10: 190, 20: 420, 40: 980, 60: 1700, 80: 2600, 90: 3050, 100: 3500 };

const kAt = (z, c) => 40 + 14 * z + c * Math.pow(Math.max(0, z - 20), 2);
const mitAt = (z, c, a = ARMOR_AT[z]) => a / (a + kAt(z, c));

console.log('=== 1. mitigation by depth, sweeping the quadratic coefficient ===');
console.log('Armour worn is what a real character carries at that zone.\n');
let head = 'zone   armour';
for (const c of COEFS) head += `    c=${c.toFixed(2)}`;
console.log(head);
for (const z of ZONES) {
  let line = String(z).padStart(4) + String(ARMOR_AT[z]).padStart(9);
  for (const c of COEFS) line += `${(mitAt(z, c) * 100).toFixed(0)}%`.padStart(10);
  console.log(line);
}

console.log('\n=== 2. effective health multiplier ===');
console.log('zone   armour' + COEFS.map((c) => `    c=${c.toFixed(2)}`).join(''));
for (const z of ZONES) {
  let line = String(z).padStart(4) + String(ARMOR_AT[z]).padStart(9);
  for (const c of COEFS) line += `${(1 / (1 - mitAt(z, c))).toFixed(2)}x`.padStart(10);
  console.log(line);
}

console.log('\n=== 3. marginal EHP per +100 armour ===');
console.log('If this is near zero, an armour affix is not a choice.\n');
console.log('zone   armour' + COEFS.map((c) => `    c=${c.toFixed(2)}`).join(''));
for (const z of ZONES) {
  let line = String(z).padStart(4) + String(ARMOR_AT[z]).padStart(9);
  for (const c of COEFS) {
    const e1 = 1 / (1 - mitAt(z, c)), e2 = 1 / (1 - mitAt(z, c, ARMOR_AT[z] + 100));
    line += `${((e2 / e1 - 1) * 100).toFixed(1)}%`.padStart(10);
  }
  console.log(line);
}

console.log('\n=== 4. the gap that matters: a tank versus a glass cannon at zone 100 ===');
console.log('A character that deliberately stacked armour against one that ignored it.');
console.log('If these two columns are close, defensive gearing is not a decision.\n');
console.log('coef   glass (1200)   tank (5000)   tank advantage');
for (const c of COEFS) {
  const g = 1 / (1 - mitAt(100, c, 1200)), t = 1 / (1 - mitAt(100, c, 5000));
  console.log(
    c.toFixed(2).padStart(4) + `${g.toFixed(2)}x`.padStart(15) + `${t.toFixed(2)}x`.padStart(14) +
    `${((t / g - 1) * 100).toFixed(0)}% more effective health`.padStart(32),
  );
}

// --- real combat -------------------------------------------------------------------

const ROSTER_PATH = 'tools/.p2-roster.json';
if (!fs.existsSync(ROSTER_PATH)) {
  console.log('\n(no marched roster cached; skipping the combat half -- run tools/p2-king.mjs first)');
  process.exit(0);
}
const ROSTER = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));

/** Survival against ordinary zone-100 trash, and against the King. */
function survive(save, seed, { king = false } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: king ? 0 : 3, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  if (!king) {
    // Force ordinary trash rather than the final boss.
    enc.save.mobsKilledInZone = 3;
    enc.spawn();
  }
  let t = 0, res = null, taken = 0, healed = 0, php = enc.player.hp;
  const rh = enc.healPlayer.bind(enc);
  enc.healPlayer = (a, src) => { healed += a; rh(a, src); };
  while (t < 600) {
    const r = enc.tick(STEP);
    t += STEP;
    if (enc.player.hp < php) taken += php - enc.player.hp;
    php = enc.player.hp;
    if (r === 'win') { if (king) { res = 'win'; break; } enc.reset(); enc.spawn(); }
    else if (r === 'lose') { res = 'lose'; break; }
  }
  return { won: res === 'win', died: res === 'lose', seconds: t, takenPerSec: taken / t, healPerSec: healed / t };
}

const ids = Object.keys(ROSTER);
const tanky = ids.filter((id) => /thorns|tank|sustain/.test(id));
const glassy = ids.filter((id) => /glass|crit|fire|shadow|poison/.test(id));

console.log('\n=== 5. real combat at the King, sweeping the coefficient ===');
console.log('coef   wins/' + (ids.length * TRIALS) + '   median taken/s   median heal/s   builds that win');
const original = getArmorDepth();
const combatRows = [];
for (const c of COEFS) {
  setArmorDepth(c);
  let wins = 0; const taken = [], heal = []; const winners = [];
  for (const id of ids) {
    let w = 0;
    for (let k = 0; k < TRIALS; k++) {
      const r = survive(ROSTER[id].save, 50500 + k * 811, { king: true });
      if (r.won) { wins++; w++; }
      taken.push(r.takenPerSec); heal.push(r.healPerSec);
    }
    if (w >= TRIALS / 2) winners.push(id);
  }
  combatRows.push({ c, wins, winners });
  console.log(
    c.toFixed(2).padStart(4) + String(wins).padStart(9) +
    median(taken).toFixed(0).padStart(17) + median(heal).toFixed(0).padStart(16) +
    '   ' + (winners.join(', ') || 'none'),
  );
}
setArmorDepth(original);

console.log('\n=== 6. the immortality check ===');
console.log('Armour plus sustain must not add up to something that cannot be killed.');
console.log('A build is flagged if it takes the full 600s without dying AND heals back');
console.log('more than it takes.\n');
console.log('coef   flagged builds');
for (const c of COEFS) {
  setArmorDepth(c);
  const flagged = [];
  for (const id of ids) {
    const r = survive(ROSTER[id].save, 61600, { king: true });
    if (!r.died && !r.won && r.healPerSec > r.takenPerSec) flagged.push(id);
  }
  console.log(c.toFixed(2).padStart(4) + '   ' + (flagged.join(', ') || 'none'));
}
setArmorDepth(original);
console.log(`\n(restored ARMOR_DEPTH to ${getArmorDepth()})`);
