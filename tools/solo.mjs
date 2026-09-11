// Solves soloBonus so that giving up your companion is a genuine choice rather than a
// trap or a free upgrade. Target: solo DPS within a few percent of a pet-keeping build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Encounter } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore } from '../js/systems/loot.js';
import { CLASSES, autoSlot } from '../js/data/classes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PET_CLASSES = ['hunter', 'priest', 'warlock'];
const CHECKS = [{ level: 10, zone: 7 }, { level: 18, zone: 13 }, { level: 26, zone: 19 }];
const TRIALS = 4, WINDOW = 420, STEP = 0.1;

function makeChar(classId, level, gearZone, solo) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  s.petChoice = solo ? 'solo' : 'pet';
  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(Math.random() * 4));
    const it = rollDrop(classId, z, false, { solo });
    if (!it) continue;
    const cur = s.equipped[it.slot];
    if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
  }
  for (let b = 10; b <= gearZone; b += 10) {
    const it = rollDrop(classId, b, true, { solo });
    const cur = s.equipped[it.slot];
    if (!cur || itemScore(it) > itemScore(cur)) s.equipped[it.slot] = it;
  }
  if (level >= TALENT_UNLOCK_LEVEL) {
    // Both builds spend points sensibly for what they are.
    const tree = TALENTS[classId].filter((t) => {
      const isPet = t.per.petPow || t.per.petHp || t.per.petArmor;
      return solo ? !isPet : true;
    });
    let spent = 0;
    const points = level - TALENT_UNLOCK_LEVEL + 1;
    for (let pass = 0; pass < 6 && spent < points; pass++) {
      for (const t of tree) {
        if (spent >= points) break;
        if (level < t.req) continue;
        const cur = s.talents[t.id] || 0;
        if (cur >= t.max) continue;
        s.talents[t.id] = cur + 1;
        spent++;
      }
    }
  }
  return s;
}

function dps(classId, level, zone, solo) {
  let dealt = 0;
  for (let n = 0; n < TRIALS; n++) {
    const s = makeChar(classId, level, zone, solo);
    s.zone = zone;
    const enc = new Encounter(s, (ev) => { if (ev.type === 'dmg' && ev.on === 'enemy') dealt += ev.amount; });
    let t = 0;
    while (t < WINDOW) {
      const r = enc.tick(STEP); t += STEP;
      if (r === 'win') { enc.reset(); enc.spawn(); }
      else if (r === 'lose') { enc.revive(); enc.spawn(); }
    }
  }
  return dealt / (TRIALS * WINDOW);
}

const geo = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);

// Never solve below this: the offer has to be worth reading.
const SOLO_BONUS_FLOOR = 0.10;

for (const id of PET_CLASSES) CLASSES[id].soloBonus = 0.15;

for (let pass = 1; pass <= 5; pass++) {
  const ratios = {};
  for (const id of PET_CLASSES) {
    ratios[id] = geo(CHECKS.map((c) => dps(id, c.level, c.zone, true) / dps(id, c.level, c.zone, false)));
  }
  console.log(`pass ${pass}  ` + PET_CLASSES.map((id) =>
    `${id} ${ratios[id].toFixed(3)} @ bonus ${CLASSES[id].soloBonus.toFixed(3)}`).join('   '));

  const worst = Math.max(...PET_CLASSES.map((id) => Math.abs(ratios[id] - 1)));
  if (worst < 0.05) { console.log('converged\n'); break; }

  for (const id of PET_CLASSES) {
    // Only part of power comes from the base the bonus multiplies, so nudge gently.
    const next = (1 + CLASSES[id].soloBonus) / Math.pow(ratios[id], 0.9) - 1;
    CLASSES[id].soloBonus = Math.max(SOLO_BONUS_FLOOR, Math.min(0.6, next));
  }
}

console.log('Final soloBonus:');
for (const id of PET_CLASSES) console.log(`  ${id.padEnd(8)} ${CLASSES[id].soloBonus.toFixed(3)}`);

if (process.argv.includes('--write')) {
  const file = path.join(HERE, '..', 'js', 'data', 'classes.js');
  let src = fs.readFileSync(file, "utf8");
  for (const id of PET_CLASSES) {
    // Located by index rather than regex on purpose. This block used to build its
    // pattern inside a TEMPLATE LITERAL, where [sS] collapses to [sS] -- so it
    // matched nothing and --write silently never wrote anything at all.
    const cls = src.indexOf("  " + id + ": {");
    if (cls < 0) throw new Error("no class block for " + id);
    const key = src.indexOf("soloBonus: ", cls);
    if (key < 0) throw new Error("no soloBonus for " + id);
    const from = key + "soloBonus: ".length;
    const to = src.indexOf(",", from);
    src = src.slice(0, from) + CLASSES[id].soloBonus.toFixed(3) + src.slice(to);
  }
  fs.writeFileSync(file, src);
  console.log("wrote js/data/classes.js");
}
