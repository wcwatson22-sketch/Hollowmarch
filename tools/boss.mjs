// Boss gate check: a boss should be beatable at the gear you'd realistically have,
// and NOT beatable when under-geared. That gap is what makes a boss a wall you
// gear past rather than a coin flip or a brick.
import { Encounter } from '../js/systems/combat.js';
import { autoSlot } from '../js/data/classes.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore } from '../js/systems/loot.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];

function mk(id, level, gearZone) {
  const s = newSave(id, 'B'); s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s); s.zone = 0;
  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(Math.random() * 4));
    const it = rollDrop(id, z, false); if (!it) continue;
    const c = s.equipped[it.slot];
    if (!c || itemScore(it) > itemScore(c)) s.equipped[it.slot] = it;
  }
  if (level >= TALENT_UNLOCK_LEVEL) {
    const tree = TALENTS[id];
    for (let i = 0; i < level - TALENT_UNLOCK_LEVEL + 1; i++) {
      const t = tree[i % tree.length];
      const cur = s.talents[t.id] || 0;
      if (cur < t.max) s.talents[t.id] = cur + 1;
    }
  }
  return s;
}

function fightBoss(id, level, gearZone, bossZone, trials = 12) {
  let wins = 0, times = [];
  for (let n = 0; n < trials; n++) {
    const s = mk(id, level, gearZone);
    s.zone = bossZone; s.mobsKilledInZone = 0;
    const enc = new Encounter(s, () => {});
    let t = 0;
    while (t < 600) {
      const r = enc.tick(0.1); t += 0.1;
      if (r === 'win') { wins++; times.push(t); break; }
      if (r === 'lose') break;
    }
  }
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  return { rate: wins / trials, avg };
}

for (const [bossZone, level] of [[10, 11], [20, 20], [30, 27]]) {
  console.log(`\n=== Boss zone ${bossZone} (character level ${level}) ===`);
  for (const geared of [true, false]) {
    const gearZone = geared ? bossZone : Math.max(1, bossZone - 6);
    const label = geared ? 'on-level gear ' : 'under-geared  ';
    const parts = CLASS_IDS.map((id) => {
      const r = fightBoss(id, geared ? level : level - 4, gearZone, bossZone);
      return `${id.slice(0, 4)} ${(r.rate * 100).toFixed(0)}%${r.avg ? `/${r.avg.toFixed(0)}s` : ''}`;
    });
    console.log(`  ${label} ${parts.join('   ')}`);
  }
}
