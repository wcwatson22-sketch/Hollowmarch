// Phase 3 / test 4: does the new crit and haste curve actually change a character?
//
// The paper case was made in Phase 2 and it is not enough on its own -- a curve that
// looks better in a spreadsheet can easily do nothing in a fight, because crit only
// pays through critDmg, haste only pays through swing time, cooldowns and tick counts,
// and both are gated by what the rest of the build is doing. So this measures the same
// six levels through the real combat loop, and it measures the interactions the brief
// asks for separately: with talents, with a companion, with damage-over-time effects,
// and with a cooldown-heavy kit.
//
//   node tools/p3-secondary.mjs [trials]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, suggestedBuild } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent } from '../js/data/talents.js';
import { computeStats, ratingToPct, CRIT_CAP, HASTE_CAP } from '../js/systems/stats.js';
import { mulberry32, median, STEP } from './p2-common.mjs';

const TRIALS = Number(process.argv[2] || 8);
const WINDOW = 90;
const LEVELS = [10, 20, 30, 40, 50, 60];

const ZONE_FOR_LEVEL = { 5: 3, 10: 7, 15: 14, 20: 22, 25: 31, 30: 40, 35: 50, 40: 58, 45: 68, 50: 76, 55: 86, 60: 94 };
function zoneFor(L) {
  const k = Object.keys(ZONE_FOR_LEVEL).map(Number).sort((a, b) => a - b);
  if (L <= k[0]) return Math.max(1, Math.round(L * 0.6));
  for (let i = 1; i < k.length; i++) if (L <= k[i]) {
    const a = k[i - 1], b = k[i], f = (L - a) / (b - a);
    return Math.round(ZONE_FOR_LEVEL[a] + (ZONE_FOR_LEVEL[b] - ZONE_FOR_LEVEL[a]) * f);
  }
  return 94;
}

// Rating a real character carries, measured from the Phase 1/2 marches.
const TYPICAL = { 10: 90, 20: 260, 30: 520, 40: 900, 50: 1500, 60: 2300 };
const BIS = { 10: 150, 20: 450, 30: 950, 40: 1700, 50: 2900, 60: 4600 };

/**
 * A character at a level, optionally with extra rating bolted on.
 *
 * The extra rating is added AFTER gear so it is a clean single-variable change -- the
 * alternative, rolling gear until it happens to carry more crit, changes item level and
 * every other affix at the same time.
 */
function character(classId, level, solo, seed, { crit = 0, haste = 0, talentMode = 'default' } = {}) {
  setLootRng(mulberry32(seed));
  const s = newSave(classId, 'S');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  const b = suggestedBuild(classId, level, solo);
  for (const a of CLASSES[classId].abilities) s.abilityToggles[a.id] = b.kit.includes(a.id);

  const tree = TALENTS[classId].filter((t) => !(solo && isPetTalent(t))).filter((t) => level >= (t.req || 0));
  let ordered = tree;
  if (talentMode === 'crit') {
    ordered = [...tree].sort((a, z) => ((z.per?.crit ? 10 : 0) + (z.per?.critDmg ? 8 : 0) + (z.per?.dotCrit ? 5 : 0))
      - ((a.per?.crit ? 10 : 0) + (a.per?.critDmg ? 8 : 0) + (a.per?.dotCrit ? 5 : 0)));
  } else if (talentMode === 'haste') {
    ordered = [...tree].sort((a, z) => ((z.per?.haste ? 10 : 0) + (z.per?.petHaste ? 5 : 0))
      - ((a.per?.haste ? 10 : 0) + (a.per?.petHaste ? 5 : 0)));
  }
  let pts = earnedTalentPoints(level); s.talents = {};
  for (const t of ordered) {
    while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; }
    if (pts <= 0) break;
  }

  const zone = zoneFor(level);
  s.zone = zone; s.checkpoint = zone;
  for (const slot of Object.keys(s.equipped)) {
    let best = null;
    for (const z of [Math.max(1, Math.round(zone * 0.6)), zone]) {
      for (let i = 0; i < 12; i++) {
        const d = rollDrop(classId, z, i % 6 === 0, { solo, level });
        if (d && d.slot === slot && (!best || itemScore(d) > itemScore(best))) best = d;
      }
    }
    if (best) s.equipped[slot] = best;
  }
  s.__extraCrit = crit; s.__extraHaste = haste;
  return s;
}

/** Damage over a fixed window, with the extra rating injected into the live stats. */
function fight(save, seed) {
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(save, () => {});
  if (save.__extraCrit || save.__extraHaste) {
    const st = enc.stats;
    const lvl = save.level;
    if (save.__extraCrit) {
      st.crit = Math.min(0.95, st.baseCrit + ratingToPct(st.critRating + save.__extraCrit, lvl, CRIT_CAP));
    }
    if (save.__extraHaste) {
      st.haste = st.baseHaste + ratingToPct(st.hasteRating + save.__extraHaste, lvl, HASTE_CAP);
      enc.player.swingTime = CLASSES[save.classId].swingTime / (1 + st.haste);
    }
  }
  let dealt = 0, t = 0;
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (a, ...rest) => { dealt += a; real(a, ...rest); };
  while (t < WINDOW) {
    const r = enc.tick(STEP);
    t += STEP;
    if (r === 'win') { enc.reset(); enc.spawn(); }
    else if (r === 'lose') { enc.revive(); enc.spawn(); }
  }
  return dealt / WINDOW;
}

const avg = (classId, level, solo, opts) => {
  let d = 0;
  for (let k = 0; k < TRIALS; k++) d += fight(character(classId, level, solo, 4400 + level * 31 + k * 197, opts), 8800 + k * 53);
  return d / TRIALS;
};

console.log(`crit cap ${CRIT_CAP}, haste cap ${HASTE_CAP}\n`);

console.log('=== 1. the curve, at the rating a real character carries ===');
console.log('level   crit typ/BiS    gap   +100 rating   haste typ/BiS    gap   +100 rating');
for (const L of LEVELS) {
  const ct = ratingToPct(TYPICAL[L], L, CRIT_CAP), cb = ratingToPct(BIS[L], L, CRIT_CAP);
  const ht = ratingToPct(TYPICAL[L], L, HASTE_CAP), hb = ratingToPct(BIS[L], L, HASTE_CAP);
  const cm = ratingToPct(BIS[L] + 100, L, CRIT_CAP) - cb;
  const hm = ratingToPct(BIS[L] + 100, L, HASTE_CAP) - hb;
  console.log(
    String(L).padStart(5) + `${(ct * 100).toFixed(0)}/${(cb * 100).toFixed(0)}%`.padStart(13) +
    `${((cb - ct) * 100).toFixed(1)}pp`.padStart(8) + `${(cm * 100).toFixed(2)}pp`.padStart(14) +
    `${(ht * 100).toFixed(0)}/${(hb * 100).toFixed(0)}%`.padStart(16) +
    `${((hb - ht) * 100).toFixed(1)}pp`.padStart(8) + `${(hm * 100).toFixed(2)}pp`.padStart(14),
  );
}

console.log('\n=== 2. real combat: what +400 rating is worth, by level ===');
console.log('Measured through the combat loop, not the model. 400 is roughly one good affix.\n');
console.log('class          lvl    base dps   +400 crit   +400 haste');
for (const [cls, solo] of [['warrior', false], ['hunter', false], ['priest', false], ['warlock', true]]) {
  for (const L of LEVELS) {
    const base = avg(cls, L, solo, {});
    const c = avg(cls, L, solo, { crit: 400 });
    const h = avg(cls, L, solo, { haste: 400 });
    console.log(
      (cls + (CLASSES[cls].companion ? (solo ? ' solo' : ' pet') : '')).padEnd(15) +
      String(L).padStart(3) + base.toFixed(0).padStart(12) +
      `${(((c / base) - 1) * 100).toFixed(1)}%`.padStart(12) +
      `${(((h / base) - 1) * 100).toFixed(1)}%`.padStart(13),
    );
  }
}

console.log('\n=== 3. interactions: does the stat pay differently by build shape? ===');
console.log('Same +400 rating, four different characters at level 60.\n');
console.log('context                       +400 crit   +400 haste');
const CONTEXTS = [
  ['warrior, default talents', 'warrior', false, {}],
  ['warrior, crit-first talents', 'warrior', false, { talentMode: 'crit' }],
  ['warrior, haste-first talents', 'warrior', false, { talentMode: 'haste' }],
  ['warlock solo (dot-heavy)', 'warlock', true, {}],
  ['warlock pet (companion)', 'warlock', false, {}],
  ['priest pet (companion)', 'priest', false, {}],
  ['hunter pet (companion)', 'hunter', false, {}],
];
for (const [label, cls, solo, opts] of CONTEXTS) {
  const base = avg(cls, 60, solo, opts);
  const c = avg(cls, 60, solo, { ...opts, crit: 400 });
  const h = avg(cls, 60, solo, { ...opts, haste: 400 });
  console.log(
    label.padEnd(30) + `${(((c / base) - 1) * 100).toFixed(1)}%`.padStart(10) +
    `${(((h / base) - 1) * 100).toFixed(1)}%`.padStart(13),
  );
}

console.log('\n=== 4. is extreme crit or haste trivially reachable? ===');
console.log('The cap is only a ceiling if gear can push a character into it.\n');
console.log('level   BiS crit   BiS haste   2x BiS crit   2x BiS haste');
for (const L of LEVELS) {
  console.log(
    String(L).padStart(5) +
    `${(ratingToPct(BIS[L], L, CRIT_CAP) * 100).toFixed(0)}%`.padStart(11) +
    `${(ratingToPct(BIS[L], L, HASTE_CAP) * 100).toFixed(0)}%`.padStart(12) +
    `${(ratingToPct(BIS[L] * 2, L, CRIT_CAP) * 100).toFixed(0)}%`.padStart(14) +
    `${(ratingToPct(BIS[L] * 2, L, HASTE_CAP) * 100).toFixed(0)}%`.padStart(15),
  );
}
