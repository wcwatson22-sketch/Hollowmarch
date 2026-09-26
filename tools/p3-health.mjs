// Phase 3 / test 2: is an archetype HEALTHY, not merely viable?
//
// Finish rate answers one of the thirteen criteria. The other twelve are about whether
// a build is a build -- whether it reads as a thing, whether it gets more like itself
// as the march goes on, whether the player had a decision to make. Those need proxies,
// and a proxy that cannot be computed honestly is better left blank than guessed, so
// each one below says what it actually measures and the ones needing data this harness
// does not have are reported as gaps rather than filled in.
//
//   node tools/p3-health.mjs <dir> [prefix]

import fs from 'node:fs';

const DIR = process.argv[2];
const PREFIX = process.argv[3] || 'base3';

let rows = [];
for (let i = 0; i < 8; i++) {
  const f = `${DIR}/${PREFIX}_${i}.json`;
  if (fs.existsSync(f)) { try { rows.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* partial */ } }
}
rows = rows.filter((r) => !r.error);
if (!rows.length) { console.error('no rows'); process.exit(1); }

const med = (xs) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const byStyle = {};
for (const r of rows) (byStyle[r.style] ||= []).push(r);
const styles = Object.keys(byStyle).sort();

/**
 * Criterion 1 -- identity. How concentrated is the build's damage?
 *
 * A Herfindahl index over the four damage kinds. 1.0 means everything comes from one
 * source and the build is unmistakable; 0.25 means it is spread evenly across all four
 * and the build is "a character that attacks things".
 */
const identity = (rs) => {
  const m = ['auto', 'ability', 'dot', 'pet'].map((k) => mean(rs.map((r) => r.mix[k] || 0)));
  return m.reduce((s, x) => s + x * x, 0);
};

/** Criterion 3 -- how many stats does the build actually end up carrying? */
const statBreadth = (rs) => {
  const s = rs[0].stats;
  const carried = [
    mean(rs.map((r) => r.stats.crit)) > 0.55,
    mean(rs.map((r) => r.stats.haste)) > 0.40,
    mean(rs.map((r) => r.stats.critDmg)) > 2.2,
    mean(rs.map((r) => r.stats.dotDmg)) > 1.2,
    mean(rs.map((r) => r.stats.abilityDmg)) > 1.2,
    mean(rs.map((r) => r.stats.autoDmg)) > 1.15,
    mean(rs.map((r) => r.stats.petPow)) > 0.2,
    mean(rs.map((r) => r.stats.leech)) > 0.02,
    mean(rs.map((r) => r.stats.thorns)) > 0.2,
  ].filter(Boolean).length;
  return carried;
};

/**
 * Criterion 12 -- is one talent carrying the build?
 *
 * Proxy: the share of total damage attributable to the single largest named source.
 * Not a talent measurement, but a build whose damage is 90% one ability is a build
 * with one decision in it.
 */
const topSourceShare = (rs) => {
  const first = rs[0].topSources?.[0];
  if (!first) return 0;
  const m = /(\d+)%$/.exec(first);
  return m ? Number(m[1]) / 100 : 0;
};

/** Criterion 11 -- dead air. */
const pacing = (rs) => ({
  p95Gap: med(rs.map((r) => r.pacing?.p95KillGapSec || 0)),
  worstGapMin: med(rs.map((r) => r.worstGapMin || 0)),
  longestFight: med(rs.map((r) => r.pacing?.longestFightSec || 0)),
});

/** Criterion 10 -- does it trivialise the game? */
const trivial = (rs) => med(rs.map((r) => r.deaths)) === 0 && med(rs.map((r) => r.kingAttempts)) <= 1;

/** Criterion 6 -- can gear express this build at all? */
const gearAgency = (rs) => ({
  expressible: mean(rs.map((r) => r.gear?.expressible ?? 0)),
  offStat: mean(rs.map((r) => r.gear?.offStatShare ?? 0)),
  taken: mean(rs.map((r) => r.gear?.taken ?? 0)),
  passed: mean(rs.map((r) => r.gear?.passed ?? 0)),
});

/**
 * Criterion 13 -- is this build distinguishable from its siblings?
 *
 * Distance from the nearest other archetype of the SAME class, in damage-mix plus
 * normalised stat space. Two builds of one class that land in the same place are one
 * build with two names.
 */
function siblingDistance(style) {
  const me = byStyle[style];
  const cls = me[0].cls;
  const vec = (rs) => [
    mean(rs.map((r) => r.mix.auto)), mean(rs.map((r) => r.mix.ability)),
    mean(rs.map((r) => r.mix.dot)), mean(rs.map((r) => r.mix.pet)),
    mean(rs.map((r) => r.stats.crit)), mean(rs.map((r) => r.stats.haste)),
    mean(rs.map((r) => Math.min(1, r.stats.petPow))),
    mean(rs.map((r) => Math.min(1, r.stats.thorns / 3))),
    mean(rs.map((r) => Math.min(1, r.stats.leech * 10))),
  ];
  const a = vec(me);
  let best = Infinity, who = '';
  for (const other of styles) {
    if (other === style || byStyle[other][0].cls !== cls) continue;
    const b = vec(byStyle[other]);
    const d = Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
    if (d < best) { best = d; who = other; }
  }
  return { d: best === Infinity ? null : best, who };
}

console.log(`=== build health, ${rows.length} marches, ${styles.length} archetypes ===\n`);
console.log('archetype       fin   identity  stats  topSrc  p95gap  longest  expr  offStat  nearest sibling');
const report = [];
for (const st of styles) {
  const rs = byStyle[st];
  const fin = rs.filter((r) => r.won).length / rs.length;
  const id = identity(rs);
  const sb = statBreadth(rs);
  const ts = topSourceShare(rs);
  const pc = pacing(rs);
  const ga = gearAgency(rs);
  const sd = siblingDistance(st);
  report.push({ st, fin, id, sb, ts, pc, ga, sd, rs });
  console.log(
    st.padEnd(15) + `${(fin * 100).toFixed(0)}%`.padStart(5) +
    id.toFixed(2).padStart(10) + String(sb).padStart(7) +
    `${(ts * 100).toFixed(0)}%`.padStart(8) +
    `${pc.p95Gap.toFixed(0)}s`.padStart(8) + `${pc.longestFight.toFixed(0)}s`.padStart(9) +
    `${(ga.expressible * 100).toFixed(0)}%`.padStart(6) + `${(ga.offStat * 100).toFixed(0)}%`.padStart(9) +
    '  ' + (sd.d === null ? '-' : `${sd.d.toFixed(2)} ${sd.who}`),
  );
}

// --- the scorecard -------------------------------------------------------------------

console.log('\n=== criteria, scored ===');
console.log('Each column is one of the thirteen. . = passes, X = fails, ? = needs data');
console.log('this harness does not carry (talent spread, ability spread, tooltip truth).\n');
console.log('archetype        1  2  3  4  5  6  7  8  9 10 11 12 13   score');

const CRIT_LABELS = [
  '1 identity: damage concentration >= 0.40',
  '2 grows distinct: needs per-level snapshots (not recorded)',
  '3 stat breadth: 2 to 5 stats carried, not 1 and not everything',
  '4 talent choice: needs the talent-value sweep (tools/talentvalue.mjs)',
  '5 ability choice: needs the exhaustive kit ranker (tools/p2-kit.mjs)',
  '6 gear can express the build: expressible >= 50%',
  '7 has a weakness: fails if it is top quartile on BOTH speed and King attempts',
  '8 can finish: finish rate >= 90%',
  '9 no hidden mechanic: needs the tooltip audit',
  '10 not trivial: some deaths or more than one King attempt',
  '11 no dead air: p95 kill gap < 60s and worst gap < 3 min',
  '12 not one-note: top damage source < 85%',
  '13 distinct from siblings: nearest same-class distance >= 0.25',
];

const hours = report.map((r) => med(r.rs.map((x) => x.hours)));
const kings = report.map((r) => med(r.rs.map((x) => x.kingAttempts)));
const fastQ = [...hours].sort((a, b) => a - b)[Math.floor(hours.length * 0.25)];
const easyQ = [...kings].sort((a, b) => a - b)[Math.floor(kings.length * 0.25)];

for (const r of report) {
  const h = med(r.rs.map((x) => x.hours));
  const k = med(r.rs.map((x) => x.kingAttempts));
  const c = [
    r.id >= 0.40,
    null,
    r.sb >= 2 && r.sb <= 5,
    null,
    null,
    r.ga.expressible >= 0.50,
    !(h <= fastQ && k <= easyQ),
    r.fin >= 0.90,
    null,
    !trivial(r.rs),
    r.pc.p95Gap < 60 && r.pc.worstGapMin < 3,
    r.ts < 0.85,
    r.sd.d !== null && r.sd.d >= 0.25,
  ];
  const cells = c.map((v) => (v === null ? ' ?' : v ? ' .' : ' X')).join(' ');
  const scored = c.filter((v) => v !== null);
  const pass = scored.filter(Boolean).length;
  console.log(r.st.padEnd(15) + cells + `   ${pass}/${scored.length}`.padStart(8));
}

console.log('\nlegend:');
for (const l of CRIT_LABELS) console.log('  ' + l);

// --- where the failures cluster ------------------------------------------------------
console.log('\n=== failures by criterion ===');
const names = ['identity', 'grows', 'stat breadth', 'talent choice', 'ability choice',
  'gear expresses', 'has weakness', 'can finish', 'no hidden', 'not trivial',
  'no dead air', 'not one-note', 'distinct'];
for (let i = 0; i < 13; i++) {
  const failing = [];
  for (const r of report) {
    const h = med(r.rs.map((x) => x.hours)), k = med(r.rs.map((x) => x.kingAttempts));
    const c = [r.id >= 0.40, null, r.sb >= 2 && r.sb <= 5, null, null, r.ga.expressible >= 0.50,
      !(h <= fastQ && k <= easyQ), r.fin >= 0.90, null, !trivial(r.rs),
      r.pc.p95Gap < 60 && r.pc.worstGapMin < 3, r.ts < 0.85,
      r.sd.d !== null && r.sd.d >= 0.25];
    if (c[i] === false) failing.push(r.st);
  }
  if (failing.length) {
    console.log(`  ${String(i + 1).padStart(2)} ${names[i].padEnd(16)} ${failing.length}/${report.length}  ${failing.join(', ')}`);
  }
}
