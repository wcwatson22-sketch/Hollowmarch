// Measures the first N minutes of a brand-new character -- the part a player judges
// the game on. Reports when the first ability, first drop and first decision arrive.
import { Encounter } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop } from '../js/systems/loot.js';
import { CLASSES } from '../js/data/classes.js';
import { MOBS_PER_ZONE, xpToNext } from '../js/data/mobs.js';
import { TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const STEP = 0.1;
const MINUTES = Number(process.argv[2] || 10);

const fmt = (s) => (s === null ? '  never' : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`);

console.log(`\nFIRST ${MINUTES} MINUTES (median of 9 runs)\n`);
console.log('class     firstAbility  firstDrop  level2   level5   talents   kills  items  lvl');
console.log('-'.repeat(88));

for (const id of ['warrior', 'hunter', 'priest', 'warlock']) {
  const runs = [];
  for (let trial = 0; trial < 9; trial++) {
    const s = newSave(id, 'New');
    const marks = { ability: null, drop: null, lvl2: null, lvl5: null, talents: null };
    if (Object.values(s.equipped).some(Boolean)) marks.drop = 0;
    if (CLASSES[id].abilities.some((a) => a.unlock <= 1)) marks.ability = 0;

    let enc = new Encounter(s, () => {});
    let t = 0, kills = 0, items = Object.values(s.equipped).filter(Boolean).length;

    while (t < MINUTES * 60) {
      const r = enc.tick(STEP);
      t += STEP;
      if (r === 'lose') { s.zone = s.checkpoint; s.mobsKilledInZone = 0; enc = new Encounter(s, () => {}); continue; }
      if (r !== 'win') continue;

      kills++;
      const mob = enc.enemy;
      s.gold += mob.gold;
      s.xp += mob.xp;
      while (s.xp >= xpToNext(s.level)) {
        s.xp -= xpToNext(s.level);
        s.level++;
        if (s.level === 2 && marks.lvl2 === null) marks.lvl2 = t;
        if (s.level === 5 && marks.lvl5 === null) marks.lvl5 = t;
        if (s.level >= TALENT_UNLOCK_LEVEL && marks.talents === null) marks.talents = t;
        if (marks.ability === null && CLASSES[id].abilities.some((a) => a.unlock === s.level)) marks.ability = t;
      }
      const drop = rollDrop(s.classId, s.zone, mob.boss, { killIndex: kills });
      if (drop) { items++; if (marks.drop === null) marks.drop = t; }

      s.mobsKilledInZone++;
      if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
      enc.reset(); enc.spawn();
    }
    runs.push({ ...marks, kills, items, level: s.level });
  }

  const med = (key) => {
    const vals = runs.map((r) => r[key]).filter((v) => v !== null).sort((a, b) => a - b);
    return vals.length > runs.length / 2 ? vals[Math.floor(vals.length / 2)] : null;
  };
  const medNum = (key) => {
    const v = runs.map((r) => r[key]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };

  console.log(
    `${id.padEnd(9)} ${fmt(med('ability')).padStart(11)} ${fmt(med('drop')).padStart(10)}` +
    ` ${fmt(med('lvl2')).padStart(8)} ${fmt(med('lvl5')).padStart(8)} ${fmt(med('talents')).padStart(9)}` +
    ` ${String(medNum('kills')).padStart(6)} ${String(medNum('items')).padStart(6)} ${String(medNum('level')).padStart(4)}`
  );
}
console.log('');
