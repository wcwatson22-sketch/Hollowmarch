// How dangerous is each stretch of the game, actually?
//
// Reports, for a level-appropriate character at each zone: what one mob hit costs as a
// share of your health, and how often you die clearing for five minutes. A flat-ish
// line is the goal. A dip means a stretch where nothing can hurt you.
//
//   node tools/threat.mjs

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { autoSlot, CLASSES } from '../js/data/classes.js';
import { makeMob, MAX_LEVEL } from '../js/data/mobs.js';
import { computeStats, mitigate } from '../js/systems/stats.js';

function mul(seed){let a=seed>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let x=Math.imul(a^(a>>>15),1|a);x=(x+Math.imul(x^(x>>>7),61|x))^x;return((x^(x>>>14))>>>0)/4294967296;};}

// The XP curve puts you at roughly this level for a given zone (see tools/curve.mjs).
const levelFor = (z) => Math.max(1, Math.min(MAX_LEVEL, Math.round(z / 1.55) + 2));
const ZONES = [3, 6, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90];
const IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const TRIALS = 3;

console.log('zone  lvl |  hit as % of health  |  armor reduction  |  deaths / 5 min  |  kills / 5 min');
for (const z of ZONES) {
  const lvl = levelFor(z);
  let pct = 0, red = 0, deaths = 0, kills = 0, n = 0;
  for (const id of IDS) {
    for (let t = 0; t < TRIALS; t++) {
      setLootRng(mul(z * 100 + t)); setCombatRng(mul(z * 31 + t + 7));
      const s = newSave(id, 'T');
      s.level = lvl; autoSlot(s);
      s.petChoice = CLASSES[id].companion ? 'pet' : null;
      // Embers accrue as you play; a mid-game character has some.
      s.embers = Math.min(200, z * 2);
      // Gear in proportion to how long it took to get here, or deep characters come out
      // under-equipped and every late zone looks unplayably slow for the wrong reason.
      const rolls = Math.round(8 * z);
      for (let i = 0; i < rolls; i++) {
        const it = rollDrop(id, z, i % 25 === 0, { killIndex: 999 });
        if (!it) continue;
        const cur = s.equipped[it.slot];
        if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
      }
      s.zone = z; s.mobsKilledInZone = 0;
      const st = computeStats(s);
      const mob = makeMob(z, 0);
      const hit = mitigate(mob.ap, st.armor, z);
      pct += hit / st.maxHp;
      red += st.armor / (st.armor + (40 + 14 * z + 0.9 * Math.pow(Math.max(0, z - 20), 2)));

      const enc = new Encounter(s, () => {});
      let time = 0;
      while (time < 300) {
        const r = enc.tick(0.1); time += 0.1;
        if (r === 'win') { kills++; enc.reset(); enc.spawn(); }
        else if (r === 'lose') { deaths++; enc.revive(); enc.spawn(); }
      }
      n++;
    }
  }
  const flag = (deaths / n) < 0.15 ? '   <-- nothing can hurt you' : '';
  console.log(
    String(z).padStart(4) + String(lvl).padStart(5) + ' |' +
    (pct / n * 100).toFixed(2).padStart(19) + '%' +
    (red / n * 100).toFixed(0).padStart(17) + '%' +
    (deaths / n).toFixed(2).padStart(18) +
    (kills / n).toFixed(0).padStart(17) + flag
  );
}
