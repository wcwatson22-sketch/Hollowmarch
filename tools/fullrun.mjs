// Complete marches: zone 1 to the Hollow King, or until the run stops getting anywhere.
//
// Every other tool here samples a slice -- ninety minutes of progression, a fixed level,
// one fight. This plays the whole game, which is the only way to answer "which class is
// best" and "where do runs actually end", because a build that is strong at level 20 and
// falls apart at 70 looks fine in every other measurement.
//
//   node tools/fullrun.mjs [runs] [outFile]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, upgradeRarity, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, branchState } from '../js/data/talents.js';
import { setStateFor } from '../js/data/sets.js';
import {
  xpToNext, MOBS_PER_ZONE, MAX_LEVEL, STALL_DEATHS, STALL_DROP,
  FINAL_ZONE, isBossZone, isMajorBossZone,
} from '../js/data/mobs.js';
import fs from 'node:fs';

const RUNS = Number(process.argv[2] || 100);
const OUT = process.argv[3] || null;
// Lets the run be split across several processes without repeating seeds.
const SEED_OFFSET = Number(process.argv[4] || 0);
const STEP = 0.1;
const TIME_CAP = 10 * 60 * 60;      // ten simulated hours; past this the run has stalled

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// The same twelve a player would name, so class and build can both be attributed.
const STYLES = [
  { id: 'bleed',      cls: 'warrior', solo: false, branch: 'Bleed',      types: ['bleed'] },
  { id: 'thorns',     cls: 'warrior', solo: false, branch: 'Thorns',     types: ['physical'] },
  { id: 'shouts',     cls: 'warrior', solo: false, branch: 'Shouts',     types: ['physical'] },
  { id: 'ranger',     cls: 'hunter',  solo: true,  branch: 'Ranger',     types: ['physical', 'arcane'] },
  { id: 'poison',     cls: 'hunter',  solo: true,  branch: 'Assassin',   types: ['poison', 'bleed'] },
  { id: 'pack',       cls: 'hunter',  solo: false, branch: 'Pack',       types: ['physical'], pet: true },
  { id: 'holy',       cls: 'priest',  solo: true,  branch: 'Holy',       types: ['holy', 'fire'] },
  { id: 'shadowpri',  cls: 'priest',  solo: true,  branch: 'Shadow',     types: ['shadow'] },
  { id: 'faith',      cls: 'priest',  solo: false, branch: 'Faith',      types: ['holy'], pet: true },
  { id: 'fire',       cls: 'warlock', solo: true,  branch: 'Fire',       types: ['fire'] },
  { id: 'shadowlock', cls: 'warlock', solo: true,  branch: 'Shadow',     types: ['shadow'] },
  { id: 'demo',       cls: 'warlock', solo: false, branch: 'Demonology', types: ['fire', 'shadow'], pet: true },
];

function kitFor(style, level) {
  const pool = CLASSES[style.cls].abilities.filter((a) => a.unlock <= level);
  const damage = (a) => ((a.coef || 0) * (a.ticks || 1) + (a.burst || 0) + (a.executeCoef || 0) * 0.3) / Math.max(1, a.cd || 1);
  const wanted = pool.filter((a) => {
    if (style.pet && ['petstrike', 'buffpet'].includes(a.kind)) return true;
    if (style.solo && ['petstrike', 'buffpet', 'healpet'].includes(a.kind) && !a.solo) return false;
    return style.types.includes(a.type || 'physical');
  }).sort((x, y) => damage(y) - damage(x));

  const kit = wanted.slice(0, MAX_ACTIVE_ABILITIES).map((a) => a.id);
  for (const a of [...pool].sort((x, y) => damage(y) - damage(x))) {
    if (kit.length >= MAX_ACTIVE_ABILITIES) break;
    if (!kit.includes(a.id)) kit.push(a.id);
  }
  const sustain = pool.find((a) => ['healpet', 'hot', 'drain'].includes(a.kind));
  if (sustain && !kit.some((id) => { const a = pool.find((x) => x.id === id); return a && ['healpet','hot','drain'].includes(a.kind); })) {
    kit[kit.length - 1] = sustain.id;
  }
  return kit;
}

function talentsFor(style, level, kit) {
  const tree = TALENTS[style.cls].filter((t) => level >= (t.req || 0))
    .filter((t) => !(style.solo && isPetTalent(t)));
  const inBranch = tree.filter((t) => t.branch === style.branch);
  const supporting = tree.filter((t) => t.ability && kit.includes(t.ability));
  const rest = tree.filter((t) => !inBranch.includes(t) && !supporting.includes(t));
  let points = earnedTalentPoints(level);
  const out = {};
  for (const t of [...inBranch, ...supporting, ...rest]) {
    while (points > 0 && (out[t.id] || 0) < t.max) { out[t.id] = (out[t.id] || 0) + 1; points--; }
    if (points <= 0) break;
  }
  return out;
}

function march(style, seed) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));
  const s = newSave(style.cls, 'Full');
  s.petChoice = CLASSES[style.cls].companion ? (style.solo ? 'solo' : 'pet') : null;

  const respec = () => {
    const kit = kitFor(style, s.level);
    for (const a of CLASSES[style.cls].abilities) s.abilityToggles[a.id] = kit.includes(a.id);
    s.talents = talentsFor(style, s.level, kit);
  };
  respec();

  let enc = new Encounter(s, () => {});
  let t = 0, kills = 0, deaths = 0, lastLevel = 1, streak = 0;
  let won = false, deepest = 1;
  let embers = 0;
  const deathZones = [];
  let timeToFinal = null;

  while (t < TIME_CAP) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message, style: style.id }; }
    t += STEP;

    // Embers are collected by a player who is present; twenty-five of them over a march
    // is the realistic case, not zero.
    if (embers < 25 && t > (embers + 1) * 420) { embers++; s.embers = embers; }

    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp; s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }

      const drop = rollDrop(s.classId, s.zone, mob.boss, { solo: style.solo, level: s.level, killIndex: s.totalKills });
      if (drop) {
        const cur = s.equipped[drop.slot];
        if (!cur || (drop.setId && !cur.setId) || itemScore(drop) > itemScore(cur)) s.equipped[drop.slot] = drop;
      }

      if (mob.final) { won = true; timeToFinal = t; break; }

      if (mob.boss) {
        // A major boss hands over a reforge; a player spends it on their best worn piece
        // that is not already legendary.
        if (isMajorBossZone(s.zone)) {
          const worn = Object.values(s.equipped).filter((it) => it && it.rarity !== 'legendary');
          worn.sort((a, b) => itemScore(b) - itemScore(a));
          if (worn[0]) upgradeRarity(worn[0], s.classId, style.solo);
        }
        s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone;
      } else {
        s.mobsKilledInZone++;
        if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
      }
      deepest = Math.max(deepest, s.zone);
      if (s.level !== lastLevel) { respec(); lastLevel = s.level; }
      enc = new Encounter(s, () => {});
    } else if (r === 'lose') {
      deaths++;
      deathZones.push(s.zone);
      streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      enc = new Encounter(s, () => {});
    }
  }

  const sets = setStateFor(s);
  const branches = branchState(s.classId, s.talents);
  return {
    style: style.id, cls: style.cls, solo: style.solo,
    won, stalled: !won,
    deepest, level: s.level, kills, deaths,
    hours: t / 3600, timeToFinal: timeToFinal ? timeToFinal / 3600 : null,
    setPieces: sets.count, branchBonuses: branches.earned.filter((b) => b.on).length,
    deathZones,
  };
}

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const style = STYLES[(i + SEED_OFFSET) % STYLES.length];
  rows.push(march(style, 20000 + (i + SEED_OFFSET) * 613));
  if (OUT && (i + 1) % 6 === 0) fs.writeFileSync(OUT, JSON.stringify(rows));
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));

const median = (xs) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const ok = rows.filter((r) => !r.error);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

console.log(`${ok.length} complete marches, zone 1 to the Hollow King\n`);

console.log('BY CLASS');
console.log('class     runs   beat the King   stalled out   median deepest   median hours   median deaths');
for (const c of ['warrior', 'hunter', 'priest', 'warlock']) {
  const rs = ok.filter((r) => r.cls === c);
  if (!rs.length) continue;
  console.log(
    c.padEnd(9) + String(rs.length).padStart(5) +
    (pct(rs.filter((r) => r.won).length, rs.length) + ` (${rs.filter((r) => r.won).length})`).padStart(16) +
    (pct(rs.filter((r) => r.stalled).length, rs.length)).padStart(10) +
    String(median(rs.map((r) => r.deepest))).padStart(17) +
    median(rs.map((r) => r.hours)).toFixed(1).padStart(15) +
    String(median(rs.map((r) => r.deaths))).padStart(16)
  );
}

console.log('\nBY BUILD');
console.log('build        class     runs   beat the King   median deepest   median hours   sets   branch');
for (const st of STYLES) {
  const rs = ok.filter((r) => r.style === st.id);
  if (!rs.length) continue;
  console.log(
    st.id.padEnd(13) + st.cls.padEnd(10) + String(rs.length).padStart(4) +
    (pct(rs.filter((r) => r.won).length, rs.length) + ` (${rs.filter((r) => r.won).length})`).padStart(16) +
    String(median(rs.map((r) => r.deepest))).padStart(17) +
    median(rs.map((r) => r.hours)).toFixed(1).padStart(15) +
    median(rs.map((r) => r.setPieces)).toFixed(0).padStart(7) +
    median(rs.map((r) => r.branchBonuses)).toFixed(0).padStart(9)
  );
}

console.log('\nWHERE RUNS END');
const allDeaths = ok.flatMap((r) => r.deathZones);
const buckets = {};
for (const z of allDeaths) { const b = Math.floor((z - 1) / 10) * 10 + 1; buckets[b] = (buckets[b] || 0) + 1; }
for (const b of Object.keys(buckets).map(Number).sort((a, b2) => a - b2)) {
  const n = buckets[b];
  console.log(`  zones ${String(b).padStart(3)}-${String(b + 9).padEnd(3)} ${'#'.repeat(Math.round(n / Math.max(1, allDeaths.length) * 60)).padEnd(60)} ${n} deaths`);
}
const stalledRuns = ok.filter((r) => r.stalled);
if (stalledRuns.length) {
  console.log(`\n${stalledRuns.length} runs stalled without dying, deepest zone reached: ` +
    stalledRuns.map((r) => `${r.style} z${r.deepest}`).slice(0, 10).join(', '));
}
