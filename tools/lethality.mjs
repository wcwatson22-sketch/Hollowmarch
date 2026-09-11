// How dangerous is the game, and does gear actually decide it?
//
// The design target: on-level gear should survive comfortably, a few zones behind
// should be genuinely risky, and badly behind should be fatal. Progression is meant to
// be gated by gear, which only means anything if being under-geared kills you.
//
//   node tools/lethality.mjs

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { autoSlot } from '../js/data/classes.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const CHECKS = [{ level: 10, zone: 7 }, { level: 18, zone: 13 }, { level: 26, zone: 19 }];
const BEHIND = [0, 4, 8];      // how many zones behind the content the gear is
const TRIALS = 6;
const WINDOW = 300;
const STEP = 0.1;

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

function makeChar(classId, level, gearZone) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  s.petChoice = 'pet';
  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(pick() * 4));
    const it = rollDrop(classId, z, false);
    if (!it) continue;
    const cur = s.equipped[it.slot];
    if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
  }
  for (let b = 10; b <= gearZone; b += 10) {
    const it = rollDrop(classId, b, true);
    const cur = s.equipped[it.slot];
    if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
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

function run(classId, level, zone, gearZone) {
  let kills = 0, deaths = 0;
  for (let n = 0; n < TRIALS; n++) {
    seed(zone * 1000 + n);
    const s = makeChar(classId, level, gearZone);
    s.zone = zone;
    const enc = new Encounter(s, () => {});
    let t = 0;
    while (t < WINDOW) {
      const r = enc.tick(STEP);
      t += STEP;
      if (r === 'win') { kills++; enc.reset(); enc.spawn(); }
      else if (r === 'lose') { deaths++; enc.revive(); enc.spawn(); }
    }
  }
  return { kills: kills / TRIALS, deaths: deaths / TRIALS };
}

console.log('\nLETHALITY  (per 5 minutes, averaged over ' + TRIALS + ' seeded trials)\n');
console.log('target: on-level ~0-1 deaths, 4 behind risky, 8 behind fatal\n');

for (const c of CHECKS) {
  console.log(`Lv ${c.level} / Zone ${c.zone}`);
  for (const behind of BEHIND) {
    const gearZone = Math.max(1, c.zone - behind);
    const parts = CLASS_IDS.map((id) => {
      const r = run(id, c.level, c.zone, gearZone);
      return `${id.slice(0, 4)} ${r.deaths.toFixed(1)}d/${r.kills.toFixed(0)}k`;
    });
    console.log(`  gear ${behind === 0 ? 'on-level  ' : behind + ' behind  '} ${parts.join('   ')}`);
  }
  console.log('');
}
