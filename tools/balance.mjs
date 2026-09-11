// Balance harness. Runs headless combat simulations so class tuning is measured
// rather than guessed. Run with: npm run balance
//
//   node tools/balance.mjs            full report
//   node tools/balance.mjs progress   only the time-to-progress run

import { Encounter } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore } from '../js/systems/loot.js';
import { CLASSES, autoSlot } from '../js/data/classes.js';
import { MOBS_PER_ZONE, isBossZone, xpToNext, STALL_DEATHS, STALL_DROP } from '../js/data/mobs.js';
import { TALENTS, TALENT_UNLOCK_LEVEL } from '../js/data/talents.js';

const CLASS_IDS = ['warrior', 'hunter', 'priest', 'warlock'];
const STEP = 0.1; // simulation granularity in seconds

/** Build a character at a given level/zone wearing gear typical for that zone. */
function makeChar(classId, level, zone, gearZone = zone) {
  const s = newSave(classId, 'Sim');
  s.level = level;
  // Slot the kit a player would actually run at this level. Ten abilities and three
  // slots means "whatever newSave turned on" is a level 1-3 loadout forever.
  autoSlot(s);
  s.zone = zone;

  // Model real accumulation: a player in zone z has farmed the zones behind it and
  // killed the bosses on the way, keeping the best roll per slot. Equipping a single
  // round of on-level drops instead measures a character nobody actually plays.
  for (let i = 0; i < 140; i++) {
    const z = Math.max(1, gearZone - Math.floor(Math.random() * 4));
    const item = rollDrop(classId, z, false);
    if (!item) continue;
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
  }
  for (let b = 10; b <= gearZone; b += 10) {
    const item = rollDrop(classId, b, true);
    const cur = s.equipped[item.slot];
    if (!cur || itemScore(item) > itemScore(cur)) s.equipped[item.slot] = item;
  }

  // Spend talent points the lazy way: spread evenly across the tree.
  if (level >= TALENT_UNLOCK_LEVEL) {
    const pts = level - TALENT_UNLOCK_LEVEL + 1;
    const tree = TALENTS[classId];
    for (let i = 0; i < pts; i++) {
      const t = tree[i % tree.length];
      const cur = s.talents[t.id] || 0;
      if (cur < t.max) s.talents[t.id] = cur + 1;
    }
  }
  return s;
}

/** Simulate `seconds` of combat. Returns kills, deaths and average time-to-kill. */
function runFight(save, seconds, { advance = false } = {}) {
  const enc = new Encounter(save, () => {});
  let t = 0, kills = 0, deaths = 0, killTimes = [], since = 0;

  while (t < seconds) {
    const r = enc.tick(STEP);
    t += STEP;
    since += STEP;

    if (r === 'win') {
      kills++;
      killTimes.push(since);
      since = 0;
      if (advance) {
        save.mobsKilledInZone++;
        if (save.mobsKilledInZone >= MOBS_PER_ZONE) {
          save.mobsKilledInZone = 0;
          save.zone++;
        }
      }
      enc.reset();
      enc.spawn();
    } else if (r === 'lose') {
      deaths++;
      since = 0;
      enc.revive();
      enc.spawn();
    }
  }

  const avg = killTimes.length ? killTimes.reduce((a, b) => a + b, 0) / killTimes.length : Infinity;
  return { kills, deaths, ttk: avg };
}

const avgOf = (n, fn) => {
  const runs = Array.from({ length: n }, fn);
  const out = {};
  for (const k of Object.keys(runs[0])) out[k] = runs.reduce((a, r) => a + r[k], 0) / n;
  return out;
};

// --------------------------------------------------------------- report: parity
function parityReport() {
  const CHECKS = [
    { level: 5,  zone: 3  },
    { level: 10, zone: 6  },
    { level: 16, zone: 11 },
    { level: 24, zone: 18 },
  ];
  const MINUTES = 5;
  const TRIALS = 10; // small kill counts are noisy; averaging matters more than speed

  console.log('\n=== CLASS PARITY (kills per ' + MINUTES + ' min, ' + TRIALS + ' trials) ===');
  console.log('spread = highest/lowest kills; aim for < 1.35\n');

  for (const c of CHECKS) {
    const row = {};
    for (const id of CLASS_IDS) {
      const r = avgOf(TRIALS, () => runFight(makeChar(id, c.level, c.zone), MINUTES * 60));
      row[id] = r;
    }
    const kills = CLASS_IDS.map((id) => row[id].kills);
    const spread = Math.max(...kills) / Math.max(0.01, Math.min(...kills));

    console.log(`Lv ${String(c.level).padStart(2)} / Zone ${String(c.zone).padStart(2)}   spread ${spread.toFixed(2)}${spread > 1.35 ? '  <-- OUT OF BAND' : ''}`);
    for (const id of CLASS_IDS) {
      const r = row[id];
      console.log(
        `   ${id.padEnd(8)} kills ${r.kills.toFixed(1).padStart(6)}` +
        `   ttk ${r.ttk === Infinity ? '  never' : r.ttk.toFixed(1) + 's'}` +
        `   deaths ${r.deaths.toFixed(1)}`
      );
    }
    console.log('');
  }
}

// ------------------------------------------------------- report: time to progress
/** Play a character from scratch and report how far they get per hour. */
function progressReport(hours = 6) {
  console.log(`=== TIME TO PROGRESS (${hours}h of real-time play) ===\n`);

  for (const id of CLASS_IDS) {
    const s = newSave(id, 'Sim');
    let t = 0, kills = 0, deaths = 0, bosses = 0, lastKills = 0, lastT = 0, streak = 0;
    let enc = new Encounter(s, () => {});
    const marks = [];
    let nextMark = 3600;

    while (t < hours * 3600) {
      const r = enc.tick(STEP);
      t += STEP;

      if (r === 'win') {
        kills++; streak = 0;
        const mob = enc.enemy;
        s.gold += mob.gold;
        s.xp += mob.xp;
        while (s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }

        // Take every drop that beats what's worn, so gear keeps pace.
        const drop = rollDrop(s.classId, s.zone, mob.boss);
        if (drop) {
          const cur = s.equipped[drop.slot];
          if (!cur || drop.ilvl > cur.ilvl) s.equipped[drop.slot] = drop;
        }
        if (mob.boss) { bosses++; s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone; }
        else {
          s.mobsKilledInZone++;
          if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
        }
        enc = new Encounter(s, () => {});
      } else if (r === 'lose') {
        deaths++;
        streak++;
        s.zone = Math.max(1, s.checkpoint || 1); // checkpoints only move on boss kills
        if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
        s.mobsKilledInZone = 0;
        enc = new Encounter(s, () => {});
      }

      if (t >= nextMark) {
        const want = 12 + 1.2 * s.zone;
        const got = kills > lastKills ? (t - lastT) / (kills - lastKills) : Infinity;
        marks.push(`${(nextMark / 3600).toFixed(0)}h: Lv ${s.level} Z${s.zone} ttk ${got.toFixed(0)}s/want ${want.toFixed(0)}s`);
        lastKills = kills; lastT = t;
        nextMark += 3600;
      }
    }

    console.log(`${id.padEnd(8)} -> Lv ${s.level}, Zone ${s.zone}, ${bosses} boss kill(s), ${deaths} death(s), ${kills} kills`);
    console.log(`   ${marks.join('  |  ')}\n`);
  }
}

const mode = process.argv[2];
if (mode === 'progress') progressReport(Number(process.argv[3]) || 6);
else { parityReport(); progressReport(6); }
