// Shared rig for the Phase 2 isolation tests.
//
// Phase 1 measured what happens. Phase 2 has to show WHY, which means changing one
// thing at a time against a character that is otherwise identical. Two things make
// that possible here:
//
//   marchTo()  -- a character that actually walked to the zone, carrying the gear it
//                 picked up on the way. The Phase 1 King probe synthesised gear from a
//                 narrow window and so reported the fight as harder than it is; a
//                 snapshot of a real march is the only honest subject for a boss test.
//
//   fightKing() -- the same character against a King whose health, damage and armour
//                 can each be scaled independently, so the matrix can separate "too
//                 much health" from "hits too hard" instead of guessing.

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, upgradeRarity, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent } from '../js/data/talents.js';
import {
  xpToNext, MOBS_PER_ZONE, MAX_LEVEL, STALL_DEATHS, STALL_DROP, isMajorBossZone,
} from '../js/data/mobs.js';

export const STEP = 0.1;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
export const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
export const pctOf = (n, d) => (d ? (n / d) * 100 : 0);

/** The Phase 1 archetypes, unchanged, so Phase 2 measures the same subjects. */
export const STYLES = [
  { id: 'war-bleed',   cls: 'warrior', arch: 'damage over time',  types: ['bleed'],    want: ['dotDmg', 'bleedDmg', 'dotCrit'] },
  { id: 'war-thorns',  cls: 'warrior', arch: 'defensive/reflect', types: ['physical'], want: ['thorns', 'armorPct', 'hpPct'] },
  { id: 'war-shouts',  cls: 'warrior', arch: 'ability/buff',      types: ['physical'], want: ['abilityDmg', 'physicalDmg'] },
  { id: 'war-crit',    cls: 'warrior', arch: 'critical strike',   types: ['physical'], want: ['crit', 'critDmg'] },
  { id: 'war-haste',   cls: 'warrior', arch: 'attack speed',      types: ['physical'], want: ['haste'] },
  { id: 'war-auto',    cls: 'warrior', arch: 'basic attack',      types: ['physical'], want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'war-glass',   cls: 'warrior', arch: 'glass cannon',      types: ['physical'], want: ['critDmg', 'abilityDmg', 'physicalDmg'] },
  { id: 'war-sustain', cls: 'warrior', arch: 'sustain/leech',     types: ['physical'], want: ['leech', 'hpPct', 'thorns'] },

  { id: 'hun-ranger',  cls: 'hunter',  solo: true, arch: 'ability/physical', types: ['physical', 'arcane'], want: ['physicalDmg', 'abilityDmg'] },
  { id: 'hun-poison',  cls: 'hunter',  solo: true, arch: 'damage over time', types: ['poison', 'bleed'],    want: ['dotDmg', 'poisonDmg', 'dotCrit'] },
  { id: 'hun-pack',    cls: 'hunter',  pet: true,  arch: 'companion',        types: ['physical'],           want: ['petPow', 'petHaste', 'petHp'] },
  { id: 'hun-crit',    cls: 'hunter',  solo: true, arch: 'critical strike',  types: ['physical'],           want: ['crit', 'critDmg'] },
  { id: 'hun-haste',   cls: 'hunter',  solo: true, arch: 'attack speed',     types: ['physical'],           want: ['haste'] },
  { id: 'hun-auto',    cls: 'hunter',  solo: true, arch: 'basic attack',     types: ['physical'],           want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'hun-petdot',  cls: 'hunter',  pet: true,  arch: 'hybrid pet + dot', types: ['poison'],             want: ['petPow', 'petType', 'dotDmg'] },
  { id: 'hun-tank',    cls: 'hunter',  pet: true,  arch: 'defensive',        types: ['physical'],           want: ['petHp', 'petArmor', 'hpPct', 'armorPct'] },

  { id: 'pri-holy',    cls: 'priest',  solo: true, arch: 'ability/holy',     types: ['holy', 'fire'], want: ['holyDmg', 'abilityDmg'] },
  { id: 'pri-shadow',  cls: 'priest',  solo: true, arch: 'damage over time', types: ['shadow'],       want: ['dotDmg', 'shadowDmg', 'dotCrit'] },
  { id: 'pri-faith',   cls: 'priest',  pet: true,  arch: 'companion',        types: ['holy'],         want: ['petPow', 'petHaste'] },
  { id: 'pri-crit',    cls: 'priest',  solo: true, arch: 'critical strike',  types: ['holy'],         want: ['crit', 'critDmg'] },
  { id: 'pri-heal',    cls: 'priest',  pet: true,  arch: 'healing/sustain',  types: ['holy'],         want: ['healPow', 'hpPct', 'petHp'] },
  { id: 'pri-auto',    cls: 'priest',  solo: true, arch: 'basic attack',     types: ['holy'],         want: ['autoDmg', 'haste'] },
  { id: 'pri-atone',   cls: 'priest',  pet: true,  arch: 'off-meta atonement', types: ['holy'],       want: ['atonement', 'healPow'] },

  { id: 'lok-fire',    cls: 'warlock', solo: true, arch: 'fire/dot',         types: ['fire'],           want: ['fireDmg', 'dotDmg'] },
  { id: 'lok-shadow',  cls: 'warlock', solo: true, arch: 'shadow/dot',       types: ['shadow'],         want: ['shadowDmg', 'dotDmg', 'dotCrit'] },
  { id: 'lok-demo',    cls: 'warlock', pet: true,  arch: 'companion',        types: ['fire', 'shadow'], want: ['petPow', 'petHaste'] },
  { id: 'lok-crit',    cls: 'warlock', solo: true, arch: 'critical strike',  types: ['fire'],           want: ['crit', 'critDmg'] },
  { id: 'lok-haste',   cls: 'warlock', solo: true, arch: 'cast speed',       types: ['shadow'],         want: ['haste'] },
  { id: 'lok-drain',   cls: 'warlock', solo: true, arch: 'sustain/drain',    types: ['shadow'],         want: ['leech', 'hpPct'] },
  { id: 'lok-auto',    cls: 'warlock', solo: true, arch: 'basic attack',     types: ['shadow'],         want: ['autoDmg', 'haste', 'autoDot'] },
  { id: 'lok-petfire', cls: 'warlock', pet: true,  arch: 'off-meta pet fire', types: ['fire'],          want: ['petType', 'fireDmg', 'petPow'] },
];

export const styleById = (id) => STYLES.find((s) => s.id === id);

export function kitFor(style, level) {
  const pool = CLASSES[style.cls].abilities.filter((a) => a.unlock <= level);
  const damage = (a) => ((a.coef || 0) * (a.ticks || 1) + (a.burst || 0) + (a.executeCoef || 0) * 0.3) / Math.max(1, a.cd || 1);
  const solo = Boolean(style.solo);
  let wanted = pool.filter((a) => {
    if (style.pet && ['petstrike', 'buffpet'].includes(a.kind)) return true;
    if (solo && ['petstrike', 'buffpet', 'healpet'].includes(a.kind) && !a.solo) return false;
    return !style.types || style.types.includes(a.type || 'physical');
  });
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
  if (sustain && !kit.some((id) => { const a = pool.find((x) => x.id === id); return a && ['healpet', 'hot', 'drain'].includes(a.kind); })) {
    kit[kit.length - 1] = sustain.id;
  }
  return kit;
}

export function talentsFor(style, level, kit) {
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

/**
 * Walk a character to `targetZone` the way a player would, and hand back the save.
 *
 * Everything the character owns at the end -- level, gear, enchants, embers, talents --
 * was earned on the way in. That is the whole point: a boss test against a synthesised
 * character measures the synthesiser, not the boss.
 */
export function marchTo(style, seed, targetZone = 99, timeCap = 10 * 60 * 60) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed * 7919 + 13));
  const solo = Boolean(style.solo);
  const s = newSave(style.cls, 'P2');
  s.petChoice = CLASSES[style.cls].companion ? (solo ? 'solo' : 'pet') : null;

  const respec = () => {
    const kit = kitFor(style, s.level);
    for (const a of CLASSES[style.cls].abilities) s.abilityToggles[a.id] = kit.includes(a.id);
    s.talents = talentsFor(style, s.level, kit);
  };
  respec();

  let enc = new Encounter(s, () => {});
  let t = 0, lastLevel = 1, streak = 0, deaths = 0, embers = 0;
  while (t < timeCap && s.zone < targetZone) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { save: s, error: e.message, seconds: t, deaths }; }
    t += STEP;
    // Embers accrue with time at the screen, exactly as in tools/lab.mjs. Leaving them
    // out costs the character up to +25% on power, health and armour -- which is the
    // difference between a subject that can fight the King and one that cannot.
    if (embers < 25 && t > (embers + 1) * 420) { embers++; s.embers = embers; }

    if (r === 'win') {
      streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp; s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }
      const d = rollDrop(s.classId, s.zone, mob.boss, { solo, level: s.level, killIndex: s.totalKills });
      if (d) {
        const cur = s.equipped[d.slot];
        if (!cur || (d.setId && !cur.setId) || itemScore(d) > itemScore(cur)) s.equipped[d.slot] = d;
      }
      if (mob.boss) {
        // Every tenth zone promotes the best non-legendary piece worn, as in lab.mjs.
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
      if (s.level !== lastLevel) { respec(); lastLevel = s.level; }
      enc = new Encounter(s, () => {});
    } else if (r === 'lose') {
      deaths++; streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      enc = new Encounter(s, () => {});
    }
  }
  return { save: s, seconds: t, deaths, reached: s.zone, capped: s.zone < targetZone };
}

/**
 * One fight against the final boss, with his numbers scaled independently.
 *
 * `hp`, `ap` and `armor` are multipliers on what he would otherwise have, so a run of
 * the matrix separates "he has too much health" from "he hits too hard" rather than
 * folding both into a single difficulty dial.
 */
export function fightKing(save, seed, { hp = 1, ap = 1, armor = 1, cap = 900 } = {}) {
  const s = { ...save, zone: 100, mobsKilledInZone: 0, checkpoint: 100 };
  setCombatRng(mulberry32(seed));
  const enc = new Encounter(s, () => {});
  enc.enemy.maxHp = Math.round(enc.enemy.maxHp * hp);
  enc.enemy.hp = enc.enemy.maxHp;
  enc.enemy.ap *= ap;
  enc.enemy.armor *= armor;

  const kingHp = enc.enemy.maxHp;
  const playerMax = enc.player.maxHp;
  let t = 0, res = null;
  let lowest = 1;
  while (t < cap) {
    const r = enc.tick(STEP);
    t += STEP;
    lowest = Math.min(lowest, Math.max(0, enc.player.hp) / playerMax);
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  if (!res) res = 'timeout';
  return {
    res,
    won: res === 'win',
    seconds: t,
    // How much of him was left when it ended: the number that says whether a loss was
    // close or hopeless.
    kingLeft: Math.max(0, enc.enemy.hp) / kingHp,
    removed: 1 - Math.max(0, enc.enemy.hp) / kingHp,
    lowestHpFrac: lowest,
    playerMax,
  };
}

/** Attempts until the first win, capped. Models a player retrying from the checkpoint. */
export function kingAttempts(save, seed, opts = {}, maxTries = 60) {
  let tries = 0;
  const removed = [];
  for (let i = 0; i < maxTries; i++) {
    tries++;
    const r = fightKing(save, seed + i * 977, opts);
    removed.push(r.removed);
    if (r.won) return { tries, won: true, firstRemoved: removed[0], bestRemoved: Math.max(...removed) };
  }
  return { tries, won: false, firstRemoved: removed[0], bestRemoved: Math.max(...removed) };
}
