// Phase 2 / test 1: what actually makes the Hollow King a wall?
//
// Phase 1 established that 73% of all deaths happen in zones 91-100 and that the median
// attempt strips under 10% of his health. It could not say whether that is his health,
// his damage, his armour, or the approach that leaves players under-geared -- those were
// all moving together.
//
// This holds the character completely still and moves one of his numbers at a time.
// Every cell of the matrix is the SAME character: marched to zone 99 the way a player
// would, carrying the gear it earned, then thrown at a King whose health and damage are
// scaled independently.
//
//   node tools/p2-king.mjs [trials] [rosterFile]

import fs from 'node:fs';
import { STYLES, styleById, marchTo, fightKing, kingAttempts, median, mulberry32 } from './p2-common.mjs';
import { computeStats } from '../js/systems/stats.js';

const TRIALS = Number(process.argv[2] || 10);
const ROSTER = process.argv[3] || 'tools/.p2-roster.json';

// Two builds per class: the best and the worst performer Phase 1 found, so the matrix
// shows what a change does to the top and the bottom of the range at once. A fix that
// rescues hun-poison by trivialising war-bleed is not a fix.
const SUBJECTS = (process.env.P2_SUBJECTS || "").split(",").filter(Boolean).length ? process.env.P2_SUBJECTS.split(",") : [
  'war-bleed',   // Phase 1: 100%, 1 King attempt   -- the ceiling
  'war-auto',    // Phase 1: 100%, 1 attempt, 6.5h  -- slow but solid
  'hun-pack',    // Phase 1: 100%, 2 attempts       -- best hunter
  'hun-poison',  // Phase 1: 33%, 270 attempts      -- the floor
  'pri-faith',   // Phase 1: 100%, 19 attempts      -- fast approach, bad boss
  'pri-shadow',  // Phase 1: 100%, 7 attempts
  'lok-fire',    // Phase 1: 100%, 1 attempt
  'lok-demo',    // Phase 1: 100%, 8 attempts
];

function loadRoster() {
  if (fs.existsSync(ROSTER)) {
    try { return JSON.parse(fs.readFileSync(ROSTER, 'utf8')); } catch { /* re-march */ }
  }
  const out = {};
  for (const id of SUBJECTS) {
    const style = styleById(id);
    // A subject that ran out of clock before zone 99 is not a level-60 endgame
    // character and testing a boss against it measures the march, not the boss. Re-seed
    // until one actually arrives, and say so if none does.
    let r = null, attempts = 0;
    for (let k = 0; k < 4; k++) {
      attempts++;
      process.stderr.write(`  marching ${id} (seed ${k}) ...`);
      const t0 = Date.now();
      const cand = marchTo(style, 41000 + id.length * 313 + k * 7717, 99);
      process.stderr.write(` lvl ${cand.save.level}, zone ${cand.reached}, ${(cand.seconds / 3600).toFixed(1)}h sim, ${((Date.now() - t0) / 1000).toFixed(0)}s wall\n`);
      r = cand;
      if (!cand.capped && cand.save.level >= 60) break;
      r = null;
    }
    if (!r) {
      process.stderr.write(`  !! ${id} never reached zone 99 at level 60 in ${attempts} tries -- EXCLUDED\n`);
      continue;
    }
    const st = computeStats(r.save);
    out[id] = {
      save: r.save,
      reached: r.reached,
      level: r.save.level,
      hours: r.seconds / 3600,
      deaths: r.deaths,
      power: Math.round(st.power),
      maxHp: st.maxHp,
      armor: Math.round(st.armor),
      crit: st.crit,
      haste: st.haste,
    };
  }
  fs.writeFileSync(ROSTER, JSON.stringify(out));
  return out;
}

process.stderr.write('Building the roster (real marches, cached after the first run)\n');
const roster = loadRoster();

console.log('=== the subjects, as they arrive at zone 99 ===');
console.log('build         lvl   zone   power    maxHp   armor   crit  haste   march');
for (const id of SUBJECTS) {
  const r = roster[id];
  console.log(
    id.padEnd(13) + String(r.level).padStart(4) + String(r.reached).padStart(7) +
    String(r.power).padStart(8) + String(r.maxHp).padStart(9) + String(r.armor).padStart(8) +
    (r.crit * 100).toFixed(0).padStart(6) + '%' + (r.haste * 100).toFixed(0).padStart(6) + '%' +
    (r.hours.toFixed(1) + 'h').padStart(8),
  );
}

// --- the matrix -------------------------------------------------------------------

const HP_STEPS = [1.0, 0.75, 0.55, 0.40];
const AP_STEPS = [1.0, 0.85, 0.70, 0.55];

function cell(save, hp, ap) {
  const wins = [], removed = [], secs = [];
  for (let k = 0; k < TRIALS; k++) {
    const r = fightKing(save, 60000 + k * 1471, { hp, ap });
    wins.push(r.won ? 1 : 0);
    removed.push(r.removed);
    secs.push(r.seconds);
  }
  return {
    winRate: wins.reduce((a, b) => a + b, 0) / TRIALS,
    removed: median(removed),
    seconds: median(secs),
  };
}

console.log(`\n=== HP x AP matrix, ${TRIALS} fights per cell ===`);
console.log('Each cell: win rate / median % of King removed / median fight length.\n');

const grid = {};
for (const id of SUBJECTS) {
  const save = roster[id].save;
  grid[id] = {};
  console.log(`-- ${id} --`);
  let head = 'HP\\AP  ';
  for (const ap of AP_STEPS) head += String(`x${ap.toFixed(2)}`).padStart(20);
  console.log(head);
  for (const hp of HP_STEPS) {
    let line = `x${hp.toFixed(2)} `;
    for (const ap of AP_STEPS) {
      const c = cell(save, hp, ap);
      grid[id][`${hp}|${ap}`] = c;
      const txt = `${(c.winRate * 100).toFixed(0)}% ${(c.removed * 100).toFixed(0)}% ${c.seconds.toFixed(0)}s`;
      line += txt.padStart(20);
    }
    console.log(line);
  }
  console.log('');
}

// --- what the matrix says ------------------------------------------------------------

console.log('=== isolating the cause ===\n');

// Sensitivity: moving HP alone vs moving AP alone, from the current corner.
console.log('From the current numbers, which single lever moves the fight more?');
console.log('build          -25% HP alone   -15% AP alone   what that means');
for (const id of SUBJECTS) {
  const base = grid[id]['1|1'];
  const hpOnly = grid[id]['0.75|1'];
  const apOnly = grid[id]['1|0.85'];
  const dHp = (hpOnly.winRate - base.winRate) * 100;
  const dAp = (apOnly.winRate - base.winRate) * 100;
  const verdict = Math.abs(dHp - dAp) < 8 ? 'both matter about equally'
    : dAp > dHp ? 'DAMAGE-bound: he kills you before health matters'
    : 'HEALTH-bound: you survive, you just cannot finish him';
  console.log(
    id.padEnd(14) + (dHp >= 0 ? '+' : '') + dHp.toFixed(0).padStart(6) + 'pp' +
    (dAp >= 0 ? '+' : '') + dAp.toFixed(0).padStart(14) + 'pp   ' + verdict,
  );
}

// The target profile the owner asked for, stated as testable conditions.
console.log('\n=== which cell hits the design target? ===');
console.log('Target: a strong build wins in 1-3 attempts, a weak one loses but LEARNS');
console.log('(first attempt strips 40-60%), and nobody one-shots him by accident.\n');
console.log('cell            strong builds    weak builds    spread   verdict');

const STRONG = ['war-bleed', 'lok-fire', 'hun-pack'];
const WEAK = ['hun-poison', 'pri-faith', 'lok-demo'];

const scored = [];
for (const hp of HP_STEPS) {
  for (const ap of AP_STEPS) {
    const key = `${hp}|${ap}`;
    const strongWin = median(STRONG.map((id) => grid[id][key].winRate));
    const weakWin = median(WEAK.map((id) => grid[id][key].winRate));
    const weakRemoved = median(WEAK.map((id) => grid[id][key].removed));
    const strongSecs = median(STRONG.map((id) => grid[id][key].seconds));
    // A good fight: strong builds land 35-80% per attempt (so 1-3 tries), weak builds
    // clearly lose but get meaningfully far in, and the two are separated.
    const ok = strongWin >= 0.30 && strongWin <= 0.85
      && weakWin < strongWin
      && weakRemoved >= 0.30 && weakRemoved <= 0.70;
    const spread = strongWin - weakWin;
    scored.push({ key, hp, ap, strongWin, weakWin, weakRemoved, strongSecs, spread, ok });
    console.log(
      `hp x${hp.toFixed(2)} ap x${ap.toFixed(2)}`.padEnd(16) +
      `${(strongWin * 100).toFixed(0)}% win`.padStart(14) +
      `${(weakWin * 100).toFixed(0)}% win / ${(weakRemoved * 100).toFixed(0)}% in`.padStart(19) +
      `${(spread * 100).toFixed(0)}pp`.padStart(9) + '   ' + (ok ? 'MEETS TARGET' : ''),
    );
  }
}

const winners = scored.filter((s) => s.ok)
  // The smallest change that works, as the brief asks: least total deviation from x1.
  .sort((a, b) => ((1 - a.hp) + (1 - a.ap)) - ((1 - b.hp) + (1 - b.ap)));

console.log('\n=== smallest change that meets the target ===');
if (!winners.length) {
  console.log('No cell in this matrix meets it. The fight needs more than HP/AP scaling');
  console.log('-- see the zone 80-100 ramp test (tools/p2-ramp.mjs).');
} else {
  for (const w of winners.slice(0, 4)) {
    console.log(
      `  King HP x${w.hp.toFixed(2)}, AP x${w.ap.toFixed(2)}  ->  ` +
      `strong ${(w.strongWin * 100).toFixed(0)}% per attempt, weak ${(w.weakWin * 100).toFixed(0)}% ` +
      `(reaching ${(w.weakRemoved * 100).toFixed(0)}%), median ${w.strongSecs.toFixed(0)}s`,
    );
  }
}

fs.writeFileSync('tools/.p2-king.json', JSON.stringify({ grid, scored }, null, 1));
console.log('\nmatrix written to tools/.p2-king.json');
