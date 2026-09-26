// The full laboratory: many archetypes, complete marches, everything instrumented.
//
// tools/fullrun.mjs plays twelve builds to the end. This plays a much wider spread --
// crit, haste, auto-attack, sustain, glass-cannon, hybrid and deliberately off-meta
// combinations alongside the obvious ones -- and records what happened INSIDE each run:
// where the damage came from, what the stat line looked like at the end, when each
// milestone fell, and where the character got stuck.
//
// An archetype is a talent PRIORITY plus an ability flavour, which is how a player
// actually builds: "I want crit" is a way of choosing points, not a branch.
//
//   node tools/lab.mjs [runs] [outFile] [seedOffset]

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, upgradeRarity, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, branchState } from '../js/data/talents.js';
import { setStateFor } from '../js/data/sets.js';
import { computeStats, computeCompanion } from '../js/systems/stats.js';
import {
  xpToNext, MOBS_PER_ZONE, MAX_LEVEL, STALL_DEATHS, STALL_DROP, isMajorBossZone,
} from '../js/data/mobs.js';
import fs from 'node:fs';

const RUNS = Number(process.argv[2] || 100);
const OUT = process.argv[3] || null;
const SEED_OFFSET = Number(process.argv[4] || 0);
const STEP = 0.1;
const TIME_CAP = 10 * 60 * 60;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// `want` is the stat keys this build chases, `types` the ability flavours it carries.
// A build with neither is following raw throughput, which is its own archetype.
const STYLES = [
  // ---- warrior: no companion, so every archetype is a solo one -------------------
  { id: 'war-bleed',    cls: 'warrior', arch: 'damage over time',  types: ['bleed'],     want: ['dotDmg', 'bleedDmg', 'dotCrit'] },
  { id: 'war-thorns',   cls: 'warrior', arch: 'defensive/reflect', types: ['physical'],  want: ['thorns', 'armorPct', 'hpPct'] },
  { id: 'war-shouts',   cls: 'warrior', arch: 'ability/buff',      types: ['physical'],  want: ['abilityDmg', 'physicalDmg'] },
  { id: 'war-crit',     cls: 'warrior', arch: 'critical strike',   types: ['physical'],  want: ['crit', 'critDmg'] },
  { id: 'war-haste',    cls: 'warrior', arch: 'attack speed',      types: ['physical'],  want: ['haste'] },
  { id: 'war-auto',     cls: 'warrior', arch: 'basic attack',      types: ['physical'],  want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'war-glass',    cls: 'warrior', arch: 'glass cannon',      types: ['physical'],  want: ['critDmg', 'abilityDmg', 'physicalDmg'] },
  { id: 'war-sustain',  cls: 'warrior', arch: 'sustain/leech',     types: ['physical'],  want: ['leech', 'hpPct', 'thorns'] },

  // ---- hunter --------------------------------------------------------------------
  { id: 'hun-ranger',   cls: 'hunter',  solo: true,  arch: 'ability/physical', types: ['physical', 'arcane'], want: ['physicalDmg', 'abilityDmg'] },
  { id: 'hun-poison',   cls: 'hunter',  solo: true,  arch: 'damage over time', types: ['poison', 'bleed'],    want: ['dotDmg', 'poisonDmg', 'dotCrit'] },
  { id: 'hun-pack',     cls: 'hunter',  pet: true,   arch: 'companion',        types: ['physical'],           want: ['petPow', 'petHaste', 'petHp'] },
  { id: 'hun-crit',     cls: 'hunter',  solo: true,  arch: 'critical strike',  types: ['physical'],           want: ['crit', 'critDmg'] },
  { id: 'hun-haste',    cls: 'hunter',  solo: true,  arch: 'attack speed',     types: ['physical'],           want: ['haste'] },
  { id: 'hun-auto',     cls: 'hunter',  solo: true,  arch: 'basic attack',     types: ['physical'],           want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'hun-petdot',   cls: 'hunter',  pet: true,   arch: 'hybrid pet + dot', types: ['poison'],             want: ['petPow', 'petType', 'dotDmg'] },
  { id: 'hun-tank',     cls: 'hunter',  pet: true,   arch: 'defensive',        types: ['physical'],           want: ['petHp', 'petArmor', 'hpPct', 'armorPct'] },

  // ---- priest --------------------------------------------------------------------
  { id: 'pri-holy',     cls: 'priest',  solo: true,  arch: 'ability/holy',     types: ['holy', 'fire'],       want: ['holyDmg', 'abilityDmg'] },
  { id: 'pri-shadow',   cls: 'priest',  solo: true,  arch: 'damage over time', types: ['shadow'],             want: ['dotDmg', 'shadowDmg', 'dotCrit'] },
  { id: 'pri-faith',    cls: 'priest',  pet: true,   arch: 'companion',        types: ['holy'],               want: ['petPow', 'petHaste'] },
  { id: 'pri-crit',     cls: 'priest',  solo: true,  arch: 'critical strike',  types: ['holy'],               want: ['crit', 'critDmg'] },
  { id: 'pri-heal',     cls: 'priest',  pet: true,   arch: 'healing/sustain',  types: ['holy'],               want: ['healPow', 'hpPct', 'petHp'] },
  { id: 'pri-auto',     cls: 'priest',  solo: true,  arch: 'basic attack',     types: ['holy'],               want: ['autoDmg', 'haste'] },
  { id: 'pri-atone',    cls: 'priest',  pet: true,   arch: 'off-meta atonement', types: ['holy'],             want: ['atonement', 'healPow'] },

  // ---- warlock -------------------------------------------------------------------
  { id: 'lok-fire',     cls: 'warlock', solo: true,  arch: 'fire/dot',         types: ['fire'],               want: ['fireDmg', 'dotDmg'] },
  { id: 'lok-shadow',   cls: 'warlock', solo: true,  arch: 'shadow/dot',       types: ['shadow'],             want: ['shadowDmg', 'dotDmg', 'dotCrit'] },
  { id: 'lok-demo',     cls: 'warlock', pet: true,   arch: 'companion',        types: ['fire', 'shadow'],     want: ['petPow', 'petHaste'] },
  { id: 'lok-crit',     cls: 'warlock', solo: true,  arch: 'critical strike',  types: ['fire'],               want: ['crit', 'critDmg'] },
  { id: 'lok-haste',    cls: 'warlock', solo: true,  arch: 'cast speed',       types: ['shadow'],             want: ['haste'] },
  { id: 'lok-drain',    cls: 'warlock', solo: true,  arch: 'sustain/drain',    types: ['shadow'],             want: ['leech', 'hpPct'] },
  { id: 'lok-auto',     cls: 'warlock', solo: true,  arch: 'basic attack',     types: ['shadow'],             want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'lok-petfire',  cls: 'warlock', pet: true,   arch: 'off-meta pet fire', types: ['fire'],              want: ['petType', 'fireDmg', 'petPow'] },
];

function kitFor(style, level) {
  const pool = CLASSES[style.cls].abilities.filter((a) => a.unlock <= level);
  const damage = (a) => ((a.coef || 0) * (a.ticks || 1) + (a.burst || 0) + (a.executeCoef || 0) * 0.3) / Math.max(1, a.cd || 1);
  const solo = Boolean(style.solo);
  let wanted = pool.filter((a) => {
    if (style.pet && ['petstrike', 'buffpet'].includes(a.kind)) return true;
    if (solo && ['petstrike', 'buffpet', 'healpet'].includes(a.kind) && !a.solo) return false;
    return !style.types || style.types.includes(a.type || 'physical');
  });
  // A basic-attack build wants its slots spent on things that do not compete with the
  // swing, so it leans on buffs and sustain rather than more casts.
  if (style.want?.includes('autoDmg')) {
    wanted = pool.filter((a) => ['buff', 'buffpet', 'hot', 'hotself', 'healself', 'healpet', 'drain'].includes(a.kind) || (a.stun && true));
  }
  wanted.sort((x, y) => damage(y) - damage(x));
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

/** Points chase the archetype's stats first, then whatever supports the kit. */
function talentsFor(style, level, kit) {
  const solo = Boolean(style.solo);
  const tree = TALENTS[style.cls].filter((t) => level >= (t.req || 0))
    .filter((t) => !(solo && isPetTalent(t)));
  const score = (t) => {
    let s = 0;
    for (const key of style.want || []) if (t.per?.[key]) s += 10;
    if (t.ability && kit.includes(t.ability)) s += 6;
    if (style.types && t.branch && style.types.some((ty) => (t.per?.[ty + 'Dmg']))) s += 4;
    return s;
  };
  const ordered = [...tree].sort((a, b) => score(b) - score(a));
  let points = earnedTalentPoints(level);
  const out = {};
  for (const t of ordered) {
    while (points > 0 && (out[t.id] || 0) < t.max) { out[t.id] = (out[t.id] || 0) + 1; points--; }
    if (points <= 0) break;
  }
  return out;
}

function march(style, seed, runNo) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));
  const solo = Boolean(style.solo);
  const s = newSave(style.cls, 'Lab');
  s.petChoice = CLASSES[style.cls].companion ? (solo ? 'solo' : 'pet') : null;

  const respec = () => {
    const kit = kitFor(style, s.level);
    for (const a of CLASSES[style.cls].abilities) s.abilityToggles[a.id] = kit.includes(a.id);
    s.talents = talentsFor(style, s.level, kit);
    return kit;
  };
  let kit = respec();

  let enc = new Encounter(s, () => {});
  const bySource = {};
  const byKind = { auto: 0, ability: 0, dot: 0, pet: 0 };
  let dealt = 0, taken = 0;
  const hook = (e) => {
    const real = e.dealToEnemy.bind(e);
    e.dealToEnemy = (amount, source, crit, kind, school, id) => {
      dealt += amount;
      bySource[source] = (bySource[source] || 0) + amount;
      if (byKind[kind] !== undefined) byKind[kind] += amount;
      real(amount, source, crit, kind, school, id);
    };
  };
  hook(enc);

  let t = 0, kills = 0, deaths = 0, lastLevel = 1, streak = 0;
  let won = false, deepest = 1, embers = 0, kingAttempts = 0;
  let lastKillT = 0, worstGap = 0, worstGapZone = 1;
  const deathZones = [];
  const milestones = {};
  let hp = enc.player.hp;

  while (t < TIME_CAP) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message, style: style.id, runNo }; }
    t += STEP;
    if (enc.player.hp < hp) taken += hp - enc.player.hp;
    hp = enc.player.hp;
    if (embers < 25 && t > (embers + 1) * 420) { embers++; s.embers = embers; }

    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp; s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }
      for (const L of [20, 40, 60]) if (s.level >= L && !milestones['lv' + L]) milestones['lv' + L] = t / 3600;

      const drop = rollDrop(s.classId, s.zone, mob.boss, { solo, level: s.level, killIndex: s.totalKills });
      if (drop) {
        const cur = s.equipped[drop.slot];
        if (!cur || (drop.setId && !cur.setId) || itemScore(drop) > itemScore(cur)) s.equipped[drop.slot] = drop;
      }
      if (mob.final) { won = true; kingAttempts++; milestones.z100 = t / 3600; break; }
      if (mob.boss) {
        if (isMajorBossZone(s.zone)) {
          const worn = Object.values(s.equipped).filter((it) => it && it.rarity !== 'legendary');
          worn.sort((a, b) => itemScore(b) - itemScore(a));
          if (worn[0]) upgradeRarity(worn[0], s.classId, solo);
        }
        s.zone++; s.mobsKilledInZone = 0; s.checkpoint = s.zone;
      } else {
        s.mobsKilledInZone++;
        if (s.mobsKilledInZone >= MOBS_PER_ZONE) { s.mobsKilledInZone = 0; s.zone++; }
      }
      deepest = Math.max(deepest, s.zone);
      for (const Z of [25, 50, 75]) if (s.zone >= Z && !milestones['z' + Z]) milestones['z' + Z] = t / 3600;
      if (t - lastKillT > worstGap) { worstGap = t - lastKillT; worstGapZone = s.zone; }
      lastKillT = t;
      if (s.level !== lastLevel) { kit = respec(); lastLevel = s.level; }
      enc = new Encounter(s, () => {}); hook(enc); hp = enc.player.hp;
    } else if (r === 'lose') {
      deaths++; deathZones.push(s.zone);
      if (s.zone >= 100) kingAttempts++;
      streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      enc = new Encounter(s, () => {}); hook(enc); hp = enc.player.hp;
    }
  }

  const st = computeStats(s);
  const comp = computeCompanion(s, st);
  const sets = setStateFor(s);
  const branches = branchState(s.classId, s.talents);
  const topTalents = Object.entries(s.talents).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([id, n]) => {
      const tal = TALENTS[s.classId].find((x) => x.id === id);
      return (tal ? tal.name : id) + ' ' + n;
    });
  const topSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => k + ' ' + ((v / Math.max(1, dealt)) * 100).toFixed(0) + '%');

  return {
    runNo, style: style.id, cls: style.cls, arch: style.arch, solo,
    won, kingAttempts: Math.max(1, kingAttempts), deepest, level: s.level,
    hours: t / 3600, kills, deaths, deathZones, milestones,
    dps: dealt / Math.max(1, t), takenPerSec: taken / Math.max(1, t),
    mix: {
      auto: byKind.auto / Math.max(1, dealt), ability: byKind.ability / Math.max(1, dealt),
      dot: byKind.dot / Math.max(1, dealt), pet: byKind.pet / Math.max(1, dealt),
    },
    topSources, topTalents, kit,
    stats: {
      power: st.power, crit: st.crit, haste: st.haste, armor: st.armor, maxHp: st.maxHp,
      critDmg: st.critDmg, dotDmg: st.dotDmg, abilityDmg: st.abilityDmg, autoDmg: st.autoDmg,
      petPow: st.petPow, leech: st.leech, thorns: st.thorns, healPow: st.healPow,
      petDps: comp ? comp.ap / comp.swingTime : 0,
    },
    setPieces: sets.count, branchBonuses: branches.earned.filter((b) => b.on).length,
    worstGapMin: worstGap / 60, worstGapZone,
    embers,
  };
}

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const style = STYLES[(i + SEED_OFFSET) % STYLES.length];
  rows.push(march(style, 70000 + (i + SEED_OFFSET) * 641, i + SEED_OFFSET + 1));
  if (OUT && (i + 1) % 4 === 0) fs.writeFileSync(OUT, JSON.stringify(rows));
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(`${rows.filter((r) => !r.error).length} marches complete`);
