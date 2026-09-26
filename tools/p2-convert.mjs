// Phase 2 / test 3b: trace Blessed Blade and Fel Fire to the exact line.
//
// Phase 1 called these "double-dipping through the item budget". That was a guess and
// this checks it against the code path, which is combat.js:
//
//   const typeMult = Math.max(typeDmg[petType], typeDmg.physical);
//   const { dmg } = this.roll(this.companion.ap * typeMult, { mult });
//
// It is a max(), not a product, so nothing is counted twice. The question is what the
// two sides of that max() actually hold for a character who has bought the talent.
//
//   node tools/p2-convert.mjs

import { newSave } from '../js/systems/save.js';
import { computeStats, computeCompanion } from '../js/systems/stats.js';
import { CLASSES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, talentMods } from '../js/data/talents.js';

const CASES = [
  { cls: 'priest',  talent: 'blessedblade', type: 'holy',   branch: 'Faith' },
  { cls: 'warlock', talent: 'felfire',      type: 'fire',   branch: 'Demonology' },
  { cls: 'hunter',  talent: 'venombite',    type: 'poison', branch: 'Pack' },
];

/** A level-60 pet character whose points chase the branch the conversion lives in. */
function build(clsId, branch, withTalent, talentId, level = 60) {
  const s = newSave(clsId, 'C');
  s.level = level;
  s.petChoice = 'pet';
  const tree = TALENTS[clsId].filter((t) => level >= (t.req || 0));
  // Branch talents first -- a player who takes the conversion is the player who has
  // been stacking that damage school all game.
  const ordered = [...tree].sort((a, b) => {
    const s2 = (t) => (t.branch === branch ? 2 : 0) + (t.per?.[CASES.find((c) => c.cls === clsId).type + 'Dmg'] ? 3 : 0);
    return s2(b) - s2(a);
  });
  let pts = earnedTalentPoints(level);
  s.talents = {};
  if (withTalent) { s.talents[talentId] = 1; pts--; }
  for (const t of ordered) {
    if (t.id === talentId) continue;
    while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; }
    if (pts <= 0) break;
  }
  return s;
}

for (const c of CASES) {
  const tal = TALENTS[c.cls].find((t) => t.id === c.talent);
  console.log(`\n=== ${tal.name} (${c.cls}, ${c.branch} branch, max rank ${tal.max}) ===`);
  console.log(`    per: ${JSON.stringify(tal.per)}`);

  const off = build(c.cls, c.branch, false, c.talent);
  const on = build(c.cls, c.branch, true, c.talent);
  const so = computeStats(off), sn = computeStats(on);
  const co = computeCompanion(off, so), cn = computeCompanion(on, sn);

  const multOf = (st) => Math.max(st.typeDmg[st.petType || 'physical'] || 1, st.typeDmg.physical || 1);

  console.log(`  without: petType='${so.petType || 'physical'}'  typeDmg.${c.type}=${(so.typeDmg[c.type]).toFixed(3)}  typeDmg.physical=${so.typeDmg.physical.toFixed(3)}  -> max()=${multOf(so).toFixed(3)}`);
  console.log(`  with   : petType='${sn.petType || 'physical'}'  typeDmg.${c.type}=${(sn.typeDmg[c.type]).toFixed(3)}  typeDmg.physical=${sn.typeDmg.physical.toFixed(3)}  -> max()=${multOf(sn).toFixed(3)}`);
  console.log(`  companion attack power: ${co.ap.toFixed(0)} -> ${cn.ap.toFixed(0)}`);
  console.log(`  pet damage per swing  : ${(co.ap * multOf(so)).toFixed(0)} -> ${(cn.ap * multOf(sn)).toFixed(0)}   (${(((cn.ap * multOf(sn)) / (co.ap * multOf(so))) - 1) * 100 >= 0 ? '+' : ''}${((((cn.ap * multOf(sn)) / (co.ap * multOf(so))) - 1) * 100).toFixed(1)}%)`);
  console.log(`  ONE point buys the whole of the ${c.type} investment, applied to the pet.`);

  // How the payoff scales with how much of that school you already own.
  console.log(`\n  what the single point is worth at different levels of ${c.type} investment:`);
  console.log('    ranks in school   typeDmg   pet damage multiplier   value of the conversion');
  const schoolTalents = TALENTS[c.cls].filter((t) => t.per?.[c.type + 'Dmg']);
  for (const ranks of [0, 1, 2, 3, 5]) {
    const s2 = newSave(c.cls, 'X'); s2.level = 60; s2.petChoice = 'pet';
    s2.talents = { [c.talent]: 1 };
    for (const t of schoolTalents) s2.talents[t.id] = Math.min(t.max, ranks);
    const st2 = computeStats(s2);
    const withConv = Math.max(st2.typeDmg[c.type], st2.typeDmg.physical);
    const withoutConv = st2.typeDmg.physical;
    console.log(
      `    ${String(ranks).padStart(2)} per talent      ` +
      st2.typeDmg[c.type].toFixed(3).padStart(7) +
      withConv.toFixed(3).padStart(24) +
      `${(((withConv / withoutConv) - 1) * 100).toFixed(1)}%`.padStart(25),
    );
  }
}

console.log('\n\n=== verdict ===');
console.log('Not double-dipping: the code takes max(converted, physical), so the two are');
console.log('never multiplied together. What one point buys is the RIGHT TO APPLY an');
console.log('investment the character already owns to a damage source that was excluded');
console.log('from it. Its value is therefore not a number in the talent -- it is however');
console.log('much damage-school bonus the rest of the build has accumulated, which is why');
console.log('it measures at +28-32% and why no coefficient tweak can control it.');
