// Phase 2 / tests 2 and 8: what is a stat point actually worth, and where does armour go?
//
// Phase 1 found crit and haste worth nothing before level 40 and a build dedicated to
// crit ending only five points above one that ignored it. Both readings came from the
// endgame, so neither could say whether the cause is the rating curve, the gear that
// feeds it, or the content it is measured against. This walks the whole level range.
//
// Armour gets the same treatment, because the Phase 1 verdict ("no measurable effect")
// is the kind of claim that is usually a measurement artefact. Effective health is the
// honest unit: how much raw damage the pool absorbs once mitigation is applied.
//
//   node tools/p2-stats.mjs

import { ratingToPct, mitigate, CRIT_CAP, HASTE_CAP } from '../js/systems/stats.js';

const LEVELS = [10, 20, 30, 40, 50, 60];

// --- 1. the rating curve, in isolation ----------------------------------------------
// What a typical and a best-in-slot character carries at each level, measured from the
// Phase 1 marches rather than assumed.
const TYPICAL = { 10: 90, 20: 260, 30: 520, 40: 900, 50: 1500, 60: 2300 };
const BIS     = { 10: 150, 20: 450, 30: 950, 40: 1700, 50: 2900, 60: 4600 };

console.log('=== 1. the rating curve as it stands ===');
console.log('"gap" is what an entire build dedicated to the stat buys over a typical one.\n');
console.log('level   crit typical   crit BiS    gap    haste typical   haste BiS    gap');
for (const L of LEVELS) {
  const ct = ratingToPct(TYPICAL[L], L, CRIT_CAP), cb = ratingToPct(BIS[L], L, CRIT_CAP);
  const ht = ratingToPct(TYPICAL[L], L, HASTE_CAP), hb = ratingToPct(BIS[L], L, HASTE_CAP);
  console.log(
    String(L).padStart(5) + (ct * 100).toFixed(1).padStart(14) + '%' + (cb * 100).toFixed(1).padStart(11) + '%' +
    ((cb - ct) * 100).toFixed(1).padStart(7) + 'pp' +
    (ht * 100).toFixed(1).padStart(15) + '%' + (hb * 100).toFixed(1).padStart(12) + '%' +
    ((hb - ht) * 100).toFixed(1).padStart(7) + 'pp',
  );
}

console.log('\n=== 2. where the curve spends its resolution ===');
console.log('Marginal percentage per 100 rating. A stat stops being a decision when this');
console.log('falls near zero -- you are buying nothing by chasing it.\n');
console.log('level   crit @typical   crit @BiS   haste @typical   haste @BiS');
for (const L of LEVELS) {
  const d = (r, cap) => (ratingToPct(r + 100, L, cap) - ratingToPct(r, L, cap)) * 100;
  console.log(
    String(L).padStart(5) + d(TYPICAL[L], CRIT_CAP).toFixed(2).padStart(14) + 'pp' +
    d(BIS[L], CRIT_CAP).toFixed(2).padStart(11) + 'pp' +
    d(TYPICAL[L], HASTE_CAP).toFixed(2).padStart(15) + 'pp' +
    d(BIS[L], HASTE_CAP).toFixed(2).padStart(12) + 'pp',
  );
}

// --- 3. armour, as effective health --------------------------------------------------

console.log('\n=== 3. armour: mitigation and effective health by zone ===');
console.log('k = 40 + 14*zone + 0.9*(zone-20)^2 . The quadratic term is the whole story.\n');
console.log('zone      k    armour worn   mitigation   EHP multiplier   +100 armour buys');
const ARMOR_AT = { 1: 40, 10: 190, 20: 420, 40: 980, 60: 1700, 80: 2600, 100: 3500 };
for (const z of [1, 10, 20, 40, 60, 80, 100]) {
  const deep = Math.pow(Math.max(0, z - 20), 2);
  const k = 40 + 14 * z + 0.9 * deep;
  const a = ARMOR_AT[z];
  const mit = a / (a + k);
  const ehp = 1 / (1 - mit);
  const ehp2 = 1 / (1 - (a + 100) / (a + 100 + k));
  console.log(
    String(z).padStart(4) + Math.round(k).toString().padStart(7) + String(a).padStart(14) +
    (mit * 100).toFixed(1).padStart(12) + '%' + ehp.toFixed(2).padStart(16) + 'x' +
    ((ehp2 / ehp - 1) * 100).toFixed(1).padStart(16) + '% EHP',
  );
}

console.log('\n=== 4. is armour weak, or is the content too deep for it? ===');
console.log('The same 2,000 armour against enemies of different depth.\n');
console.log('zone   mitigation with 2000 armour   EHP multiplier');
for (const z of [20, 40, 60, 80, 100]) {
  const k = 40 + 14 * z + 0.9 * Math.pow(Math.max(0, z - 20), 2);
  const mit = 2000 / (2000 + k);
  console.log(String(z).padStart(4) + (mit * 100).toFixed(1).padStart(24) + '%' + (1 / (1 - mit)).toFixed(2).padStart(17) + 'x');
}

// --- 5. candidate replacement curves --------------------------------------------------

console.log('\n=== 5. candidate curves: more resolution early, a real gap at the top ===');
console.log('Current:  pct = CAP * (1 - exp(-R / (K0 * level^p)))\n');
const CANDS = [
  { name: 'current',        K0: 120, P: 0.619, CAP: 0.72 },
  { name: 'softer K0',      K0: 95,  P: 0.619, CAP: 0.72 },
  { name: 'flatter p',      K0: 120, P: 0.50,  CAP: 0.72 },
  { name: 'lower cap+K0',   K0: 150, P: 0.560, CAP: 0.60 },
  { name: 'lower cap only', K0: 120, P: 0.619, CAP: 0.60 },
];
console.log('curve             lv10 typ/BiS    lv30 typ/BiS    lv60 typ/BiS   lv60 gap');
for (const c of CANDS) {
  const f = (R, L) => c.CAP * (1 - Math.exp(-R / (c.K0 * Math.pow(L, c.P))));
  const cell = (L) => `${(f(TYPICAL[L], L) * 100).toFixed(0)}/${(f(BIS[L], L) * 100).toFixed(0)}%`;
  const gap = (f(BIS[60], 60) - f(TYPICAL[60], 60)) * 100;
  console.log(
    c.name.padEnd(17) + cell(10).padStart(13) + cell(30).padStart(16) + cell(60).padStart(16) +
    gap.toFixed(1).padStart(10) + 'pp',
  );
}
