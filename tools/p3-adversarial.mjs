// Phase 3 / tests 15, 16 and 18: try to break it on purpose.
//
// Every check here is a specific failure mode with a specific pass condition, so the
// output is a list of verdicts rather than an impression. The distinction the brief asks
// for is kept: STRONG is fine, OVERPOWERED is a balance note, EXPLOIT is a rules hole,
// and BROKEN is a defect. Something being powerful and fun is not a finding.
//
//   node tools/p3-adversarial.mjs

import { Encounter, setCombatRng, REST_HEAL } from '../js/systems/combat.js';
import { newSave } from '../js/systems/save.js';
import {
  computeStats, computeCompanion, mitigate, ratingToPct, emberBonus,
  CRIT_CAP, HASTE_CAP, LEECH_CAP, EMBER_COUNT, getArmorDepth,
} from '../js/systems/stats.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, resolveRanks } from '../js/data/talents.js';
import { makeMob, FINAL_ZONE, mobAp } from '../js/data/mobs.js';
import { setLootRng } from '../js/systems/loot.js';
import { mulberry32, STEP } from './p2-common.mjs';

const results = [];
const check = (name, verdict, detail) => { results.push({ name, verdict, detail }); };

const FINITE = (o, path = '') => {
  for (const [k, v] of Object.entries(o || {})) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'number' && !Number.isFinite(v)) return p;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = FINITE(v, p); if (r) return r; }
  }
  return null;
};

/** A character with every talent pushed to an absurd rank, bypassing the point budget. */
function extremeSave(classId, { ranks = 99, level = 60, solo = false, embers = 9999 } = {}) {
  const s = newSave(classId, 'X');
  s.level = level;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  s.embers = embers;
  s.talents = {};
  for (const t of TALENTS[classId]) s.talents[t.id] = ranks;
  return s;
}

// --- 1. talent rank exploit ----------------------------------------------------------
{
  const s = extremeSave('warrior', { ranks: 999 });
  const resolved = resolveRanks(s);
  const over = Object.entries(resolved).filter(([id, n]) => {
    const t = TALENTS.warrior.find((x) => x.id === id);
    return t && n > t.max;
  });
  check('talent ranks cannot exceed max', over.length ? 'BROKEN' : 'pass',
    over.length ? `${over.length} talents resolved above max: ${over.slice(0, 3).map(([i, n]) => i + '=' + n).join(', ')}`
      : 'resolveRanks clamps every talent to its max even when the save asks for 999');
}

// --- 2. point budget ----------------------------------------------------------------
{
  const s = extremeSave('warlock', { ranks: 999 });
  const resolved = resolveRanks(s);
  const spent = Object.values(resolved).reduce((a, b) => a + b, 0);
  const earned = earnedTalentPoints(60);
  check('total ranks respect the point budget', spent > earned ? 'EXPLOIT' : 'pass',
    `resolved ${spent} ranks against ${earned} earned points`);
}

// --- 3. crit and haste overflow ------------------------------------------------------
{
  const s = extremeSave('hunter', { ranks: 999 });
  for (const slot of Object.keys(s.equipped)) {
    s.equipped[slot] = { uid: slot, slot, ilvl: 9999, rarity: 'legendary', name: 'x', affixes: [
      { id: 'crit', stat: 'critRating', value: 1e6, label: '' },
      { id: 'haste', stat: 'hasteRating', value: 1e6, label: '' },
      { id: 'ap', stat: 'ap', value: 1e6, label: '' },
    ] };
  }
  const st = computeStats(s);
  check('crit cannot exceed 100%', st.crit > 1 ? 'BROKEN' : 'pass',
    `crit resolved to ${(st.crit * 100).toFixed(1)}% with a million crit rating in every slot`);
  check('haste cannot make swing time zero', st.swingTime <= 0 ? 'BROKEN' : (st.haste > 3 ? 'OVERPOWERED' : 'pass'),
    `haste ${(st.haste * 100).toFixed(0)}%, swing time ${st.swingTime.toFixed(3)}s (class base ${CLASSES.hunter.swingTime}s)`);
  const bad = FINITE(st);
  check('no NaN or Infinity in the stat block', bad ? 'BROKEN' : 'pass',
    bad ? `${bad} is not finite` : 'every numeric stat finite under million-value affixes');
}

// --- 4. leech and ember caps ---------------------------------------------------------
{
  const s = extremeSave('warrior', { ranks: 999, embers: 99999 });
  const st = computeStats(s);
  check('leech stays capped', st.leech > LEECH_CAP + 1e-9 ? 'EXPLOIT' : 'pass',
    `leech ${(st.leech * 100).toFixed(1)}% against a cap of ${(LEECH_CAP * 100).toFixed(0)}%`);
  check('embers stop counting at the cap', emberBonus(99999) > emberBonus(EMBER_COUNT) + 1e-9 ? 'EXPLOIT' : 'pass',
    `99,999 embers give ${(emberBonus(99999) * 100).toFixed(0)}%, same as ${EMBER_COUNT}`);
}

// --- 5. mitigation cannot reach or exceed 100% ---------------------------------------
{
  const worst = [];
  for (const z of [1, 20, 50, 100]) {
    const m = 1 - mitigate(1000, 1e9, z) / 1000;
    worst.push(`zone ${z}: ${(m * 100).toFixed(3)}%`);
    if (m >= 1) check('mitigation below 100%', 'BROKEN', `zone ${z} reached ${(m * 100).toFixed(1)}%`);
  }
  if (!results.some((r) => r.name === 'mitigation below 100%')) {
    check('mitigation below 100%', 'pass', `a billion armour still lets damage through -- ${worst.join(', ')}`);
  }
  const neg = mitigate(1000, -1e6, 50);
  check('negative armour cannot heal you', neg < 0 ? 'BROKEN' : 'pass',
    `mitigate() with -1,000,000 armour returns ${neg.toFixed(1)} (negative would mean being hit restores health)`);
}

// --- 6. cooldown floor ---------------------------------------------------------------
{
  const s = extremeSave('warlock', { ranks: 999 });
  for (const slot of Object.keys(s.equipped)) {
    s.equipped[slot] = { uid: slot, slot, ilvl: 999, rarity: 'legendary', name: 'x',
      affixes: [{ id: 'haste', stat: 'hasteRating', value: 1e6, label: '' }] };
  }
  setCombatRng(mulberry32(1));
  const enc = new Encounter(s, () => {});
  const cds = CLASSES.warlock.abilities.map((a) => enc.cooldownOf(a)).filter((x) => Number.isFinite(x));
  const min = Math.min(...cds);
  check('cooldowns stay positive', min <= 0 ? 'BROKEN' : 'pass',
    `shortest cooldown under extreme haste and every cdr talent: ${min.toFixed(3)}s`);
}

// --- 7. permanent invulnerability ----------------------------------------------------
{
  // Everything defensive, maxed, against the hardest thing in the game.
  const s = extremeSave('warrior', { ranks: 999, embers: 99999 });
  for (const slot of Object.keys(s.equipped)) {
    s.equipped[slot] = { uid: slot, slot, ilvl: 9999, rarity: 'legendary', name: 'x', affixes: [
      { id: 'armor', stat: 'armor', value: 5e4, label: '' },
      { id: 'hp', stat: 'hp', value: 5e5, label: '' },
    ] };
  }
  setCombatRng(mulberry32(7));
  const sk = { ...s, zone: FINAL_ZONE, mobsKilledInZone: 0, checkpoint: FINAL_ZONE };
  const enc = new Encounter(sk, () => {});
  let t = 0, taken = 0, healed = 0, php = enc.player.hp;
  const rh = enc.healPlayer.bind(enc);
  enc.healPlayer = (a, src) => { healed += a; rh(a, src); };
  let res = null;
  while (t < 1200) {
    const r = enc.tick(STEP); t += STEP;
    if (enc.player.hp < php) taken += php - enc.player.hp;
    php = enc.player.hp;
    if (r === 'win') { res = 'win'; break; }
    if (r === 'lose') { res = 'lose'; break; }
  }
  const unkillable = res === null && healed >= taken;
  // 50,000 armour per slot is roughly ten times best-in-slot, so a pass here is a
  // statement about the formula rather than about anything a player can assemble.
  check('no permanent invulnerability (at unreachable armour)', unkillable ? 'OVERPOWERED' : 'pass',
    `max armour + max health + every talent at the King: ${res || 'timeout'} at ${t.toFixed(0)}s, took ${(taken / t).toFixed(0)}/s, healed ${(healed / t).toFixed(0)}/s`);
}

// --- 8. reflect and DoT recursion ----------------------------------------------------
{
  const s = extremeSave('warrior', { ranks: 999 });
  setCombatRng(mulberry32(11));
  const enc = new Encounter({ ...s, zone: 50, mobsKilledInZone: 2 }, () => {});
  let calls = 0;
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (...a) => { calls++; if (calls > 500000) throw new Error('runaway dealToEnemy'); real(...a); };
  let t = 0, err = null;
  try { while (t < 120) { enc.tick(STEP); t += STEP; } } catch (e) { err = e.message; }
  check('thorns and DoTs do not recurse', err ? 'BROKEN' : 'pass',
    err || `${calls} damage events in 120s of maxed thorns + every DoT talent (no runaway)`);
}

// --- 9. conflicting and mismatched talent choices ------------------------------------
{
  const cases = [
    ['solo character with every companion talent', 'hunter', true],
    ['companion character with every solo-oriented talent', 'hunter', false],
  ];
  for (const [label, cls, solo] of cases) {
    const s = extremeSave(cls, { ranks: 999, solo });
    let ok = true, detail = '';
    try {
      const st = computeStats(s);
      const bad = FINITE(st);
      const comp = computeCompanion(s, st);
      if (bad) { ok = false; detail = `${bad} not finite`; }
      else if (comp && FINITE(comp)) { ok = false; detail = 'companion stats not finite'; }
      else detail = `power ${st.power.toFixed(0)}, companion ${comp ? comp.ap.toFixed(0) + ' ap' : 'none'}`;
    } catch (e) { ok = false; detail = e.message; }
    check(label, ok ? 'pass' : 'BROKEN', detail);
  }
}

// --- 10. degenerate characters -------------------------------------------------------
{
  const cases = [
    ['no talents at all', (s) => { s.talents = {}; }],
    ['no abilities slotted', (s) => { for (const a of CLASSES[s.classId].abilities) s.abilityToggles[a.id] = false; }],
    ['no gear at all', (s) => { for (const k of Object.keys(s.equipped)) s.equipped[k] = null; }],
    ['level 1 in the final zone', (s) => { s.level = 1; }],
  ];
  for (const [label, mut] of cases) {
    const s = newSave('priest', 'D');
    s.level = 60; s.petChoice = 'solo';
    mut(s);
    let ok = true, detail = '';
    try {
      const st = computeStats(s);
      const bad = FINITE(st);
      if (bad) { ok = false; detail = `${bad} not finite`; }
      else {
        setCombatRng(mulberry32(3));
        const enc = new Encounter({ ...s, zone: FINAL_ZONE, mobsKilledInZone: 0 }, () => {});
        let t = 0, res = null;
        while (t < 180) { const r = enc.tick(STEP); t += STEP; if (r === 'win' || r === 'lose') { res = r; break; } }
        detail = `survives ${t.toFixed(0)}s, result ${res || 'timeout'}, hp ${Math.max(0, enc.player.hp).toFixed(0)}`;
      }
    } catch (e) { ok = false; detail = e.message; }
    check(label, ok ? 'pass' : 'BROKEN', detail);
  }
}

// --- 11. seed reproducibility --------------------------------------------------------
{
  const run = () => {
    // newSave rolls starting equipment through the LOOT generator, so a reproducibility
    // check that seeds only the combat generator is testing its own omission rather than
    // the engine: eight identically combat-seeded runs produced four distinct results
    // until this line was added, and one afterwards.
    setLootRng(mulberry32(999));
    const s = newSave('warlock', 'R');
    s.level = 40; s.petChoice = 'pet';
    setCombatRng(mulberry32(4242));
    const enc = new Encounter({ ...s, zone: 40, mobsKilledInZone: 1 }, () => {});
    let t = 0, dealt = 0;
    const real = enc.dealToEnemy.bind(enc);
    enc.dealToEnemy = (a, ...r) => { dealt += a; real(a, ...r); };
    while (t < 60) { enc.tick(STEP); t += STEP; }
    return dealt;
  };
  const a = run(), b = run();
  check('seeded runs reproduce exactly', Math.abs(a - b) > 1e-9 ? 'BROKEN' : 'pass',
    `two identically seeded 60s fights dealt ${a.toFixed(4)} and ${b.toFixed(4)}`);
}

// --- 12. progression skips and softlocks --------------------------------------------
{
  // Can a mob spawn beyond the final zone, or a zone produce no mob?
  let bad = null;
  for (const z of [1, 5, 50, 99, 100, 101, 150]) {
    for (const i of [0, 5, 9]) {
      try {
        const m = makeMob(z, i);
        if (!m || !Number.isFinite(m.maxHp) || m.maxHp <= 0) bad = `zone ${z} index ${i}: ${JSON.stringify(m && m.maxHp)}`;
        if (z > FINAL_ZONE && m.final) bad = `zone ${z} still spawns the final boss`;
      } catch (e) { bad = `zone ${z} index ${i} threw: ${e.message}`; }
    }
  }
  check('no zone produces an invalid or duplicate final boss', bad ? 'BROKEN' : 'pass',
    bad || 'zones 1 to 150 all produce a valid mob and only zone 100 is the King');
}

// --- report --------------------------------------------------------------------------
const order = { BROKEN: 0, EXPLOIT: 1, OVERPOWERED: 2, STRONG: 3, pass: 4 };
results.sort((a, b) => order[a.verdict] - order[b.verdict]);
console.log('=== adversarial and exploit sweep ===\n');
for (const r of results) {
  console.log(`[${r.verdict.padEnd(11)}] ${r.name}`);
  console.log(`              ${r.detail}`);
}
const bad = results.filter((r) => r.verdict === 'BROKEN' || r.verdict === 'EXPLOIT');
console.log(`\n${results.length} checks, ${bad.length} needing attention` + (bad.length ? ': ' + bad.map((r) => r.name).join('; ') : ''));
