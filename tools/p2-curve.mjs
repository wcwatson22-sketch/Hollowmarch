// Phase 2 / test 2b: find a rating curve with resolution at BOTH ends.
//
// stats.js already states the constraint: "Any single exponential that makes 40 rating
// meaningful also pins 4600 rating to the cap." The measurements agree -- at
// best-in-slot, 100 more crit rating is worth 0.22 percentage points, so there is no
// crit decision left in the last third of the game.
//
// This searches two families against the rating a real character carries at each level
// (taken from the Phase 1 marches) and reports which requirement each candidate fails,
// so the trade-off is visible rather than hidden behind a pass/fail.
//
//   node tools/p2-curve.mjs

const LEVELS = [10, 20, 30, 40, 50, 60];
const TYPICAL = { 10: 90, 20: 260, 30: 520, 40: 900, 50: 1500, 60: 2300 };
const BIS     = { 10: 150, 20: 450, 30: 950, 40: 1700, 50: 2900, 60: 4600 };
const LOW     = { 10: 40, 20: 120, 30: 250, 40: 430, 50: 720, 60: 1100 };

const hill = (R, L, p) => p.CAP * Math.pow(R, p.A) / (Math.pow(R, p.A) + Math.pow(p.K0 * Math.pow(L, p.P), p.A));
const expo = (R, L, p) => p.CAP * (1 - Math.exp(-R / (p.K0 * Math.pow(L, p.P))));

function measure(f, p) {
  const m = {};
  m.t10 = f(TYPICAL[10], 10, p); m.b10 = f(BIS[10], 10, p);
  m.t30 = f(TYPICAL[30], 30, p); m.b30 = f(BIS[30], 30, p);
  m.t60 = f(TYPICAL[60], 60, p); m.b60 = f(BIS[60], 60, p);
  m.gap60 = m.b60 - m.t60;
  m.gap30 = m.b30 - m.t30;
  m.marg60 = f(BIS[60] + 100, 60, p) - f(BIS[60], 60, p);
  m.marg10 = f(TYPICAL[10] + 100, 10, p) - f(TYPICAL[10], 10, p);
  return m;
}

// Each requirement, named, so a failure says which one.
const REQS = [
  ['lv10 visible',      (m) => m.t10 >= 0.05,   (m) => `lv10 typical ${(m.t10*100).toFixed(1)}% < 5%`],
  ['lv10 not solved',   (m) => m.b10 <= 0.32,   (m) => `lv10 BiS ${(m.b10*100).toFixed(1)}% > 32%`],
  ['lv60 real gap',     (m) => m.gap60 >= 0.15, (m) => `lv60 gap ${(m.gap60*100).toFixed(1)}pp < 15pp`],
  ['lv60 below ceiling',(m) => m.b60 <= 0.80,   (m) => `lv60 BiS ${(m.b60*100).toFixed(1)}% > 80%`],
  ['lv60 still buying', (m) => m.marg60 >= 0.006, (m) => `lv60 marginal ${(m.marg60*100).toFixed(2)}pp < 0.6pp`],
];
const failures = (m) => REQS.filter(([, ok]) => !ok(m)).map(([n]) => n);

console.log('=== the incumbent ===');
const CUR = { CAP: 0.72, K0: 120, P: 0.619 };
{
  const m = measure(expo, CUR);
  console.log('exponential CAP 0.72, K0 120, p 0.619');
  console.log(`  lv10 ${(m.t10*100).toFixed(0)}/${(m.b10*100).toFixed(0)}%   lv30 ${(m.t30*100).toFixed(0)}/${(m.b30*100).toFixed(0)}%   lv60 ${(m.t60*100).toFixed(0)}/${(m.b60*100).toFixed(0)}%`);
  console.log(`  lv60 gap ${(m.gap60*100).toFixed(1)}pp, marginal at BiS ${(m.marg60*100).toFixed(2)}pp per 100 rating`);
  console.log(`  fails: ${failures(m).join(', ') || 'nothing'}`);
}

const cands = [];
for (let CAP = 0.60; CAP <= 0.95001; CAP += 0.05)
  for (let K0 = 100; K0 <= 700; K0 += 25)
    for (let P = 0.40; P <= 0.80001; P += 0.05) {
      cands.push({ fam: 'exp', f: expo, p: { CAP, K0, P } });
      for (let A = 0.8; A <= 1.8001; A += 0.2) cands.push({ fam: 'hill', f: hill, p: { CAP, K0, P, A } });
    }

const scored = cands.map((c) => { const m = measure(c.f, c.p); return { ...c, m, fails: failures(m) }; });
const clean = scored.filter((c) => !c.fails.length);

console.log(`\n=== searched ${scored.length} candidates, ${clean.length} meet every requirement ===`);
if (!clean.length) {
  const counts = {};
  for (const c of scored) for (const f of c.fails) counts[f] = (counts[f] || 0) + 1;
  console.log('binding requirements (how many candidates each one eliminates):');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v}/${scored.length}`);
  }
} else {
  clean.sort((a, b) => (b.m.gap60 - a.m.gap60) || (b.m.t10 - a.m.t10));
  console.log('fam    CAP    K0     p      a     lv10 t/BiS  lv30 t/BiS  lv60 t/BiS    gap60  marg@BiS');
  for (const c of clean.slice(0, 12)) {
    const { CAP, K0, P, A } = c.p; const m = c.m;
    console.log(
      c.fam.padEnd(6) + CAP.toFixed(2).padStart(5) + String(K0).padStart(6) + P.toFixed(2).padStart(7) +
      (A ? A.toFixed(1) : '  -').padStart(7) +
      `${(m.t10*100).toFixed(0)}/${(m.b10*100).toFixed(0)}%`.padStart(12) +
      `${(m.t30*100).toFixed(0)}/${(m.b30*100).toFixed(0)}%`.padStart(12) +
      `${(m.t60*100).toFixed(0)}/${(m.b60*100).toFixed(0)}%`.padStart(12) +
      (m.gap60*100).toFixed(1).padStart(8) + 'pp' + (m.marg60*100).toFixed(2).padStart(9) + 'pp',
    );
  }
  const best = clean[0];
  console.log(`\n=== recommended: ${best.fam} CAP ${best.p.CAP.toFixed(2)}, K0 ${best.p.K0}, p ${best.p.P.toFixed(2)}${best.p.A ? ', a ' + best.p.A.toFixed(1) : ''} ===`);
  console.log('level      low    typical       BiS      dedicated-vs-typical');
  for (const L of LEVELS) {
    const lo = best.f(LOW[L], L, best.p), t = best.f(TYPICAL[L], L, best.p), b = best.f(BIS[L], L, best.p);
    console.log(String(L).padStart(5) + (lo*100).toFixed(1).padStart(9) + '%' + (t*100).toFixed(1).padStart(10) + '%' + (b*100).toFixed(1).padStart(10) + '%' + ((b-t)*100).toFixed(1).padStart(20) + 'pp');
  }
}
