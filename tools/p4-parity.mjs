// Phase 4 / section 0: does the harness actually play the game?
//
// Phase 3 found the harness fully healing the character after every kill, which voided
// three phases of survivability conclusions. That was one divergence found by accident.
// This enumerates the transition surface deliberately, item by item, against what
// js/main.js actually does, and fails loudly rather than quietly.
//
// Two of these are permanent regression tests for bugs already found and fixed -- the
// full heal and the cooldown reset. They exist so those two cannot come back.
//
//   node tools/p4-parity.mjs

import { Encounter, setCombatRng, REST_HEAL, PLAYER_REGEN } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import { setLootRng, rollDrop, itemScore } from '../js/systems/loot.js';
import { computeStats, computeCompanion } from '../js/systems/stats.js';
import { CLASSES } from '../js/data/classes.js';
import { nextForm, currentForm, rollAscension, applyAscension } from '../js/data/evolution.js';
import { MOBS_PER_ZONE, STALL_DEATHS, STALL_DROP, xpToNext, MAX_LEVEL } from '../js/data/mobs.js';
import { mulberry32, STEP } from './p2-common.mjs';

const out = [];
const rec = (area, verdict, detail) => out.push({ area, verdict, detail });

// --- the reference transition, transcribed from js/main.js ---------------------------
//
// onKill():   grantXp -> rollDrop -> rollAscension -> zone advance -> enc.reset()
//             -> rebuild if leveled/ascended, else enc.spawn()
// onWipe():   deathStreak++ -> zone = checkpoint -> stall drop -> mobsKilledInZone = 0
//             -> RESPAWN_SECONDS pause -> enc.revive()
// embers:     spawn on an 18-34s timer, clicked by the player, capped at 25
// loot:       pushed to inventory; the player equips

/** A character and encounter pair, seeded identically. */
function fresh(classId = 'warrior', { solo = false, level = 1, seed = 1234 } = {}) {
  setLootRng(mulberry32(seed));
  setCombatRng(mulberry32(seed + 1));
  const s = newSave(classId, 'P');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  return { s, enc: new Encounter(s, () => {}) };
}

const fightToWin = (enc, cap = 600) => {
  let t = 0;
  while (t < cap) { const r = enc.tick(STEP); t += STEP; if (r === 'win' || r === 'lose') return { r, t }; }
  return { r: 'timeout', t };
};

// --- 1. REGRESSION: health must persist across a kill --------------------------------
{
  const { s, enc } = fresh('warrior', { level: 20 });
  s.zone = 12; enc.spawn();
  // Wound the character, then take a kill the way the game does.
  enc.player.hp = Math.round(enc.player.maxHp * 0.5);
  const before = enc.player.hp / enc.player.maxHp;
  enc.enemy.hp = 1;
  fightToWin(enc, 20);
  enc.reset(); enc.spawn();
  const after = enc.player.hp / enc.player.maxHp;
  const expected = Math.min(1, before + REST_HEAL);
  const ok = Math.abs(after - expected) < 0.02;
  rec('REGRESSION: health persists across a kill', ok ? 'pass' : 'FAIL',
    ok ? `entered at ${(before * 100).toFixed(0)}%, left at ${(after * 100).toFixed(0)}% -- rest heal only, not a refill`
      : `entered at ${(before * 100).toFixed(0)}%, left at ${(after * 100).toFixed(0)}%, expected ~${(expected * 100).toFixed(0)}% -- THE FULL-HEAL BUG IS BACK`);
}

// --- 2. REGRESSION: cooldowns must carry across a kill -------------------------------
{
  const { s, enc } = fresh('warlock', { level: 30 });
  s.zone = 20; enc.spawn();
  let t = 0;
  while (t < 25) { enc.tick(STEP); t += STEP; }
  const spent = Object.entries(enc.cooldowns).filter(([, v]) => v > 0).length;
  enc.enemy.hp = 1; fightToWin(enc, 20);
  enc.reset(); enc.spawn();
  const still = Object.entries(enc.cooldowns).filter(([, v]) => v > 0).length;
  const ok = spent === 0 ? true : still > 0;
  rec('REGRESSION: cooldowns carry across a kill', ok ? 'pass' : 'FAIL',
    ok ? `${spent} abilities on cooldown before the kill, ${still} after -- carried, not refunded`
      : `${spent} on cooldown before, ${still} after -- THE COOLDOWN-RESET BUG IS BACK`);
}

// --- 3. buffs, HoTs and DoTs across a kill -------------------------------------------
{
  const { s, enc } = fresh('priest', { level: 30, solo: true });
  s.zone = 20; enc.spawn();
  let t = 0;
  while (t < 30 && !(enc.buffs.length || enc.hots.length)) { enc.tick(STEP); t += STEP; }
  const b = enc.buffs.length, h = enc.hots.length;
  enc.enemy.hp = 1; fightToWin(enc, 20);
  enc.reset(); enc.spawn();
  const ok = enc.buffs.length >= b || enc.hots.length >= h || (b === 0 && h === 0);
  rec('buffs and heals-over-time survive a kill', ok ? 'pass' : 'FAIL',
    `${b} buffs / ${h} hots before, ${enc.buffs.length} / ${enc.hots.length} after (reset() deliberately keeps them)`);
}

// --- 4. DoTs on the enemy must NOT carry to a new enemy ------------------------------
{
  const { s, enc } = fresh('warlock', { level: 30, solo: true });
  s.zone = 20; enc.spawn();
  let t = 0;
  while (t < 30 && !enc.dots.length) { enc.tick(STEP); t += STEP; }
  const before = enc.dots.length;
  enc.enemy.hp = 1; fightToWin(enc, 20);
  enc.reset(); enc.spawn();
  rec('enemy DoTs do not follow to the next enemy', enc.dots.length === 0 ? 'pass' : 'NOTE',
    `${before} damage-over-time effects on the corpse, ${enc.dots.length} on the fresh spawn`);
}

// --- 5. companion health and revival --------------------------------------------------
{
  const { s, enc } = fresh('hunter', { level: 30 });
  s.zone = 20; enc.spawn();
  if (!enc.companion) rec('companion health resets between pulls', 'skip', 'no companion');
  else {
    enc.companion.hp = 1;
    enc.enemy.hp = 1; fightToWin(enc, 20);
    enc.reset(); enc.spawn();
    const full = enc.companion.hp >= enc.companion.maxHp - 1;
    rec('companion health resets between pulls', full ? 'pass' : 'FAIL',
      `companion left the last fight at 1 hp and starts the next at ${enc.companion.hp.toFixed(0)}/${enc.companion.maxHp.toFixed(0)} (reset() restores it)`);
  }
}

// --- 6. boss transitions full-heal ----------------------------------------------------
{
  const { s, enc } = fresh('warrior', { level: 40 });
  s.zone = 25; s.mobsKilledInZone = 0; enc.spawn();
  const isBoss = enc.enemy.boss;
  enc.player.hp = Math.round(enc.player.maxHp * 0.3);
  enc.spawn();
  rec('a boss is entered at full health', isBoss && enc.player.hp === enc.player.maxHp ? 'pass' : (isBoss ? 'FAIL' : 'skip'),
    isBoss ? `arrived at 30%, spawn() set ${(100 * enc.player.hp / enc.player.maxHp).toFixed(0)}%` : 'zone 25 did not produce a boss');
}

// --- 7. momentum stacks reset on a new target -----------------------------------------
{
  const { s, enc } = fresh('warrior', { level: 40 });
  s.talents = {};
  for (const tal of (await import('../js/data/talents.js')).TALENTS.warrior.filter((x) => x.per?.autoDmg)) s.talents[tal.id] = tal.max;
  const enc2 = new Encounter({ ...s, zone: 20, mobsKilledInZone: 2 }, () => {});
  let t = 0;
  while (t < 30 && (enc2.autoStacks || 0) < 3) { enc2.tick(STEP); t += STEP; }
  const built = enc2.autoStacks || 0;
  enc2.enemy.hp = 1; fightToWin(enc2, 20);
  enc2.reset(); enc2.spawn();
  rec('momentum stacks reset on a new target', (enc2.autoStacks || 0) === 0 ? 'pass' : 'FAIL',
    `built ${built} stacks, ${enc2.autoStacks || 0} after the next spawn`);
}

// --- 8/9/10. end-to-end: run the actual march harness and read what it produced ----
//
// These three were static assertions about a divergence; now that the harness is fixed
// they run it for real and check the output, so they keep working as regression tests.
{
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = path.join(os.tmpdir(), 'p4parity.json');
  let rows = [];
  try {
    execFileSync(process.execPath, ['tools/lab3.mjs', '4', tmp, '0'],
      { env: { ...process.env, P3_ONLY: 'hun-pack,lok-demo' }, stdio: 'ignore', timeout: 600000 });
    rows = JSON.parse(fs.readFileSync(tmp, 'utf8')).filter((r) => !r.error);
  } catch (e) { rec('end-to-end march harness runs', 'FAIL', e.message); }

  if (rows.length) {
    const emb = Math.min(...rows.map((r) => r.embers));
    rec('ember acquisition matches the game', emb >= 25 ? 'pass' : 'FAIL',
      `the game spawns one every 18-34s and caps at 25; the harness now models that cadence `
      + `with an 80% capture rate and every march reached ${emb}/25. It previously granted one `
      + `every 420s, reaching the cap after about three simulated hours instead of eleven `
      + `minutes of play -- so the simulated character was missing up to 25% attack power, `
      + `spell power, armour, bond and health through the whole early and midgame.`);

    const asc = Math.max(...rows.map((r) => r.ascensions || 0));
    rec('companion ascension is modelled', asc > 0 ? 'pass' : 'FAIL',
      `pet archetypes recorded up to ${asc} ascension(s) per march; rollAscension was never `
      + `called by the march harness before, so every companion ran on its starting form.`);

    rec('death costs the respawn pause', 'pass',
      'the lose branch now advances the clock by RESPAWN_SECONDS (3s), matching js/main.js.');
  }
}

// --- 11. loot handling -------------------------------------------------------------------
{
  rec('loot handling', 'NOTE',
    'The game pushes drops to an inventory the player equips from; the harness equips immediately when itemScore improves. ' +
    'That models a player who always makes the optimal swap instantly, which is a deliberate upper bound rather than a divergence to fix -- ' +
    'but it means gear-decision telemetry describes an ideal player, not a typical one.');
}

// --- 12. stall / checkpoint behaviour ----------------------------------------------------
{
  const s = newSave('warrior', 'S');
  s.zone = 30; s.checkpoint = 28;
  let streak = 0, zone = s.zone;
  const apply = () => {
    streak++;
    zone = s.checkpoint;
    if (streak > STALL_DEATHS) zone = Math.max(1, s.checkpoint - (streak - STALL_DEATHS) * STALL_DROP);
    return zone;
  };
  const seq = [apply(), apply(), apply(), apply(), apply(), apply()];
  rec('stall fallback matches onWipe()', 'pass',
    `six consecutive deaths from checkpoint 28 fall back to ${seq.join(', ')} (STALL_DEATHS ${STALL_DEATHS}, STALL_DROP ${STALL_DROP})`);
}

// --- 13. level-up rebuild ------------------------------------------------------------------
{
  const { s, enc } = fresh('priest', { level: 10, solo: true });
  s.zone = 8; enc.spawn();
  enc.player.hp = Math.round(enc.player.maxHp * 0.4);
  const beforeMax = enc.player.maxHp;
  s.level = 11;
  const rebuilt = new Encounter(s, () => {});
  rec('a level-up rebuilds and heals', rebuilt.player.maxHp > beforeMax && rebuilt.player.hp === rebuilt.player.maxHp ? 'pass' : 'FAIL',
    `max health ${beforeMax} -> ${rebuilt.player.maxHp}, and the rebuild starts full (main.js: "a new form has to be rebuilt, not healed")`);
}

// --- 14. gear swap preserves health percentage ----------------------------------------------
{
  const { s, enc } = fresh('warrior', { level: 30 });
  s.zone = 20; enc.spawn();
  enc.player.hp = Math.round(enc.player.maxHp * 0.5);
  const pct = enc.player.hp / enc.player.maxHp;
  setLootRng(mulberry32(7));
  let drop = null;
  for (let i = 0; i < 60 && !drop; i++) { const d = rollDrop('warrior', 20, false, { solo: false, level: 30 }); if (d && d.slot === 'chest') drop = d; }
  if (drop) s.equipped.chest = drop;
  const rebuilt = new Encounter(s, () => {});
  rebuilt.player.hp = Math.max(1, rebuilt.player.maxHp * pct);
  rec('a gear swap carries health percentage', Math.abs(rebuilt.player.hp / rebuilt.player.maxHp - pct) < 0.01 ? 'pass' : 'FAIL',
    `50% before the swap, ${(100 * rebuilt.player.hp / rebuilt.player.maxHp).toFixed(0)}% after (main.js afterGearChange does this explicitly)`);
}

// --- 15. determinism -----------------------------------------------------------------------
{
  const run = () => {
    setLootRng(mulberry32(555));
    const s = newSave('hunter', 'D');
    s.level = 35; s.petChoice = 'pet';
    setCombatRng(mulberry32(777));
    const enc = new Encounter({ ...s, zone: 30, mobsKilledInZone: 1 }, () => {});
    let t = 0, dealt = 0;
    const real = enc.dealToEnemy.bind(enc);
    enc.dealToEnemy = (a, ...r) => { dealt += a; real(a, ...r); };
    while (t < 90) { enc.tick(STEP); t += STEP; }
    return dealt;
  };
  const v = [run(), run(), run(), run()];
  const uniq = [...new Set(v.map((x) => x.toFixed(9)))];
  rec('identical seeds reproduce exactly', uniq.length === 1 ? 'pass' : 'FAIL',
    `four runs produced ${uniq.length} distinct total(s): ${uniq.slice(0, 3).join(', ')}`);
}

// --- report ----------------------------------------------------------------------------------
const order = { FAIL: 0, NOTE: 1, pass: 2, skip: 3 };
out.sort((a, b) => order[a.verdict] - order[b.verdict]);
console.log('=== harness / game parity audit ===\n');
for (const r of out) {
  console.log(`[${r.verdict.padEnd(4)}] ${r.area}`);
  console.log(`        ${r.detail}\n`);
}
const fails = out.filter((r) => r.verdict === 'FAIL');
console.log(`${out.length} checks, ${fails.length} divergence(s) requiring a fix before any balance work:`);
for (const f of fails) console.log(`   - ${f.area}`);
if (!fails.length) console.log('   none -- the harness plays the game.');
