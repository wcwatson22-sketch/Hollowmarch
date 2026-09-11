// What do crit and haste actually come out at, with level-appropriate gear?
//
// Percentages are not designed by picking a conversion constant and hoping. This walks
// a realistically geared character up the level range and reports where the curve
// actually lands, so the caps and K can be fitted to intended breakpoints instead of
// guessed at.
//
//   node tools/ratings.mjs

import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { computeStats, ratingToPct, CRIT_CAP, HASTE_CAP } from '../js/systems/stats.js';
import { autoSlot, CLASSES } from '../js/data/classes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Roughly where the XP curve puts you: the balance runs land near zone ~1.4x level.
const zoneFor = (level) => Math.max(1, Math.round(level * 1.4));

function geared(classId, level, { best = false } = {}) {
  const s = newSave(classId, 'R');
  s.level = level;
  autoSlot(s);
  const zone = zoneFor(level);
  // `best` models a player who farmed for the stats they want rather than wearing
  // whatever fell out -- the endgame case the caps have to survive.
  const tries = best ? 700 : 140;
  for (let i = 0; i < tries; i++) {
    const it = rollDrop(classId, zone, best);
    if (!it) continue;
    const cur = s.equipped[it.slot];
    const score = best
      ? (it.affixes || []).reduce((a, x) => a + (x.id === 'crit' || x.id === 'haste' ? x.value * 3 : 0), 0) + itemScore(it) * 0.15
      : itemScore(it);
    const curScore = !cur ? -1 : (best
      ? (cur.affixes || []).reduce((a, x) => a + (x.id === 'crit' || x.id === 'haste' ? x.value * 3 : 0), 0) + itemScore(cur) * 0.15
      : itemScore(cur));
    if (score > curScore) s.equipped[it.slot] = it;
  }
  if (level >= TALENT_UNLOCK_LEVEL) {
    const tree = TALENTS[classId];
    for (let i = 0; i < level - TALENT_UNLOCK_LEVEL + 1; i++) {
      const t = tree[i % tree.length];
      const cur = s.talents[t.id] || 0;
      if (cur < t.max) s.talents[t.id] = cur + 1;
    }
  }
  return s;
}

const LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 60];
console.log(`caps: crit ${(CRIT_CAP * 100).toFixed(0)}%  haste ${(HASTE_CAP * 100).toFixed(0)}%\n`);
console.log('lvl  zone |      typical gear       |     best-in-slot farmed');
console.log('           critR  crit   hasteR haste |  critR  crit   hasteR haste');
for (const lvl of LEVELS) {
  const row = [];
  for (const best of [false, true]) {
    let cR = 0, hR = 0, c = 0, h = 0;
    for (let n = 0; n < 6; n++) {
      setLootRng(mulberry32(lvl * 100 + n + (best ? 5000 : 0)));
      const st = computeStats(geared('warrior', lvl, { best }));
      cR += st.critRating; hR += st.hasteRating; c += st.crit; h += st.haste;
    }
    row.push({ cR: cR / 6, hR: hR / 6, c: c / 6, h: h / 6 });
  }
  const f = (o) =>
    String(Math.round(o.cR)).padStart(6) + (o.c * 100).toFixed(1).padStart(6) + '%' +
    String(Math.round(o.hR)).padStart(7) + (o.h * 100).toFixed(1).padStart(6) + '%';
  console.log(String(lvl).padStart(3) + String(zoneFor(lvl)).padStart(6) + ' |' + f(row[0]) + ' |' + f(row[1]));
}
