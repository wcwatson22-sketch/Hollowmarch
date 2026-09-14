// What is one point of item budget actually worth, per stat?
//
// A pet build was better off stacking raw Spell Power than Bond, because the companion's
// attack power is a multiple of YOUR power -- so power paid twice (you and the pet) while
// Bond paid once. A build's signature stat being strictly worse than the generic one is
// the kind of thing you cannot see by reading the numbers; you have to price them.
//
// Every stat is converted at its own `per` rate from the SAME amount of item budget and
// priced in marginal DPS, so the columns are directly comparable.
//
//   node tools/statvalue.mjs [budget]

import { computeStats, estimateDps } from '../js/systems/stats.js';
import { newSave } from '../js/systems/save.js';
import { CLASSES, suggestedKit } from '../js/data/classes.js';
import { AFFIXES } from '../js/data/affixes.js';
import { TALENTS, earnedTalentPoints } from '../js/data/talents.js';

const BUDGET = Number(process.argv[2] || 60);
const LEVELS = [10, 30, 60];
const PET_CLASSES = ['hunter', 'priest', 'warlock'];

/** A character of the given level with a plausible kit and its talents spent. */
function build(classId, level, solo, petBranch) {
  const s = newSave(classId, 'Value');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  for (const a of CLASSES[classId].abilities) s.abilityToggles[a.id] = false;
  for (const id of suggestedKit(classId, level)) s.abilityToggles[id] = true;

  // Spend every point in the pet branch when asked, so the comparison is made by the
  // build that actually cares about the answer.
  const tree = TALENTS[classId];
  let points = earnedTalentPoints(level);
  const order = petBranch
    ? tree.filter((t) => t.per.petPow || t.per.petHp || t.per.petArmor).concat(tree)
    : tree;
  s.talents = {};
  for (const t of order) {
    while (points > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; points--; }
    if (points <= 0) break;
  }
  return s;
}

/** Marginal DPS from spending `BUDGET` of item budget on one affix. */
function value(save, affix) {
  const before = estimateDps(save);
  const bonus = { ...(save.bonusStats || {}) };
  const probe = { ...save, bonusStats: bonus };
  // Equipped items are the only stat source computeStats reads, so add a probe piece.
  const slot = 'ring';
  const held = save.equipped[slot];
  probe.equipped = { ...save.equipped, [slot]: {
    name: 'Probe', slot, ilvl: 1, rarity: 'common',
    affixes: [{ stat: affix.stat, value: affix.per * BUDGET }],
    ...(held ? {} : {}),
  } };
  // Compare like with like: the probe replaces whatever was in the slot in BOTH runs.
  const baseline = { ...save, equipped: { ...save.equipped, [slot]: {
    name: 'Empty', slot, ilvl: 1, rarity: 'common', affixes: [],
  } } };
  return estimateDps(probe) - estimateDps(baseline);
}

const NAMES = { sp: 'Spell Power', ap: 'Attack Power', critRating: 'Crit', hasteRating: 'Haste', petPow: 'Bond', abilityPct: 'Potency' };
const SHOW = ['sp', 'ap', 'critRating', 'hasteRating', 'petPow'];

console.log(`marginal DPS from ${BUDGET} points of item budget, by stat\n`);

for (const classId of PET_CLASSES) {
  console.log(`--- ${classId} ---`);
  console.log('  build            ' + SHOW.map((k) => NAMES[k].padStart(13)).join(''));
  for (const level of LEVELS) {
    for (const [label, solo, petBranch] of [['pet, pet talents', false, true], ['solo', true, false]]) {
      if (solo && !CLASSES[classId].companion) continue;
      const save = build(classId, level, solo, petBranch);
      const primary = CLASSES[classId].primary;
      const row = SHOW.map((stat) => {
        const affix = AFFIXES.find((a) => a.stat === stat);
        if (!affix) return ''.padStart(13);
        // Power comes in one flavour per class; showing the other is noise.
        if ((stat === 'sp' && primary !== 'sp') || (stat === 'ap' && primary !== 'ap')) return '-'.padStart(13);
        if (stat === 'petPow' && solo) return '-'.padStart(13);
        return value(save, affix).toFixed(1).padStart(13);
      });
      console.log(`  lv${String(level).padEnd(2)} ${label.padEnd(12)}` + row.join(''));
    }
  }
  console.log('');
}
