// What is each ability actually worth, measured in a real fight?
//
// estimateDps is an analytical model and it is what the gear verdicts read off, so it is
// the wrong thing to audit abilities with -- an ability the model misprices would be
// mispriced identically here. This runs the actual combat loop instead: the class's best
// three-ability kit, then the same kit with one ability swapped for the candidate, and
// reports the change in damage dealt and in damage taken over a fixed window.
//
// An ability is a problem if it is in every good kit (nothing else competes) or in none
// (it is a row that exists to be scrolled past).
//
//   node tools/abilities.mjs [class] [level]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES, suggestedKit } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent } from '../js/data/talents.js';
import { mobHp } from '../js/data/mobs.js';

const ONLY = process.argv[2] || null;
const LEVELS = process.argv[3] ? [Number(process.argv[3])] : [25, 45, 60];
const TRIALS = 14;          // gear rolls per measurement
const WINDOW = 120;         // seconds of fighting per trial
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

function character(classId, level, solo, seed) {
  setLootRng(mulberry32(seed));
  const s = newSave(classId, 'A');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  const tree = TALENTS[classId].filter((t) => !(solo && isPetTalent(t)));
  const order = solo ? tree : tree.filter(isPetTalent).concat(tree);
  let pts = earnedTalentPoints(level);
  s.talents = {};
  for (const t of order) {
    while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; }
    if (pts <= 0) break;
  }
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

/** Damage dealt and taken over a fixed window, against trash that respawns forever. */
function fight(save, seed) {
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(save, () => {});
  let dealt = 0, taken = 0, kills = 0;
  const realEnemy = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (amount, ...rest) => { dealt += amount; realEnemy(amount, ...rest); };
  const realPlayer = enc.damagePlayer ? enc.damagePlayer.bind(enc) : null;
  let t = 0;
  let hpBefore = enc.player.hp;
  while (t < WINDOW) {
    const r = enc.tick(STEP);
    t += STEP;
    if (enc.player.hp < hpBefore) taken += hpBefore - enc.player.hp;
    hpBefore = enc.player.hp;
    if (r === 'win') { kills++; enc.reset(); enc.spawn(); hpBefore = enc.player.hp; }
    else if (r === 'lose') { enc.revive(); enc.spawn(); hpBefore = enc.player.hp; }
  }
  return { dps: dealt / WINDOW, taken: taken / WINDOW, kills };
}

function setKit(save, ids) {
  for (const a of CLASSES[save.classId].abilities) save.abilityToggles[a.id] = ids.includes(a.id);
}

const classes = ONLY ? [ONLY] : ['warrior', 'hunter', 'priest', 'warlock'];

for (const classId of classes) {
  const modes = CLASSES[classId].companion ? [false, true] : [false];
  for (const solo of modes) {
    const label = classId + (CLASSES[classId].companion ? (solo ? ' (solo)' : ' (pet)') : '');
    console.log(`\n=== ${label} ===`);
    console.log('ability              unlock   dps swapped in   vs baseline   damage taken   verdict');

    for (const level of LEVELS) {
      const pool = CLASSES[classId].abilities.filter((a) => a.unlock <= level);
      if (pool.length <= MAX_ACTIVE_ABILITIES) continue;

      // Baseline: what the class would take on its own.
      const baseKit = suggestedKit(classId, level, solo);
      const rows = [];
      let baseDps = 0, baseTaken = 0;

      for (let k = 0; k < TRIALS; k++) {
        const s = character(classId, level, solo, 700 + level * 13 + k * 211);
        setKit(s, baseKit);
        const r = fight(s, 3000 + k * 17);
        baseDps += r.dps; baseTaken += r.taken;
      }
      baseDps /= TRIALS; baseTaken /= TRIALS;

      for (const cand of pool) {
        // Swap the candidate in for the weakest member of the baseline kit it is not
        // already part of, so every ability is measured against the same opportunity.
        const kit = baseKit.includes(cand.id)
          ? baseKit.slice()
          : [...baseKit.slice(0, MAX_ACTIVE_ABILITIES - 1), cand.id];
        let dps = 0, taken = 0;
        for (let k = 0; k < TRIALS; k++) {
          const s = character(classId, level, solo, 700 + level * 13 + k * 211);
          setKit(s, kit);
          const r = fight(s, 3000 + k * 17);
          dps += r.dps; taken += r.taken;
        }
        dps /= TRIALS; taken /= TRIALS;
        rows.push({ cand, dps, taken, delta: dps / Math.max(1, baseDps) - 1, inKit: baseKit.includes(cand.id) });
      }

      console.log(`  -- level ${level} (baseline kit: ${baseKit.join(', ')}) --`);
      rows.sort((a, b) => b.dps - a.dps);
      for (const r of rows) {
        const pct = (r.delta * 100);
        const verdict =
          r.inKit && pct > -1 ? 'core'
          : pct > 3 ? 'STRONGER than the kit it replaced'
          : pct < -18 ? 'DEAD WEIGHT'
          : pct < -8 ? 'weak'
          : 'competitive';
        console.log(
          '  ' + r.cand.name.padEnd(21) + String(r.cand.unlock).padStart(4) +
          r.dps.toFixed(0).padStart(16) +
          (pct >= 0 ? '+' : '') + pct.toFixed(1).padStart(12) + '%' +
          r.taken.toFixed(0).padStart(14) + '   ' + verdict
        );
      }
    }
  }
}
