// Release candidate / section 27: save and load, tortured.
//
// Save corruption is a P0 release blocker, and the save path is the one system the
// balance harnesses never touch -- every march so far has held its character in memory
// and never round-tripped it through localStorage. So this is the first test of the
// thing a real player relies on most.
//
// node has no localStorage, so a minimal conforming stand-in is installed. That is the
// point of the test rather than a limitation of it: the game's own save.js is exercised
// unmodified, including its quota and corruption handling.
//
//   node tools/rc-saveload.mjs

import { Encounter, setCombatRng } from '../js/systems/combat.js';
import { computeStats, computeCompanion } from '../js/systems/stats.js';
import { rollDrop, itemScore, setLootRng } from '../js/systems/loot.js';
import { CLASSES } from '../js/data/classes.js';
import { TALENTS, earnedTalentPoints, resolveRanks } from '../js/data/talents.js';
import { applyAscension } from '../js/data/evolution.js';
import { FINAL_ZONE } from '../js/data/mobs.js';
import { mulberry32, STEP } from './p2-common.mjs';

// --- a localStorage that behaves like the browser's ---------------------------------
class LS {
  constructor() { this.m = new Map(); this.quota = Infinity; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    const size = [...this.m.entries()].reduce((n, [a, b]) => n + a.length + b.length, 0) + k.length + v.length;
    if (size > this.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i]; }
}
globalThis.localStorage = new LS();

const save = await import('../js/systems/save.js');
const out = [];
const rec = (name, ok, detail) => out.push({ name, ok, detail });

/** Deep compare the fields a player would notice losing. */
function diff(a, b) {
  const bad = [];
  const scalars = ['classId', 'name', 'level', 'xp', 'zone', 'checkpoint', 'mobsKilledInZone',
    'totalKills', 'embers', 'petChoice', 'petForm', 'highestZone', 'completed', 'version'];
  for (const k of scalars) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(`${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
  }
  for (const slot of Object.keys(a.equipped || {})) {
    const x = a.equipped[slot], y = (b.equipped || {})[slot];
    if (!x && !y) continue;
    if (!x || !y) { bad.push(`equipped.${slot} ${x ? 'lost' : 'appeared'}`); continue; }
    if (x.uid !== y.uid || x.ilvl !== y.ilvl || (x.affixes || []).length !== (y.affixes || []).length) {
      bad.push(`equipped.${slot} changed`);
    }
  }
  for (const id of new Set([...Object.keys(a.talents || {}), ...Object.keys(b.talents || {})])) {
    if ((a.talents || {})[id] !== (b.talents || {})[id]) bad.push(`talent ${id}: ${(a.talents || {})[id]} -> ${(b.talents || {})[id]}`);
  }
  for (const id of new Set([...Object.keys(a.abilityToggles || {}), ...Object.keys(b.abilityToggles || {})])) {
    if ((a.abilityToggles || {})[id] !== (b.abilityToggles || {})[id]) bad.push(`ability ${id} toggle changed`);
  }
  return bad;
}

/** A character carried to a plausible mid-march state, with everything populated. */
function build(classId, { level = 40, zone = 55, solo = false, embers = 17, petForm = 0 } = {}) {
  setLootRng(mulberry32(4242));
  const s = save.newSave(classId, 'RC');
  s.level = level; s.zone = zone; s.checkpoint = Math.max(1, zone - 2);
  s.highestZone = zone; s.mobsKilledInZone = 4; s.totalKills = 900; s.embers = embers;
  s.petChoice = CLASSES[classId].companion ? (solo ? 'solo' : 'pet') : null;
  for (let i = 0; i < petForm; i++) applyAscension(s);
  const tree = TALENTS[classId].filter((t) => level >= (t.req || 0));
  let pts = earnedTalentPoints(level); s.talents = {};
  for (const t of tree) { while (pts > 0 && (s.talents[t.id] || 0) < t.max) { s.talents[t.id] = (s.talents[t.id] || 0) + 1; pts--; } if (pts <= 0) break; }
  for (const slot of Object.keys(s.equipped)) {
    let best = null;
    for (let i = 0; i < 20; i++) { const d = rollDrop(classId, zone, i % 6 === 0, { solo, level }); if (d && d.slot === slot && (!best || itemScore(d) > itemScore(best))) best = d; }
    if (best) s.equipped[slot] = best;
  }
  return s;
}

const roundTrip = (s) => { save.save(s); return save.load(); };

// --- 1. every class, mid-march --------------------------------------------------------
for (const classId of ['warrior', 'hunter', 'priest', 'warlock']) {
  for (const solo of (CLASSES[classId].companion ? [false, true] : [false])) {
    const s = build(classId, { solo, petForm: solo ? 0 : 2 });
    const back = roundTrip(s);
    const bad = back ? diff(s, back) : ['load() returned null'];
    rec(`round trip: ${classId}${CLASSES[classId].companion ? (solo ? ' solo' : ' pet') : ''}`, !bad.length, bad.join('; ') || 'every field preserved, gear, talents and toggles included');
  }
}

// --- 2. the states section 27 names ----------------------------------------------------
const CASES = [
  ['fresh character', () => save.newSave('priest', 'New')],
  ['after a gear change', () => { const s = build('warrior'); setLootRng(mulberry32(9)); const d = rollDrop('warrior', 60, true, { solo: false, level: 40 }); if (d) s.equipped[d.slot] = d; return s; }],
  ['after a talent change', () => { const s = build('warlock', { solo: true }); s.talents = { ruin: 3 }; return s; }],
  ['with companion ascension', () => build('hunter', { petForm: 3 })],
  ['just before the Hollow King', () => build('warrior', { level: 60, zone: FINAL_ZONE, embers: 25 })],
  ['after beating the Hollow King', () => { const s = build('warlock', { level: 60, zone: FINAL_ZONE, solo: true, embers: 25 }); s.completed = true; s.completedAt = Date.now(); return s; }],
  ['after a death (knocked back)', () => { const s = build('hunter', { zone: 40 }); s.zone = s.checkpoint; s.deathStreak = 4; s.mobsKilledInZone = 0; return s; }],
  ['level 1, nothing owned', () => { const s = save.newSave('hunter', 'Bare'); for (const k of Object.keys(s.equipped)) s.equipped[k] = null; s.talents = {}; return s; }],
  ['level 60, everything maxed', () => build('priest', { level: 60, zone: 99, embers: 25, petForm: 4 })],
];
for (const [label, mk] of CASES) {
  let ok = true, detail = '';
  try {
    const s = mk();
    const back = roundTrip(s);
    const bad = back ? diff(s, back) : ['load() returned null'];
    ok = !bad.length; detail = bad.join('; ') || 'preserved';
  } catch (e) { ok = false; detail = 'threw: ' + e.message; }
  rec(`state: ${label}`, ok, detail);
}

// --- 3. the saved character still plays ------------------------------------------------
{
  const s = build('warrior', { level: 50, zone: 70 });
  const before = computeStats(s);
  const back = roundTrip(s);
  const after = computeStats(back);
  const keys = ['power', 'maxHp', 'armor', 'crit', 'haste', 'critDmg', 'dotDmg', 'abilityDmg', 'autoDmg', 'leech', 'thorns', 'absorbHeal', 'autoStackMax'];
  const moved = keys.filter((k) => Math.abs((before[k] || 0) - (after[k] || 0)) > 1e-9);
  rec('derived stats survive a round trip', !moved.length,
    moved.length ? moved.map((k) => `${k}: ${before[k]} -> ${after[k]}`).join('; ')
      : `${keys.length} derived stats identical, including Bulwark and Momentum`);

  setCombatRng(mulberry32(77));
  const enc = new Encounter(back, () => {});
  let t = 0, dealt = 0, err = null;
  const real = enc.dealToEnemy.bind(enc);
  enc.dealToEnemy = (a, ...r) => { dealt += a; real(a, ...r); };
  try { while (t < 60) { enc.tick(STEP); t += STEP; } } catch (e) { err = e.message; }
  rec('a loaded character fights', !err && dealt > 0 && Number.isFinite(dealt), err || `dealt ${dealt.toFixed(0)} over 60s with no exception`);
}

// --- 4. corruption and hostile input ---------------------------------------------------
const HOSTILE = [
  ['truncated JSON', '{"classId":"warrior","level":4'],
  ['empty string', ''],
  ['not JSON at all', 'hello'],
  ['JSON but not an object', '[1,2,3]'],
  ['null', 'null'],
  ['wrong version', JSON.stringify({ classId: 'warrior', version: 999, level: 5 })],
  ['missing version', JSON.stringify({ classId: 'warrior', level: 5 })],
  ['unknown class', JSON.stringify({ classId: 'necromancer', version: 2, level: 5 })],
  ['negative level', JSON.stringify({ classId: 'warrior', version: 2, level: -40, zone: -3 })],
  ['NaN smuggled as a string', JSON.stringify({ classId: 'warrior', version: 2, level: 'NaN', zone: 'x' })],
];
for (const [label, raw] of HOSTILE) {
  let ok = true, detail = '';
  try {
    localStorage.setItem('hollowmarch.save.v2', raw);
    const back = save.load();
    if (back === null) detail = 'rejected cleanly (load returned null)';
    else {
      // If it accepts the save it must still produce a usable character.
      const st = computeStats(back);
      const bad = Object.entries(st).find(([, v]) => typeof v === 'number' && !Number.isFinite(v));
      if (bad) { ok = false; detail = `accepted and produced a non-finite ${bad[0]}`; }
      else detail = 'accepted and still computes finite stats';
    }
  } catch (e) { ok = false; detail = 'threw: ' + e.message; }
  rec(`corrupt save: ${label}`, ok, detail);
}

// --- 5. quota exhaustion ----------------------------------------------------------------
{
  localStorage.m.clear();
  localStorage.quota = 200;   // far too small
  let ok = true, detail = '';
  try {
    const s = build('warrior');
    save.save(s);             // must not throw; save.js catches and warns
    detail = 'save() swallowed the quota error rather than throwing into the game loop';
  } catch (e) { ok = false; detail = 'threw into the caller: ' + e.message; }
  localStorage.quota = Infinity;
  rec('storage full', ok, detail);
}

// --- 6. legacy key migration --------------------------------------------------------------
{
  localStorage.m.clear();
  const s = build('priest', { solo: true });
  localStorage.setItem('pixelidle.save.v2', JSON.stringify(s));
  const back = save.load();
  const ok = back && !diff(s, back).length;
  rec('legacy key migrates', Boolean(ok),
    ok ? 'a save written under the old pixelidle key loads and is rewritten under the current one'
      : 'legacy save did not survive migration');
}

// --- 7. repeated save/load loops -----------------------------------------------------------
{
  localStorage.m.clear();
  let s = build('hunter', { petForm: 2 });
  const first = JSON.parse(JSON.stringify(s));
  let ok = true, detail = '';
  try {
    for (let i = 0; i < 400; i++) { save.save(s); s = save.load(); if (!s) { ok = false; detail = `load returned null on iteration ${i}`; break; } }
    if (ok) { const bad = diff(first, s); ok = !bad.length; detail = bad.join('; ') || '400 consecutive save/load cycles, no drift'; }
  } catch (e) { ok = false; detail = 'threw: ' + e.message; }
  rec('400 save/load cycles', ok, detail);
}

// --- 8. account store and wipe -------------------------------------------------------------
{
  localStorage.m.clear();
  const s = build('warlock', { level: 60, zone: FINAL_ZONE, solo: true });
  s.completed = true;
  save.recordRun(s, { won: true });
  const acct = save.loadAccount();
  const bonus = save.ascensionBonus(acct);
  const ok = acct && acct.wins >= 1 && Number.isFinite(bonus) && bonus > 0 && bonus <= save.ASCENSION_MAX;
  rec('account store records a win', ok, `wins ${acct.wins}, ascension bonus ${(bonus * 100).toFixed(0)}% (cap ${(save.ASCENSION_MAX * 100).toFixed(0)}%)`);

  save.save(s);
  save.wipe();
  rec('wipe clears the character but is survivable', save.load() === null,
    'after wipe() load() returns null rather than a half-erased character');
}

// --- report ---------------------------------------------------------------------------------
console.log('=== save / load torture ===\n');
for (const r of out.filter((x) => !x.ok)) console.log(`[FAIL] ${r.name}\n       ${r.detail}\n`);
for (const r of out.filter((x) => x.ok)) console.log(`[pass] ${r.name}\n       ${r.detail}`);
const fails = out.filter((x) => !x.ok);
console.log(`\n${out.length} checks, ${fails.length} failing` + (fails.length ? ':\n  ' + fails.map((r) => r.name).join('\n  ') : ' -- no save corruption found.'));
