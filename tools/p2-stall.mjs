// Phase 2 / test 9: why do basic-attack builds stall for five minutes at zones 21-41?
//
// Phase 1 recorded every multi-minute no-kill gap in the study as a basic-attack build
// in that band. The candidates are enemy health scaling, the auto-attack coefficient,
// haste, the autoDmg talents, or gear -- and they are separable, because an auto-attack
// is a closed formula:
//
//   dps = power * autoCoef * autoDmg * critMult / swingTime
//
// against mobHp(zone). This walks both sides of that across the whole game.
//
//   node tools/p2-stall.mjs

import { newSave } from '../js/systems/save.js';
import { computeStats } from '../js/systems/stats.js';
import { CLASSES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints } from '../js/data/talents.js';
import { mobHp, mobAp } from '../js/data/mobs.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { mulberry32 } from './p2-common.mjs';

const ZONE_FOR_LEVEL = { 5: 3, 10: 7, 15: 14, 20: 22, 25: 31, 30: 40, 35: 50, 40: 58, 45: 68, 50: 76, 55: 86, 60: 94 };
const zoneFor = (L) => {
  const k = Object.keys(ZONE_FOR_LEVEL).map(Number).sort((a, b) => a - b);
  if (L <= k[0]) return Math.max(1, Math.round(L * 0.6));
  for (let i = 1; i < k.length; i++) if (L <= k[i]) {
    const a = k[i - 1], b = k[i], f = (L - a) / (b - a);
    return Math.round(ZONE_FOR_LEVEL[a] + (ZONE_FOR_LEVEL[b] - ZONE_FOR_LEVEL[a]) * f);
  }
  return 94;
};

/** A character whose points all went into the auto-attack talents. */
function autoChar(classId, level, seed) {
  setLootRng(mulberry32(seed));
  const s = newSave(classId, 'A');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? 'solo' : null;
  const tree = TALENTS[classId].filter((t) => level >= (t.req || 0));
  const ordered = [...tree].sort((a, b) => ((b.per?.autoDmg ? 10 : 0) + (b.per?.haste ? 5 : 0) + (b.per?.crit ? 3 : 0))
    - ((a.per?.autoDmg ? 10 : 0) + (a.per?.haste ? 5 : 0) + (a.per?.crit ? 3 : 0)));
  let pts = earnedTalentPoints(level); s.talents = {};
  for (const t of ordered) {
    while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; }
    if (pts <= 0) break;
  }
  const zone = zoneFor(level);
  s.zone = zone;
  for (const slot of Object.keys(s.equipped)) {
    let best = null;
    for (let i = 0; i < 18; i++) {
      const d = rollDrop(classId, zone, i % 7 === 0, { solo: true, level });
      if (d && d.slot === slot && (!best || itemScore(d) > itemScore(best))) best = d;
    }
    if (best) s.equipped[slot] = best;
  }
  return s;
}

console.log('=== the auto-attack against the health bar it has to chew through ===');
console.log('"swings" is how many auto-attacks one ordinary mob takes. Ten mobs per zone.\n');
console.log('class    lvl  zone   power  autoCoef  autoDmg  swing   auto dps   mob hp   swings   sec/mob');
for (const cls of ['warrior', 'hunter', 'priest', 'warlock']) {
  for (const L of [10, 20, 25, 30, 35, 40, 50, 60]) {
    const s = autoChar(cls, L, 900 + L);
    const st = computeStats(s);
    const c = CLASSES[cls];
    const critMult = 1 + st.crit * (st.critDmg - 1);
    const dps = (st.power * c.autoCoef * st.autoDmg * critMult) / Math.max(0.1, st.swingTime);
    const z = zoneFor(L);
    const hp = mobHp(z);
    const perSwing = st.power * c.autoCoef * st.autoDmg * critMult;
    console.log(
      cls.padEnd(9) + String(L).padStart(3) + String(z).padStart(6) +
      st.power.toFixed(0).padStart(8) + c.autoCoef.toFixed(2).padStart(10) +
      st.autoDmg.toFixed(2).padStart(9) + st.swingTime.toFixed(2).padStart(7) +
      dps.toFixed(0).padStart(11) + Math.round(hp).toString().padStart(9) +
      (hp / perSwing).toFixed(1).padStart(9) + (hp / dps).toFixed(0).padStart(10) + 's',
    );
  }
  console.log('');
}

console.log('=== where the two curves diverge ===');
console.log('Both indexed to their level-10 value, so the gap is the whole story.\n');
console.log('lvl  zone   auto dps (indexed)   mob hp (indexed)   ratio   seconds per mob');
const base = {};
for (const L of [10, 20, 25, 30, 35, 40, 50, 60]) {
  const s = autoChar('warrior', L, 900 + L);
  const st = computeStats(s);
  const c = CLASSES.warrior;
  const critMult = 1 + st.crit * (st.critDmg - 1);
  const dps = (st.power * c.autoCoef * st.autoDmg * critMult) / Math.max(0.1, st.swingTime);
  const z = zoneFor(L);
  const hp = mobHp(z);
  if (L === 10) { base.dps = dps; base.hp = hp; }
  console.log(
    String(L).padStart(3) + String(z).padStart(6) + (dps / base.dps).toFixed(1).padStart(18) + 'x' +
    (hp / base.hp).toFixed(1).padStart(18) + 'x' +
    ((dps / base.dps) / (hp / base.hp)).toFixed(2).padStart(8) + (hp / dps).toFixed(0).padStart(16) + 's',
  );
}

console.log('\n=== what the autoDmg talents are actually worth ===');
console.log('Five ranks at 0.06 each. A zone is ten mobs.\n');
console.log('ranks   autoDmg   sec/mob at zone 31   sec/zone   vs no ranks');
{
  const s = autoChar('warrior', 25, 925);
  const st0 = computeStats(s);
  const c = CLASSES.warrior;
  const critMult = 1 + st0.crit * (st0.critDmg - 1);
  const hp = mobHp(31);
  for (const r of [0, 1, 2, 3, 4, 5]) {
    const mult = 1 + 0.06 * r;
    const dps = (st0.power * c.autoCoef * mult * critMult) / Math.max(0.1, st0.swingTime);
    const sec = hp / dps;
    const base0 = hp / ((st0.power * c.autoCoef * 1 * critMult) / Math.max(0.1, st0.swingTime));
    console.log(
      String(r).padStart(5) + mult.toFixed(2).padStart(10) + sec.toFixed(0).padStart(21) + 's' +
      (sec * 10 / 60).toFixed(1).padStart(11) + ' min' +
      (r ? `${(((base0 / sec) - 1) * 100).toFixed(0)}% faster` : '-').padStart(15),
    );
  }
}
