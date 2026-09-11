// Fits the mob health curve to MEASURED player damage instead of a guessed exponent.
//
// The failure this exists to prevent: player power grows roughly linearly with level
// and item level, so any exponential mob-HP curve eventually outruns it and the game
// becomes unwinnable. Here we derive the level a player will actually be at when they
// reach zone z (from the XP economy), measure what they can do at that point, and pick
// mob HP so time-to-kill lands in a designed band.
//
//   node tools/curve.mjs

import { Encounter } from '../js/systems/combat.js';
import { autoSlot } from '../js/data/classes.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore } from '../js/systems/loot.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';
import { xpToNext, zoneXp, MOBS_PER_ZONE, mobHp } from '../js/data/mobs.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const STEP = 0.1;
const MAX_ZONE = 30;

// --- what level is a player actually at when they arrive in zone z? --------------
function intendedLevels() {
  const levels = [];
  let level = 1, xp = 0;
  for (let z = 1; z <= MAX_ZONE; z++) {
    levels[z] = level;
    xp += MOBS_PER_ZONE * zoneXp(z);          // clearing the zone
    if (z % 10 === 0) xp += zoneXp(z) * 12;   // boss bonus
    while (xp >= xpToNext(level)) { xp -= xpToNext(level); level++; }
  }
  return levels;
}

function makeChar(classId, level, zone) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  s.zone = zone;
  // Model real accumulation, not a single shopping trip: a player arriving in zone z
  // has farmed the zones behind it and killed every boss on the way, keeping the best
  // roll for each slot. Under-modelling gear here makes the fitted HP curve far too
  // low, and the game ends up trivially fast.
  for (let i = 0; i < 140; i++) {
    const fromZone = Math.max(1, zone - Math.floor(Math.random() * 4));
    const item = rollDrop(classId, fromZone, false);
    if (!item) continue;
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
  }
  for (let b = 10; b <= zone; b += 10) {
    const item = rollDrop(classId, b, true);
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
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

/** Measured sustained DPS: run the real combat loop and divide damage by time. */
function measureDps(classId, level, zone, seconds = 120) {
  let dealt = 0;
  const save = makeChar(classId, level, zone);
  const enc = new Encounter(save, (ev) => {
    if (ev.type === 'dmg' && ev.on === 'enemy') dealt += ev.amount;
  });
  let t = 0;
  while (t < seconds) {
    const r = enc.tick(STEP);
    t += STEP;
    // Keep the target alive so we measure throughput, not kill cadence.
    if (enc.enemy.hp < enc.enemy.maxHp * 0.5) enc.enemy.hp = enc.enemy.maxHp;
    if (r === 'lose') { enc.revive(); enc.spawn(); }
  }
  return dealt / seconds;
}

const levels = intendedLevels();
const TRIALS = 3;

// Designed pacing: fights start brisk and get progressively weightier.
//
// The early term holds the OPENING back. A plain 7 + 1.3z put zone 1 at under seven
// seconds, which meant the stretch where you are learning what your character does went
// past before you had talents or gear. It mirrors earlyPad() in js/data/mobs.js -- change
// one and you must change the other, or the next refit quietly undoes it.
const targetTtk = (z) => (7 + 1.3 * z) * (1 + 1.1 * Math.exp(-(z - 1) / 3.5));

console.log('zone  lvl    dps(median)   currentHP   currentTTK   targetTTK   suggestedHP');
console.log('-'.repeat(82));

const rows = [];
for (let z = 1; z <= MAX_ZONE; z++) {
  const lvl = levels[z];
  const dpsPerClass = CLASS_IDS.map((id) => {
    const runs = Array.from({ length: TRIALS }, () => measureDps(id, lvl, z));
    return runs.reduce((a, b) => a + b, 0) / TRIALS;
  });
  const sorted = [...dpsPerClass].sort((a, b) => a - b);
  const median = (sorted[1] + sorted[2]) / 2;

  const suggested = median * targetTtk(z);
  const curHp = mobHp(z);

  rows.push({ z, lvl, median, suggested });
  console.log(
    `${String(z).padStart(4)}  ${String(lvl).padStart(3)}  ` +
    `${median.toFixed(1).padStart(12)}  ${String(curHp).padStart(10)}  ` +
      `${(curHp / median).toFixed(1).padStart(10)}s  ${targetTtk(z).toFixed(1).padStart(9)}s  ` +
    `${suggested.toFixed(0).padStart(12)}`
  );
}

// --- fit player DPS = c * z^m, then DERIVE mob HP from it -------------------------
// Fitting DPS rather than HP keeps the two curves in the same family by construction,
// so they can't diverge: mobHp(z) = fittedDps(z) * targetTtk(z).
const n = rows.length;
const sx = rows.reduce((a, r) => a + Math.log(r.z), 0);
const sy = rows.reduce((a, r) => a + Math.log(r.median), 0);
const sxx = rows.reduce((a, r) => a + Math.log(r.z) ** 2, 0);
const sxy = rows.reduce((a, r) => a + Math.log(r.z) * Math.log(r.median), 0);
const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const c = Math.exp((sy - m * sx) / n);

console.log('\nFitted player DPS:  %s * z^%s', c.toFixed(2), m.toFixed(3));
console.log('With targetTtk(z) = (7 + 1.3z) x earlyPad(z), that gives:');
console.log('  mobHp(z) = %s * z^%s + %s * z^%s',
  (c * 7).toFixed(1), m.toFixed(3), (c * 1.3).toFixed(2), (m + 1).toFixed(3));

console.log('\nProjected time-to-kill under that curve:');
for (const r of rows.filter((r) => r.z % 3 === 1)) {
  const hp = c * 9 * Math.pow(r.z, m) + c * 0.6 * Math.pow(r.z, m + 1);
  console.log(`  zone ${String(r.z).padStart(2)}  hp ${hp.toFixed(0).padStart(7)}   ttk ${(hp / r.median).toFixed(1)}s`);
}
