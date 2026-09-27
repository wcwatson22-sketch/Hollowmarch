// The Phase 3 laboratory: tools/lab.mjs plus the telemetry Phase 3 asks for.
//
// Everything lab.mjs records is recorded here unchanged and under the same field names,
// and the seed formula and archetype order are identical, so a run of this against a
// run of that compares like with like. What is added is the set of things Phase 2 kept
// having to reconstruct after the fact:
//
//   healing      -- gross AND effective, so overhealing is visible. Phase 2 found a
//                   build healing 2,991/s that died anyway, because almost all of it
//                   landed on a full health bar. Raw healing per second is a misleading
//                   number on its own and should never again be reported alone.
//   mitigation   -- what the armour actually stopped, measured against what the mob
//                   swung for, rather than inferred from the armour value.
//   pacing       -- gaps between kills and between casts, and the longest single fight,
//                   so "technically progressing but nothing is happening" is findable.
//   per block    -- deaths, time, kills and damage in ten-zone blocks, for the
//                   progression curve.
//   gear         -- what dropped, what was taken, what was passed over, and whether an
//                   item was equipped despite being wrong for the build.
//   sanity       -- NaN and Infinity checks on the values a silent failure would show
//                   up in first. A balance result produced by a broken simulation is
//                   worse than no result.
//
//   node tools/lab3.mjs [runs] [outFile] [seedOffset]

import { Encounter, setCombatRng, REST_HEAL } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { rollDrop, itemScore, upgradeRarity, setLootRng } from '../js/systems/loot.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, isPetTalent, branchState } from '../js/data/talents.js';
import { setStateFor } from '../js/data/sets.js';
import { rollAscension, applyAscension } from '../js/data/evolution.js';
import { computeStats, computeCompanion, setAbsorbScale } from '../js/systems/stats.js';
import {
  xpToNext, MOBS_PER_ZONE, MAX_LEVEL, STALL_DEATHS, STALL_DROP, isMajorBossZone,
} from '../js/data/mobs.js';
import fs from 'node:fs';

const RUNS = Number(process.argv[2] || 100);
const OUT = process.argv[3] || null;
const SEED_OFFSET = Number(process.argv[4] || 0);
const STEP = 0.1;
// Tuning sweep hook: P4_ABSORB scales the warrior bulwark rate for tools/p4-warrior.mjs.
if (process.env.P4_ABSORB !== undefined) setAbsorbScale(Number(process.env.P4_ABSORB));
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

  const bySource = {};
  const byKind = { auto: 0, ability: 0, dot: 0, pet: 0, thorns: 0 };
  let dealt = 0, taken = 0;

  // --- added Phase 3 telemetry ------------------------------------------------------
  const healBySource = {};        // gross, as requested
  const healEffBySource = {};     // what the health bar actually gained
  let healGross = 0, healEff = 0;
  let rawIncoming = 0;            // what the swings were worth before armour
  let hitsTaken = 0;
  // Only the damage from those same full hits. Dividing ALL damage taken by the count
  // of full hits reported -362% mitigation for companion builds, where most incoming is
  // splash past the pet and never entered the numerator's denominator at all.
  let takenOnFullHits = 0;
  let castCount = 0, lastCastT = 0, worstCastGap = 0;
  const castCounts = {};          // how often each ability actually fires
  const killGaps = [];
  let longestFight = 0, longestFightZone = 1, fightStart = 0;
  // Five-zone resolution: the midgame investigation needs to separate zones 11-15 from
  // 16-20, and ten-zone blocks can be recovered by pairing these.
  const BLOCK_SIZE = 5;
  const BLOCK_COUNT = 100 / BLOCK_SIZE;
  const block = () => Math.floor((Math.min(100, Math.max(1, s.zone)) - 1) / BLOCK_SIZE);
  const blocks = Array.from({ length: BLOCK_COUNT }, () => ({
    deaths: 0, kills: 0, seconds: 0, taken: 0, dealt: 0, healed: 0, upgrades: 0,
    hpInSum: 0, hpOutSum: 0, fights: 0, restSum: 0,
  }));
  const gear = {
    dropped: 0, taken: 0, passed: 0, setPieces: 0, setBroken: 0,
    // An item taken purely on raw power that carries none of the stats the build wants.
    takenOffStat: 0, rarity: {},
  };
  let sanity = null;              // first NaN/Infinity seen, with context

  // An archetype's `want` list is written in TALENT vocabulary (dotDmg, thorns, leech,
  // bleedDmg...). Gear speaks a different and much smaller language: ap, sp, hp, armor,
  // critRating, hasteRating, abilityPct, petPow, and nothing else. Most of what defines
  // a build therefore cannot appear on an item at all, which is worth measuring rather
  // than glossing -- so this records both how much of the build gear can even express,
  // and how often a taken item carried any of it.
  const WANT_TO_AFFIX = {
    crit: 'critRating', critDmg: 'critRating',
    haste: 'hasteRating', petHaste: 'hasteRating',
    hpPct: 'hp', armorPct: 'armor',
    abilityDmg: 'abilityPct',
    petPow: 'petPow', petHp: 'petPow', petArmor: 'petPow', petType: 'petPow',
  };
  const wantList = style.want || [];
  const wantedAffixes = new Set(wantList.map((w) => WANT_TO_AFFIX[w]).filter(Boolean));
  // How much of this build's identity gear is capable of supplying.
  const expressible = wantList.length
    ? wantList.filter((w) => WANT_TO_AFFIX[w]).length / wantList.length
    : 1;

  // onEvent carries the heals; the health bar carries what actually landed.
  const onEvent = (e) => {
    if (e.type === 'heal' && e.on === 'player') {
      healEffBySource[e.source] = (healEffBySource[e.source] || 0) + (e.amount || 0);
      healEff += e.amount || 0;
    } else if (e.type === 'cast') {
      castCount++;
      castCounts[e.id] = (castCounts[e.id] || 0) + 1;
      const gap = t - lastCastT;
      if (gap > worstCastGap) worstCastGap = gap;
      lastCastT = t;
    }
  };

  let enc = new Encounter(s, onEvent);
  const hook = (e) => {
    const real = e.dealToEnemy.bind(e);
    e.dealToEnemy = (amount, source, crit, kind, school, id) => {
      dealt += amount;
      bySource[source] = (bySource[source] || 0) + amount;
      if (byKind[kind] !== undefined) byKind[kind] += amount;
      blocks[block()].dealt += amount;
      real(amount, source, crit, kind, school, id);
    };
    // Gross healing, before the health bar clamps it. The gap between this and the
    // event total IS the overheal, which is the number Phase 2 needed and did not have.
    const realHeal = e.healPlayer.bind(e);
    e.healPlayer = (amount, source) => {
      healGross += amount;
      healBySource[source] = (healBySource[source] || 0) + amount;
      blocks[block()].healed += amount;
      realHeal(amount, source);
    };
  };
  hook(enc);

  let t = 0, kills = 0, deaths = 0, lastLevel = 1, streak = 0;
  let gearChangedThisKill = false;
  // The attrition curve needs the health bar at the START of each fight, which is the
  // one number that says whether a zone is wearing the character down or not.
  let hpEnteringFight = 1;
  let ascendedThisKill = false;
  let ascensions = 0;
  // A third RNG stream, separate from combat and loot so adding these does not shift a
  // single existing draw and the seeds stay comparable with earlier phases.
  const metaRng = mulberry32(seed * 31 + 7);
  // js/main.js spawns an ember every EMBER_MIN_GAP..EMBER_MAX_GAP seconds and the player
  // clicks it before EMBER_LIFETIME runs out. The harness previously granted one every
  // 420s, which reached the 25-ember cap after about three simulated hours instead of
  // about eleven minutes -- so every measured character was missing up to 25% attack
  // power, spell power, armour, bond and health through the whole early and midgame.
  // CAPTURE is the one modelling assumption here: a real player misses some.
  const EMBER_MIN_GAP = 18, EMBER_MAX_GAP = 34, EMBER_CAPTURE = 0.8;
  let emberTimer = EMBER_MIN_GAP + metaRng() * (EMBER_MAX_GAP - EMBER_MIN_GAP);
  let won = false, deepest = 1, embers = 0, kingAttempts = 0;
  let lastKillT = 0, worstGap = 0, worstGapZone = 1;
  const deathZones = [];
  const milestones = {};
  let hp = enc.player.hp;

  while (t < TIME_CAP) {
    let r;
    try { r = enc.tick(STEP); } catch (e) { return { error: e.message, style: style.id, runNo }; }
    t += STEP;
    if (enc.player.hp < hp) {
      const hit = hp - enc.player.hp;
      taken += hit;
      blocks[block()].taken += hit;
      // Mitigation is only cleanly measurable on a hit that landed on the player
      // whole -- with a companion up the swing is split, so those are left out rather
      // than averaged into a number that means nothing.
      if (!enc.companion || enc.companion.hp <= 0) {
        rawIncoming += enc.enemy.ap;
        takenOnFullHits += hit;
        hitsTaken++;
      }
    }
    hp = enc.player.hp;
    blocks[block()].seconds += STEP;
    if (embers < 25) {
      emberTimer -= STEP;
      if (emberTimer <= 0) {
        if (metaRng() < EMBER_CAPTURE) { embers++; s.embers = embers; }
        emberTimer += EMBER_MIN_GAP + metaRng() * (EMBER_MAX_GAP - EMBER_MIN_GAP);
      }
    }

    // A silent NaN turns every downstream number into confident nonsense, so it is
    // caught here rather than discovered in the report.
    if (sanity === null) {
      const bad = [['player.hp', enc.player.hp], ['enemy.hp', enc.enemy.hp],
        ['player.maxHp', enc.player.maxHp], ['enemy.ap', enc.enemy.ap]];
      for (const [k, v] of bad) {
        if (!Number.isFinite(v)) { sanity = { field: k, value: String(v), t, zone: s.zone }; break; }
      }
    }

    if (r === 'win') {
      kills++; streak = 0;
      const mob = enc.enemy;
      s.xp += mob.xp; s.totalKills = (s.totalKills || 0) + 1;
      while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; }
      for (const L of [20, 40, 60]) if (s.level >= L && !milestones['lv' + L]) milestones['lv' + L] = t / 3600;

      const drop = rollDrop(s.classId, s.zone, mob.boss, { solo, level: s.level, killIndex: s.totalKills });
      if (drop) {
        gear.dropped++;
        const cur = s.equipped[drop.slot];
        const keep = !cur || (drop.setId && !cur.setId) || itemScore(drop) > itemScore(cur);
        if (keep) {
          gear.taken++;
          blocks[block()].upgrades++;
          gear.rarity[drop.rarity] = (gear.rarity[drop.rarity] || 0) + 1;
          if (drop.setId) gear.setPieces++;
          if (cur && cur.setId && !drop.setId) gear.setBroken++;
          // Did the build actually want any of this, or was it taken on raw power?
          // This is the Phase 3 question about whether loot creates a decision.
          if (wantedAffixes.size) {
            const affixes = (drop.affixes || []).map((x) => x.stat);
            if (!affixes.some((x) => wantedAffixes.has(x))) gear.takenOffStat++;
          }
          s.equipped[drop.slot] = drop;
          gearChangedThisKill = true;
        } else {
          gear.passed++;
        }
      }
      // Rolled before the zone advances, exactly as onKill() does, so the gate is
      // measured against the zone actually fought in. The march harness never called
      // this, so every pet archetype has been simulated on its starting form while a
      // real companion upgrades its health, attack power, armour and swing time.
      if (rollAscension(s, mob.boss, metaRng)) { applyAscension(s); ascensions++; ascendedThisKill = true; }

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
      killGaps.push(t - lastKillT);
      lastKillT = t;
      blocks[block()].kills++;
      if (t - fightStart > longestFight) { longestFight = t - fightStart; longestFightZone = s.zone; }
      fightStart = t;
      // The attrition ledger for the block this fight happened in: what the character
      // walked in with, what it walked out with, and what the rest between pulls put
      // back. A zone that cannot wear anyone down shows up here as hpIn staying at 1.
      {
        const b = blocks[block()];
        const hpOut = Math.max(0, enc.player.hp) / enc.player.maxHp;
        b.hpInSum += hpEnteringFight;
        b.hpOutSum += hpOut;
        b.fights++;
        b.restSum += Math.min(1, hpOut + REST_HEAL) - hpOut;
      }
      // Advance the way js/main.js does, which is NOT what this harness used to do.
      //
      // It built a fresh Encounter after every kill, and the Encounter constructor sets
      // player.hp to maxHp -- so every simulated character was fully healed after every
      // single mob, in every march of every phase. REST_HEAL was never once exercised,
      // the attrition model the code is built around was never tested, and deaths could
      // only ever happen inside a single fight. The real game calls reset() (which
      // applies REST_HEAL and stands the companion back up) and then spawn(), and it
      // rebuilds only on a level-up or an ascension, where a full heal is intended
      // because the whole stat block changed.
      //
      // Rebuilding also handed back every cooldown, which the code comments in reset()
      // explicitly say must carry across pulls -- so long-cooldown burst was being
      // measured with perfect uptime it does not have.
      const leveled = s.level !== lastLevel || ascendedThisKill;
      enc.reset();
      if (leveled) {
        if (s.level !== lastLevel) { kit = respec(); lastLevel = s.level; }
        enc = new Encounter(s, onEvent); hook(enc);
      } else if (gearChangedThisKill) {
        // Mirrors afterGearChange(): new stats, but health PERCENTAGES carry, because
        // otherwise picking up an item is a free full heal.
        const pPct = enc.player.hp / enc.player.maxHp;
        const cPct = enc.companion ? enc.companion.hp / enc.companion.maxHp : 1;
        enc = new Encounter(s, onEvent); hook(enc);
        enc.player.hp = Math.max(1, enc.player.maxHp * pPct);
        if (enc.companion) enc.companion.hp = enc.companion.maxHp * cPct;
      }
      enc.spawn();
      gearChangedThisKill = false; ascendedThisKill = false;
      hp = enc.player.hp;
      hpEnteringFight = enc.player.hp / enc.player.maxHp;
    } else if (r === 'lose') {
      deaths++; deathZones.push(s.zone);
      blocks[block()].deaths++;
      fightStart = t;
      if (s.zone >= 100) kingAttempts++;
      streak++;
      s.zone = Math.max(1, s.checkpoint || 1);
      if (streak > STALL_DEATHS) s.zone = Math.max(1, s.zone - (streak - STALL_DEATHS) * STALL_DROP);
      s.mobsKilledInZone = 0;
      // js/main.js pauses for RESPAWN_SECONDS before you are back on your feet.
      t += 3;
      enc = new Encounter(s, onEvent); hook(enc); hp = enc.player.hp;
      hpEnteringFight = 1;
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

    // --- Phase 3 additions ---------------------------------------------------------
    heal: {
      grossPerSec: healGross / Math.max(1, t),
      effPerSec: healEff / Math.max(1, t),
      // The share of healing that hit a full health bar and did nothing.
      overhealPct: healGross > 0 ? 1 - healEff / healGross : 0,
      bySource: Object.fromEntries(Object.entries(healBySource).map(([k, v]) => [
        k, { gross: v, eff: healEffBySource[k] || 0, over: v > 0 ? 1 - (healEffBySource[k] || 0) / v : 0 },
      ])),
    },
    // Measured, not inferred: what the swings were worth against what landed.
    mitigation: rawIncoming > 0 ? 1 - takenOnFullHits / rawIncoming : 0,
    fullHitsTaken: hitsTaken,
    pacing: {
      castsPerMin: (castCount / Math.max(1, t)) * 60,
      worstCastGapSec: worstCastGap,
      medianKillGapSec: killGaps.length ? [...killGaps].sort((a, b) => a - b)[Math.floor(killGaps.length / 2)] : 0,
      meanKillGapSec: killGaps.length ? killGaps.reduce((x, y) => x + y, 0) / killGaps.length : 0,
      p95KillGapSec: killGaps.length ? [...killGaps].sort((a, b) => a - b)[Math.floor(killGaps.length * 0.95)] : 0,
      longestFightSec: longestFight,
      longestFightZone,
    },
    castCounts,
    blocks,
    gear: {
      ...gear,
      // Did loot give the build what it was asking for, or just bigger numbers?
      offStatShare: gear.taken > 0 ? gear.takenOffStat / gear.taken : 0,
      // Share of what this build is built around that gear is able to supply at all.
      expressible,
      ilvl: Object.values(s.equipped).reduce((n, it) => n + (it ? it.ilvl : 0), 0),
    },
    ascensions,
    sanity,
  };
}

// An isolation run: P3_ONLY=hun-haste restricts the pool to one archetype so an
// outlier can be re-measured at a sample size that means something, without disturbing
// the seed formula the full regressions share.
const ONLY = (process.env.P3_ONLY || '').split(',').filter(Boolean);
const POOL = ONLY.length ? STYLES.filter((x) => ONLY.includes(x.id)) : STYLES;
if (ONLY.length && !POOL.length) { console.error('P3_ONLY matched no archetype'); process.exit(1); }

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const style = POOL[(i + SEED_OFFSET) % POOL.length];
  rows.push(march(style, 70000 + (i + SEED_OFFSET) * 641, i + SEED_OFFSET + 1));
  if (OUT && (i + 1) % 4 === 0) fs.writeFileSync(OUT, JSON.stringify(rows));
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(`${rows.filter((r) => !r.error).length} marches complete`);
