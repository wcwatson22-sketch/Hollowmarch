// What is a talent point worth, talent by talent, measured in a real fight?
//
// The same argument as tools/abilities.mjs: estimateDps is the model the gear verdicts
// are read off, so auditing talents with it would only confirm the model agrees with
// itself. This spends the points and runs the combat loop.
//
// Method: a character of the given level, all its points spent in a fixed reference
// order, is the baseline. For each talent, the same character spends its points putting
// that talent to maximum FIRST and the reference order after, so both characters have
// exactly the same number of points. The difference is what prioritising that talent buys.
//
// A talent is a problem if it does nothing (nobody would take it) or if it doubles you
// (nobody would take anything else).
//
//   node tools/talentvalue.mjs [class]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, suggestedKit } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, DEEP_TALENT_LEVEL } from '../js/data/talents.js';

const ONLY = process.argv[2] || null;
const LEVEL = Number(process.argv[3] || 60);
const TRIALS = 12;
const WINDOW = 120;
const STEP = 0.1;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function gear(classId, level, solo, seed) {
  setLootRng(mulberry32(seed));
  const s = newSave(classId, 'T');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  const keep = new Set(suggestedKit(classId, level, solo));
  for (const a of CLASSES[classId].abilities) s.abilityToggles[a.id] = keep.has(a.id);
  const zone = Math.max(1, Math.round(level * 1.4));
  for (const slot of Object.keys(s.equipped)) {
    let best = null;
    for (let i = 0; i < 20; i++) {
      const d = rollDrop(classId, zone, false, { solo, level });
      if (d && d.slot === slot && (!best || itemScore(d) > itemScore(best))) best = d;
    }
    if (best) s.equipped[slot] = best;
  }
  return s;
}

/** Spend `points` down `order`, filling each talent to its maximum before moving on. */
function spend(order, points) {
  const out = {};
  for (const t of order) {
    while (points > 0 && (out[t.id] || 0) < t.max) { out[t.id] = (out[t.id] || 0) + 1; points--; }
    if (points <= 0) break;
  }
  return out;
}

function fight(save, seed) {
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(save, () => {});
  let dealt = 0, taken = 0;
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (amount, ...rest) => { dealt += amount; real(amount, ...rest); };
  let t = 0, hp = enc.player.hp;
  while (t < WINDOW) {
    const r = enc.tick(STEP);
    t += STEP;
    if (enc.player.hp < hp) taken += hp - enc.player.hp;
    hp = enc.player.hp;
    if (r === 'win') { enc.reset(); enc.spawn(); hp = enc.player.hp; }
    else if (r === 'lose') { enc.revive(); enc.spawn(); hp = enc.player.hp; }
  }
  return { dps: dealt / WINDOW, taken: taken / WINDOW };
}

const classes = ONLY ? [ONLY] : ['warrior', 'hunter', 'priest', 'warlock'];

for (const classId of classes) {
  const modes = CLASSES[classId].companion ? [false, true] : [false];
  for (const solo of modes) {
    const label = classId + (CLASSES[classId].companion ? (solo ? ' (solo)' : ' (pet)') : '');
    const usable = TALENTS[classId].filter((t) => !(solo && isPetTalent(t)))
      .filter((t) => LEVEL >= (t.req || 0));
    if (!usable.length) continue;
    const points = earnedTalentPoints(LEVEL);

    // Reference order: the tree as written. Every character being compared spends the
    // same number of points, so what moves is only WHERE they went.
    const reference = usable.slice();

    // Every talent is measured against a character with the SAME number of points that
    // does not own it at all. Comparing against a baseline that already includes the
    // talent only asks "does promoting it up the order matter", which at 56 points is
    // almost always no -- both arms had it maxed, and the whole tree read as inert.
    const rows = [];
    let refDps = 0;
    for (const tal of usable) {
      const without = reference.filter((x) => x.id !== tal.id);
      let onDps = 0, onTaken = 0, offDps = 0, offTaken = 0;
      for (let k = 0; k < TRIALS; k++) {
        const a1 = gear(classId, LEVEL, solo, 400 + k * 173);
        a1.talents = spend([tal, ...without], points);
        const r1 = fight(a1, 900 + k * 31);
        onDps += r1.dps; onTaken += r1.taken;

        const a2 = gear(classId, LEVEL, solo, 400 + k * 173);
        a2.talents = spend(without, points);
        const r2 = fight(a2, 900 + k * 31);
        offDps += r2.dps; offTaken += r2.taken;
      }
      onDps /= TRIALS; onTaken /= TRIALS; offDps /= TRIALS; offTaken /= TRIALS;
      refDps = offDps;
      rows.push({
        tal, dps: onDps, taken: onTaken,
        gain: onDps / Math.max(1, offDps) - 1,
        mitigated: offTaken > 0 ? 1 - onTaken / offTaken : 0,
      });
    }
    const baseDps = refDps;
    const baseTaken = rows.length ? rows[0].taken : 0;

    rows.sort((a, b) => b.gain - a.gain);
    console.log(`\n=== ${label}, level ${LEVEL}, ${points} points ===`);
    console.log(`baseline ${baseDps.toFixed(0)} dps, ${baseTaken.toFixed(0)} damage taken/s`);
    console.log('talent                branch        max   dps gain   dmg taken   verdict');
    for (const r of rows) {
      const g = r.gain * 100;
      const mit = r.mitigated * 100;
      const verdict =
        g > 22 ? 'DOMINANT'
        : g > 8 ? 'strong'
        : g > 1.5 ? 'fine'
        : mit > 12 ? 'defensive, pays in survival'
        : g > -1.5 ? 'DOES NOTHING'
        : 'ACTIVELY WORSE';
      console.log(
        '  ' + r.tal.name.padEnd(21) + (r.tal.branch || '').padEnd(13) +
        String(r.tal.max).padStart(4) +
        (g >= 0 ? '+' : '') + g.toFixed(1).padStart(10) + '%' +
        (mit >= 0 ? '-' : '+') + Math.abs(mit).toFixed(0).padStart(10) + '%   ' + verdict
      );
    }
  }
}
