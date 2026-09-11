// Where does each class's damage actually come from?
//
// Reports two builds side by side, because the design intent is that a companion is a
// CHOICE: on a default spread of talents and gear the pet should sit below the owner's
// best ability, and only overtake it when you commit talents and Bond affixes to it.
//
//   node tools/sources.mjs

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES, autoSlot } from '../js/data/classes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';
import { FORMS } from '../js/data/evolution.js';

// Companion ascension level to measure at: 0 = base form, 2 = fully ascended.
const PET_FORM = Number((process.argv.find((a) => a.startsWith('--form=')) || '--form=0').split('=')[1]);

const STEP = 0.1;
const CHECKS = [{ level: 10, zone: 7 }, { level: 18, zone: 13 }, { level: 26, zone: 20 }];
// 'none' = no talents at all, the true floor. 'even' = a normal build that deliberately
// skips companion talents. 'pet' = everything poured into the companion.
const SPECS = ['even', 'pet', 'solo'];
const TRIALS = 8;

/** Deterministic PRNG so every spec faces identical gear luck and crit rolls. */
function mulberry32(s) {
  let a = s >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
let pick = Math.random;
function seed(n) {
  setLootRng(mulberry32(n));
  setCombatRng(mulberry32(n * 7919 + 13));
  pick = mulberry32(n * 104729 + 7);
}

/**
 * Rate an item for a build. itemScore already values Bond (weight 260); a pet build
 * simply values it more highly, so add a moderate premium on top rather than a
 * dominating one. An over-weighted premium here makes the "pet build" equip junk that
 * happens to carry a trace of Bond over genuinely better gear, and then the build
 * measures badly for reasons that have nothing to do with companion tuning.
 */
function scoreFor(item, spec) {
  if (spec !== 'pet') return itemScore(item);
  const bond = item.affixes.filter((a) => a.stat === 'petPow').reduce((s, a) => s + a.value, 0);
  return itemScore(item) + bond * 400;
}

function makeChar(classId, level, gearZone, spec) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  s.petChoice = spec === 'solo' ? 'solo' : 'pet';
  // --form N measures an ascended companion, so the ceiling of a pet build is a
  // measured number rather than an arithmetic guess.
  s.petForm = PET_FORM;

  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(pick() * 4));
    const it = rollDrop(classId, z, false, { solo: spec === 'solo' });
    if (!it) continue;
    const cur = s.equipped[it.slot];
    if (!cur || scoreFor(it, spec) > scoreFor(cur, spec)) s.equipped[it.slot] = it;
  }
  for (let b = 10; b <= gearZone; b += 10) {
    const it = rollDrop(classId, b, true, { solo: spec === 'solo' });
    const cur = s.equipped[it.slot];
    if (!cur || scoreFor(it, spec) > scoreFor(cur, spec)) s.equipped[it.slot] = it;
  }

  if (spec !== 'none' && level >= TALENT_UNLOCK_LEVEL) {
    const points = level - TALENT_UNLOCK_LEVEL + 1;
    const tree = TALENTS[classId];
    // A pet build spends everything it can on companion damage first.
    const order = spec === 'pet'
      ? [...tree].sort((a, b) => (b.per.petPow || 0) - (a.per.petPow || 0))
      : tree.filter((t) => !t.per.petPow && !t.per.petHp && !t.per.petArmor);
    let spent = 0;
    if (spec === 'pet') {
      // Max each companion talent before moving on. Round-robin allocation spread
      // points so thinly that a companion build barely differed from a default one,
      // making the investment look worthless when it had never actually been made.
      for (const t of order) {
        if (level < t.req) continue;
        while (spent < points && (s.talents[t.id] || 0) < t.max) {
          s.talents[t.id] = (s.talents[t.id] || 0) + 1;
          spent++;
        }
        if (spent >= points) break;
      }
    } else {
      for (let pass = 0; pass < 6 && spent < points; pass++) {
        for (const t of order) {
          if (spent >= points) break;
          if (level < t.req) continue;
          const cur = s.talents[t.id] || 0;
          if (cur >= t.max) continue;
          s.talents[t.id] = cur + 1;
          spent++;
        }
      }
    }
  }
  return s;
}

function measure(classId, level, zone, spec) {
  const totals = new Map();
  let grand = 0;
  for (let n = 0; n < TRIALS; n++) {
    seed(zone * 1000 + n);
    const s = makeChar(classId, level, zone, spec);
    s.zone = zone;
    const enc = new Encounter(s, (ev) => {
      if (ev.type !== 'dmg' || ev.on !== 'enemy') return;
      totals.set(ev.source, (totals.get(ev.source) || 0) + ev.amount);
      grand += ev.amount;
    });
    let t = 0;
    while (t < 600) {
      const r = enc.tick(STEP); t += STEP;
      if (r === 'win') { enc.reset(); enc.spawn(); }
      else if (r === 'lose') { enc.revive(); enc.spawn(); }
    }
  }
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  return {
    dps: grand / (TRIALS * 600),
    rows: rows.map(([k, v]) => ({ name: k, share: v / grand })),
  };
}

console.log('\nDAMAGE SOURCE SHARE  --  default build vs companion build\n');

for (const id of ['warrior', 'hunter', 'priest', 'warlock']) {
  const base = CLASSES[id].companion?.name;
  const pet = base ? ((FORMS[id] || [])[PET_FORM]?.name || base) : undefined;
  console.log(`${id.toUpperCase()}${pet ? `  (companion: ${pet}${PET_FORM ? ` — form ${PET_FORM + 1}` : ''})` : ''}`);
  for (const c of CHECKS) {
    for (const spec of pet ? SPECS : ['even']) {
      const r = measure(id, c.level, c.zone, spec);
      const petRow = r.rows.find((x) => x.name === pet);
      const top = r.rows[0];
      const petIsTop = pet && top.name === pet;
      console.log(
        `  Lv${String(c.level).padStart(2)}/Z${String(c.zone).padStart(2)} ${spec.padEnd(5)}` +
        `${pet ? ` pet ${(petRow ? petRow.share * 100 : 0).toFixed(0).padStart(3)}%` : ''}` +
        `${petIsTop ? ' TOP' : '    '} dps ${r.dps.toFixed(1).padStart(6)}  ` +
        r.rows.slice(0, 4).map((x) => `${x.name} ${(x.share * 100).toFixed(0)}%`).join(' · ')
      );
    }
  }
  console.log('');
}
