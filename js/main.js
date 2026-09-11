// Bootstrap + game loop + UI wiring.

import { CLASSES, CLASS_LIST, MAX_ACTIVE_ABILITIES } from './data/classes.js';
import { xpToNext, MOBS_PER_ZONE, isBossZone, FINAL_ZONE, isFinalZone, MAX_LEVEL, atMaxLevel, STALL_DEATHS, STALL_DROP, MAX_LIVES } from './data/mobs.js';
import { SLOTS, AFFIXES, affixTip, scaledAffixes, enchantCost, ENCHANT_STEP, ENCHANT_MAX, repairCost, WEAR_MAX, WEAR_STEP } from './data/affixes.js';
import { TALENTS, TALENT_UNLOCK_LEVEL, DEEP_TALENT_LEVEL, respecCost, isPetTalent, earnedTalentPoints, spentTalentPoints, trinketRanksFor } from './data/talents.js';
import { computeStats, estimateDps, emberBonus, emberStep, isSolo, ratingToPct, pctToRating, CRIT_CAP, HASTE_CAP } from './systems/stats.js';
import {
  rollAscension, applyAscension, currentForm, nextForm, formsFor, bossChance,
} from './data/evolution.js';
import { Encounter, estimateSurvival } from './systems/combat.js';
import { rollDrop, itemScore } from './systems/loot.js';
import { Meter } from './systems/meter.js';
import { newSave, save as persist, load, wipe } from './systems/save.js';
import { Renderer, abilityColor, damageColor } from './ui/render.js';

const $ = (id) => document.getElementById(id);

const game = {
  save: null,
  enc: null,
  renderer: null,
  meter: new Meter(),
  paused: false,      // player pressed Pause
  awayPaused: false,  // tab is hidden; nothing progresses while you are away
  speed: 1,
  lastFrame: 0,
  lastLogic: 0,
  logicTimer: null,
  respawnIn: 0,      // seconds left face-down after a defeat
  running: false,    // a game is in progress; false while sitting on the menu
  saveTimer: 0,
  meterTimer: 0,
  emberTimer: 25,
};

// ---------------------------------------------------------------- class select
let pickedClass = null;

function buildClassSelect() {
  const grid = $('classGrid');
  grid.innerHTML = '';
  for (const c of CLASS_LIST) {
    const el = document.createElement('button');
    el.className = 'class-card';
    el.dataset.id = c.id;
    const kit = c.abilities.map((a) => `<b>${a.name}</b> <span>(Lv ${a.unlock})</span>`).join(' · ');
    el.innerHTML = `
      <h3><span class="swatch" style="background:${c.color}"></span>${c.name}</h3>
      <p>${c.blurb}</p>
      <div class="kit">${c.companion ? `Companion: <b>${c.companion.name}</b><br>` : ''}${kit}</div>`;
    el.addEventListener('click', () => {
      pickedClass = c.id;
      [...grid.children].forEach((n) => n.classList.toggle('sel', n.dataset.id === c.id));
      $('startBtn').disabled = false;
    });
    grid.appendChild(el);
  }
}

$('startBtn').addEventListener('click', () => {
  if (!pickedClass) return;
  const name = $('charName').value.trim() || CLASSES[pickedClass].name;
  game.save = newSave(pickedClass, name);
  persist(game.save);
  startGame();
});


// ---------------------------------------------------------------- native shell
/**
 * Capacitor housekeeping, done defensively.
 *
 * The game is plain ES modules served straight from disk -- there is no bundler and no
 * node_modules at runtime -- so the Capacitor plugins cannot be imported. They are read
 * off the global the native shell injects instead, which means this file behaves
 * identically in a desktop browser, where that global simply is not there.
 */
function initNativeShell() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  document.documentElement.classList.add("native");

  // The splash is held until the first frame is actually up (launchAutoHide is false in
  // capacitor.config.json), so players never see a blank webview while modules load.
  cap.Plugins?.SplashScreen?.hide?.({ fadeOutDuration: 200 });
  cap.Plugins?.StatusBar?.setStyle?.({ style: "DARK" });
}

// A double-tap anywhere in a webview zooms by default, which in a game reads as the
// screen breaking. Touch-action alone does not cover it on older iOS.
let lastTouchEnd = 0;
document.addEventListener('touchend', (ev) => {
  const now = Date.now();
  if (now - lastTouchEnd < 320) ev.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// Pinch-zoom, likewise.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (ev) => ev.preventDefault());
}
// ---------------------------------------------------------------- boot
function boot() {
  buildClassSelect();
  showMenu();
  // After the menu is painted, not before: the splash is the loading screen.
  requestAnimationFrame(() => requestAnimationFrame(initNativeShell));
}

/** Swap which full-screen view is up. Only ever one. */
function showScreen(id) {
  for (const s of ['screen-menu', 'screen-create', 'screen-game']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}

/**
 * The menu is the entry point, not a thing you reach by deleting your character.
 * Resuming used to be automatic on load, which meant the only route to a new character
 * was to destroy the old one first.
 */
function showMenu() {
  game.running = false;
  clearInterval(game.logicTimer);
  game.logicTimer = null;
  showScreen('screen-menu');

  const existing = load();
  const has = !!existing;
  $('menuContinue').classList.toggle('hidden', !has);
  $('menuWipe').classList.toggle('hidden', !has);
  $('saveCard').classList.toggle('hidden', !has);
  if (!has) return;

  const cls = CLASSES[existing.classId];
  const forms = formsFor(existing);
  const form = currentForm(existing);
  $('saveCard').innerHTML = `
    <div class="scname">${existing.name} the ${cls.name}</div>
    <div class="scrow">
      <span>Level <b>${existing.level}</b></span>
      <span>Zone <b>${existing.zone}</b></span>
      <span>Checkpoint <b>${existing.checkpoint}</b></span>
      <span><b>${existing.gold}</b> gold</span>
    </div>
    <div class="scrow">
      <span>${existing.totalKills} kills</span>
      ${forms.length && form ? `<span>${form.name}${(existing.petForm || 0) > 0 ? ` (form ${existing.petForm + 1}/${forms.length})` : ''}</span>` : ''}
      ${existing.petChoice === 'solo' ? '<span>going alone</span>' : ''}
    </div>`;
}

/** Save and step out of the fight. Nothing is lost; the character is on disk. */
function leaveGame() {
  if (game.save) persist(game.save);
  game.running = false;
  clearInterval(game.logicTimer);
  game.logicTimer = null;
  game.save = null;
  game.enc = null;
  showMenu();
}

function startGame() {
  showScreen('screen-game');
  game.running = true;
  // The meter is a session-scoped object; a new character must not inherit the
  // previous one's damage breakdown.
  game.meter.reset();
  game.renderer = new Renderer($('game'));
  game.renderer.resize();
  rebuildEncounter();
  renderAll();
  game.lastFrame = performance.now();
  game.lastLogic = performance.now();
  clearInterval(game.logicTimer);
  game.logicTimer = setInterval(step, LOGIC_STEP_MS);
  requestAnimationFrame(frame);
}

// Bound once, not per game: re-entering from the menu used to stack another listener.
window.addEventListener('resize', () => { if (game.renderer) game.renderer.resize(); });

/**
 * Build a fresh Encounter from the current save, carrying your position in the fight.
 *
 * A new Encounter starts with empty cooldowns, and this runs on every level-up and every
 * companion ascension -- so levelling handed you a free full rotation and a burst of
 * damage. Your character changing is not a reason for every ability to come off cooldown
 * at once.
 */
function rebuildEncounter() {
  const old = game.enc;
  game.enc = new Encounter(game.save, onCombatEvent);
  if (!old) return;
  game.enc.cooldowns = old.cooldowns;
  game.enc.hookReady = old.hookReady;
  game.enc.playerSwingTimer = old.playerSwingTimer;
  game.enc.petSwingTimer = old.petSwingTimer;
  game.enc.enemySwingTimer = old.enemySwingTimer;
}

// ---------------------------------------------------------------- combat events
function log(msg, cls = '') {
  const el = $('combatLog');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  while (el.children.length > 60) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function onCombatEvent(ev) {
  const r = game.renderer;
  switch (ev.type) {
    case 'spawn':
      log(`${ev.mob.boss ? '⚔ BOSS: ' : ''}${ev.mob.name} appears.`, ev.mob.boss ? 'big' : '');
      break;

    case 'cast':
      if (r) {
        r.addCast({ ...ev, casterColor: CLASSES[game.save.classId].color });
        // Damage-over-time ticks have no swing behind them; everything else does.
        if (ev.kind !== 'dot' && ev.kind !== 'hot') r.onAttack(ev.kind === 'pet' ? 'pet' : 'player');
      }
      break;

    case 'dmg':
      if (ev.on === 'enemy') {
        game.meter.addDamage(ev.source, ev.amount, ev.crit);
        if (r) {
          r.addFloater(Math.round(ev.amount) + (ev.crit ? '!' : ''), 'enemy',
            damageColor(ev.id || ev.source, ev.crit, ev.kind),
            { crit: ev.crit, kind: ev.kind });
          r.onHit('enemy', {
            amount: ev.amount, maxHp: game.enc.enemy.maxHp, crit: ev.crit,
            school: ev.kind === 'dot' ? 'magic' : 'phys',
          });
        }
      } else if (r) {
        r.addFloater('-' + Math.round(ev.amount), ev.on, '#ff8080');
        r.onAttack('enemy');
        const unit = ev.on === 'pet' ? game.enc.companion : game.enc.player;
        r.onHit(ev.on, { amount: ev.amount, maxHp: unit ? unit.maxHp : 1 });
      }
      break;

    case 'heal':
      if (ev.amount > 0.5) {
        game.meter.addHealing(ev.source, ev.amount);
        if (r) r.addFloater('+' + Math.round(ev.amount), ev.on, '#7fe0c0');
      }
      break;

    case 'petdown':
      log(`${ev.name} falls! You're taking the hits now.`, 'bad');
      break;

    case 'petup':
      log(`${ev.name} rejoins the fight.`, 'good');
      if (r) r.addCast({ name: 'Returns', school: 'phys', kind: 'buffpet', target: 'pet' });
      break;
  }
}

// ---------------------------------------------------------------- progression
function grantXp(amount) {
  const s = game.save;
  s.xp += amount;
  let leveled = false;
  while (!atMaxLevel(s.level) && s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    leveled = true;
    // Say what the level actually gave. "You reach level 12" with no numbers behind it
    // is why levelling felt like it did nothing to your character.
    const g = CLASSES[s.classId].growth;
    const gains = [];
    if (g.hp) gains.push('+' + Math.round(g.hp) + ' Health');
    if (g.ap) gains.push('+' + g.ap.toFixed(1) + ' Attack Power');
    if (g.sp) gains.push('+' + g.sp.toFixed(1) + ' Spell Power');
    if (g.armor) gains.push('+' + g.armor.toFixed(1) + ' Armor');
    log(`You reach level ${s.level}! ${gains.join(', ')}.`, 'big');
    const unlocked = CLASSES[s.classId].abilities.find((a) => a.unlock === s.level);
    if (unlocked) log(`New ability unlocked: ${unlocked.name}.`, 'good');
    if (s.level === TALENT_UNLOCK_LEVEL) log('Talent tree unlocked — spend your points.', 'good');
    if (s.level === DEEP_TALENT_LEVEL) log('Mastery talents unlocked — specialise your abilities.', 'good');
  }
  return leveled;
}

function onKill() {
  const s = game.save;
  const mob = game.enc.enemy;

  s.totalKills++;
  s.deathStreak = 0;   // killing something proves the zone is survivable again
  s.gold += mob.gold;
  // Break the corpse apart before the next spawn replaces it.
  if (game.renderer) game.renderer.onDeath('enemy', { name: mob.name, color: mob.color, boss: mob.boss });
  log(`${mob.name} dies. +${mob.xp} xp, +${mob.gold} gold.`, 'good');
  const leveled = grantXp(mob.xp);

  const drop = rollDrop(s.classId, s.zone, mob.boss, { killIndex: s.totalKills, solo: isSolo(s) });
  if (drop) {
    s.inventory.push(drop);
    log(`Loot: ${drop.name} (${drop.rarity}, ilvl ${drop.ilvl})`, 'big');
    showLootToast(drop);
  }

  // The one reward only a pet build can receive. Rolled before the zone advances, so
  // the gate is measured against the zone you actually fought in.
  const ascended = rollAscension(s, mob.boss);
  if (ascended) {
    const wasNamed = game.enc.companion ? game.enc.companion.name : 'Your companion';
    applyAscension(s);
    log(`${wasNamed} ASCENDS — it is a ${ascended.name} now.`, 'big');
    if (ascended.flavor) log(ascended.flavor, 'good');
    showAscendToast(ascended, wasNamed);
    if (game.renderer) game.renderer.celebrate('pet', ascended.color);
  }

  // The end of the march.
  if (mob.final) {
    s.completed = true;
    s.completedAt = s.completedAt || Date.now();
    log('The Hollow King falls.', 'big');
    log(`Zone ${FINAL_ZONE} is the end of the road. You can keep going, but nothing is waiting.`, 'good');
    showVictory();
  }

  if (mob.boss) {
    s.zone++;
    s.mobsKilledInZone = 0;
    s.checkpoint = s.zone; // the only thing that moves a checkpoint
    log(`Boss down! Checkpoint set at Zone ${s.checkpoint}.`, 'big');
    if ((s.lives || 0) < MAX_LIVES) {
      s.lives = (s.lives || 0) + 1;
      log(`You get your breath back. ${s.lives} of ${MAX_LIVES} lives.`, 'good');
    }
  } else {
    s.mobsKilledInZone++;
    if (s.mobsKilledInZone >= MOBS_PER_ZONE) {
      s.mobsKilledInZone = 0;
      s.zone++;
      log(`Zone cleared. Advancing to Zone ${s.zone}.`, 'big');
    }
  }
  s.highestZone = Math.max(s.highestZone, s.zone);

  game.enc.reset();
  // A new form has to be rebuilt, not healed: its whole stat block changed.
  if (leveled || ascended) rebuildEncounter(); else game.enc.spawn();
  persist(s);
  renderAll();
  if (needsPetChoice(s)) offerPetChoice();
  else maybeEncounter(mob.boss);
}

function onWipe() {
  const s = game.save;
  const lost = s.zone - s.checkpoint;
  log(`You are defeated in Zone ${s.zone}.`, 'bad');
  log(
    lost > 0
      ? `Sent back to Zone ${s.checkpoint} — ${lost} zone${lost === 1 ? '' : 's'} of progress lost.`
      : `Sent back to Zone ${s.checkpoint}.`,
    'bad'
  );
  // Every equipped piece takes a point of wear. Repairs cost gold, so dying drains
  // the economy that buys upgrades instead of deleting progress you already made.
  let worn = 0;
  for (const slot of SLOTS) {
    const it = s.equipped[slot.id];
    if (!it || (it.wear || 0) >= WEAR_MAX) continue;
    it.wear = (it.wear || 0) + 1;
    worn++;
  }
  if (worn > 0) log(`Your gear is battered — ${worn} piece${worn === 1 ? '' : 's'} damaged.`, 'bad');

  // Dying without killing anything in between means the zone is beyond you, not that
  // you were unlucky. After a few of those the checkpoint stops being a floor and you
  // fall back toward something farmable -- otherwise a run can lock up permanently.
  s.deathStreak = (s.deathStreak || 0) + 1;
  s.lives = Math.max(0, (s.lives ?? MAX_LIVES) - 1);
  if (s.lives <= 0) return runOver();
  log(`${s.lives} ${s.lives === 1 ? 'life' : 'lives'} left.`, s.lives <= 2 ? 'bad' : '');
  s.zone = s.checkpoint;
  if (s.deathStreak > STALL_DEATHS) {
    const drop = (s.deathStreak - STALL_DEATHS) * STALL_DROP;
    const fellTo = Math.max(1, s.checkpoint - drop);
    if (fellTo < s.zone) {
      s.zone = fellTo;
      log(`You fall back to Zone ${s.zone} — this stretch is beyond you for now.`, 'bad');
    }
  }
  s.mobsKilledInZone = 0;

  // A beat before you are back on your feet. Dying used to be a single log line and an
  // instantly respawned mob, which read as a hiccup rather than a setback.
  game.respawnIn = RESPAWN_SECONDS;
  persist(s);
  renderAll();
}

/**
 * Out of lives. The character is finished -- not sent back, not penalised: gone. This is
 * the only thing in the game that deletes progress, which is what makes the other four
 * deaths mean something.
 */
function runOver() {
  const s = game.save;
  log('You have no lives left. This is where the march ends.', 'big');
  game.running = false;
  clearInterval(game.logicTimer);
  game.logicTimer = null;
  game.respawnIn = 0;

  $('deadBody').innerHTML =
    `<b>${s.name} the ${CLASSES[s.classId].name}</b> fell in Zone ${s.zone} at level ${s.level},
     after ${s.totalKills} kills${s.checkpoint > 1 ? ` and ${s.checkpoint - 1} zones banked` : ''}.
     ${s.completed ? 'The Hollow King was already down — the march was finished.' : ''}`;
  $('deadModal').classList.remove('hidden');

  // Drop the character FIRST, so nothing can persist it back over the wipe.
  game.save = null;
  game.enc = null;
  wipe();
}

/** Seconds face-down after a defeat before the march resumes. */
const RESPAWN_SECONDS = 3;

function tickRespawn(dt) {
  game.respawnIn -= dt;
  const el = $('respawn');
  if (game.respawnIn > 0) {
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = '<div class="rsp"><b>You have fallen</b><span>Back on your feet in ' +
        Math.ceil(game.respawnIn) + '...</span></div>';
    }
    return;
  }
  if (el) el.classList.add('hidden');
  game.respawnIn = 0;
  game.enc.revive();
  game.enc.spawn();
  renderAll();
}

// ---------------------------------------------------------------- loop
// Simulation runs on a fixed-step timer, NOT on animation frames: a browser that
// withholds frames (background tab, offscreen pane, low-power mode) must not be
// able to stall combat. Animation frames only draw.
const LOGIC_STEP_MS = 50;

function step() {
  const now = performance.now();
  const raw = Math.min(0.5, (now - game.lastLogic) / 1000);
  game.lastLogic = now;
  if (game.paused || game.awayPaused) return;

  const dt = raw * game.speed;
  // Nothing advances while you are down.
  if (game.respawnIn > 0) { tickRespawn(dt); return; }
  game.meter.tick(dt);
  const result = game.enc.tick(dt);
  if (result === 'win') onKill();
  else if (result === 'lose') onWipe();

  game.emberTimer -= dt;
  if (game.emberTimer <= 0) { spawnEmber(); scheduleEmber(); }

  game.saveTimer += dt;
  if (game.saveTimer > 10) { game.saveTimer = 0; persist(game.save); }

  // The meter is live data; refresh it on a slow cadence rather than every frame.
  game.meterTimer += dt;
  if (game.meterTimer > 0.5) {
    game.meterTimer = 0;
    renderMeterBar();
  }
}

function frame(now) {
  const raw = Math.min(0.1, (now - game.lastFrame) / 1000);
  game.lastFrame = now;
  // Deleting a character tears down the save mid-flight; one throw here would kill the
  // render loop for the rest of the page's life, so skip the frame instead.
  if (game.save && game.enc && game.renderer) {
    game.renderer.draw(game.enc, game.save, raw);
    updateBars();
  }
  if (game.running) requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- HUD
function setBar(fillEl, textEl, cur, max, label) {
  fillEl.style.width = (Math.max(0, Math.min(1, cur / max)) * 100).toFixed(1) + '%';
  if (textEl) textEl.textContent = label ?? `${Math.max(0, Math.round(cur))} / ${Math.round(max)}`;
}

function renderAuras(el, list, stunned) {
  const chips = list.map((a) => `<span class="aura">${a.name}${a.stacks > 1 ? ` ${a.stacks}` : ''}</span>`);
  if (stunned) chips.unshift('<span class="aura stun">stunned</span>');
  el.innerHTML = chips.join('');
}

function updateBars() {
  const s = game.save, e = game.enc;
  if (atMaxLevel(s.level)) {
    // At the cap the bar stops being a progress bar; say so rather than showing a
    // number that will never move.
    setBar($('xpFill'), $('xpText'), 1, 1, `level ${MAX_LEVEL} — gear and embers from here`);
  } else {
    setBar($('xpFill'), $('xpText'), s.xp, xpToNext(s.level), `${Math.floor(s.xp)} / ${xpToNext(s.level)} xp`);
  }
  $('goldText').textContent = Math.floor(s.gold);
  $('charLevel').textContent = s.level;

  setBar($('pHp'), $('pHpText'), e.player.hp, e.player.maxHp);
  if (e.companion) {
    $('petUnit').classList.remove('hidden');
    $('cName').textContent = e.companion.name;
    setBar($('cHp'), $('cHpText'), e.companion.hp, e.companion.maxHp);
  } else {
    $('petUnit').classList.add('hidden');
  }
  const dpsEl = $('vitalDps');
  if (dpsEl) dpsEl.textContent = game.meter.liveDps.toFixed(1);

  $('eName').textContent = e.enemy.name + (e.enemy.boss ? ' (Boss)' : '');
  setBar($('eHp'), $('eHpText'), e.enemy.hp, e.enemy.maxHp);

  const auras = e.auras();
  renderAuras($('eAuras'), auras.enemy, auras.stunned);
  renderAuras($('cAuras'), auras.pet, false);
  renderAuras($('pAuras'), auras.player, false);
}

function renderAll() {
  const s = game.save;
  $('charLabel').textContent = `${s.name} the ${CLASSES[s.classId].name}`;
  const lives = s.lives ?? MAX_LIVES;
  $('lives').innerHTML =
    Array.from({ length: MAX_LIVES }, (_, i) => `<span class="pip${i < lives ? ' on' : ''}"></span>`).join('') +
    `<b class="livesnum">${lives}/${MAX_LIVES}</b>`;
  $('lives').classList.toggle('low', lives <= 2);
  // Whether a companion exists is durable state, not per-frame state. Hiding the bar
  // only inside the animation loop leaves a ghost "Wolf" bar for a petless character
  // any time the browser withholds frames.
  $('petUnit').classList.toggle('hidden', !game.enc?.companion);
  renderZoneProgress();
  renderMeterBar();
  renderAbilities();
  renderLoot();
  renderPet();
  renderEquipped();
  renderTalents();
  renderVitals();
  renderBadges();
}

/** Counts on the tab headers, so you know there is something worth looking at. */
function renderBadges() {
  const s = game.save;
  const upgrades = s.inventory.filter((it) => itemScore(it) > itemScore(s.equipped[it.slot])).length;
  const loot = $('lootBadge');
  loot.textContent = upgrades;
  loot.classList.toggle('hidden', upgrades === 0);

  const tal = $('talentBadge');
  const points = availablePoints(s);
  tal.textContent = points;
  tal.classList.toggle('hidden', points <= 0);
}

function renderZoneProgress() {
  const s = game.save;
  const boss = isBossZone(s.zone);
  $('zoneProgText').innerHTML = (boss
    ? `Zone ${s.zone} — <b>Boss fight</b>`
    : `Zone ${s.zone} — ${s.mobsKilledInZone} / ${MOBS_PER_ZONE} slain`)
    + ` <span class="cp">⚑ checkpoint Zone ${s.checkpoint}</span>`;
  const pips = $('zonePips');
  pips.innerHTML = '';
  if (boss) return;
  for (let i = 0; i < MOBS_PER_ZONE; i++) {
    const p = document.createElement('div');
    p.className = 'pip' + (i < s.mobsKilledInZone ? ' on' : '');
    pips.appendChild(p);
  }
}

// ---------------------------------------------------------------- meter
/**
 * The persistent meter strip. It is the readout the whole build is steered by, so it
 * sits under the fight rather than behind a tab — and it is the piece that has to
 * survive the move to a phone screen, which is why it is one row of bars.
 */
/**
 * The damage meter. Vertical rows rather than side-by-side columns: a column strip fits
 * more on one line but you cannot compare two bars that do not share a baseline, and the
 * names ended up truncated. Each row is coloured to match the spell you just watched
 * cross the screen, so the biggest source is identifiable without reading anything.
 */
function meterColors() {
  const s = game.save;
  const cls = CLASSES[s.classId];
  const map = new Map();
  for (const base of cls.abilities) {
    const a = resolveAbility(base);
    map.set(a.name, abilityColor(base.id, a.name, a.school));
  }
  map.set(cls.autoName, abilityColor(null, cls.autoName, cls.primary === "sp" ? "magic" : "phys"));
  const form = currentForm(s);
  if (form) map.set(form.name, form.color);
  else if (cls.companion) map.set(cls.companion.name, cls.companion.color);
  return map;
}

function renderMeterBar() {
  const el = $("meterBar");
  if (!el) return;
  const m = game.meter;
  const rows = m.breakdown().slice(0, 5);
  const heals = m.healingBreakdown().slice(0, 3);
  const colors = meterColors();
  const tint = (name) => colors.get(name) || "#8a90a0";

  const head =
    '<div class="mbhead">' +
      '<span class="mbbig">' + m.liveDps.toFixed(1) + '</span><span class="mblbl">DPS</span>' +
      '<span class="mbstat"><b>' + m.dps.toFixed(1) + '</b> overall</span>' +
      '<span class="mbstat"><b>' + Math.round(m.totalDamage).toLocaleString() + '</b> total damage</span>' +
      '<button class="mbreset" id="meterReset" title="Clear the meter and start counting again">Reset</button>' +
    '</div>';

  // Width is the share of the total, so the bar and the percentage next to it are the
  // same fact. Scaling to the top source instead made the leader a full-width bar
  // labelled 49%.
  const bar = (value, share, name, extra) =>
    '<div class="mbrow" title="' + attr(name + " — " + Math.round(value).toLocaleString() + " " + extra) + '">' +
      '<span class="mbfill" style="width:' + (share * 100).toFixed(1) + '%;background:' + tint(name) + '"></span>' +
      '<span class="mbdot" style="background:' + tint(name) + '"></span>' +
      '<span class="mbname">' + name + '</span>' +
      '<span class="mbdmg">' + Math.round(value).toLocaleString() + '</span>' +
      '<span class="mbpct">' + (share * 100).toFixed(0) + '%</span>' +
    '</div>';

  const body = rows.length === 0
    ? '<div class="mbempty">No damage yet — it starts counting on your first hit.</div>'
    : rows.map((r) => bar(
        r.damage, r.share, r.name,
        r.hits + " hits, best " + Math.round(r.best).toLocaleString() + ", " + (r.critPct * 100).toFixed(0) + "% crit"
      )).join("");

  // Healing only appears for a build that does any, so it never costs a priest-less
  // character a row of empty space.
  const healBlock = heals.length === 0 ? "" :
    '<div class="mbsub">HEALING &middot; ' + Math.round(m.totalHealing).toLocaleString() + '</div>' +
    heals.map((r) => bar(r.healing, r.share, r.name, "healed")).join("");

  el.innerHTML = head + body + healBlock;
  const reset = $("meterReset");
  if (reset) reset.addEventListener("click", () => { game.meter.reset(); renderMeterBar(); });
}


// ---------------------------------------------------------------- abilities
function renderAbilities() {
  const s = game.save;
  const el = $('sec-abilities');
  el.innerHTML = '';

  const slotted = CLASSES[s.classId].abilities.filter((a) => s.abilityToggles[a.id] !== false);
  const full = slotted.length >= MAX_ACTIVE_ABILITIES;

  const head = document.createElement('div');
  head.className = 'slotcount' + (full ? ' full' : '');
  head.textContent = `${slotted.length} / ${MAX_ACTIVE_ABILITIES} slots used`;
  el.appendChild(head);

  for (const base of CLASSES[s.classId].abilities) {
    const a = resolveAbility(base);
    const locked = s.level < a.unlock;
    const on = s.abilityToggles[a.id] !== false;
    // A full bar blocks new picks but never blocks unslotting one you already have.
    const blocked = !locked && !on && full;
    const row = document.createElement('label');
    row.className = 'ability' + (locked ? ' locked' : on ? '' : ' off');
    // Carried on the row so a tap opens the full text on a phone, where the visible
    // description is clamped to one line.
    row.title = `${petText(a.desc)}${a.cd ? ` (${a.cd}s cooldown)` : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${on ? 'checked' : ''} ${locked || blocked ? 'disabled' : ''}>
      <div>
        <div class="an">${a.name} ${locked ? `<span class="cd">— unlocks at Lv ${a.unlock}</span>`
          : blocked ? '<span class="cd">— no free slot</span>' : ''}</div>
        <div class="ad">${petText(a.desc)}</div>
        ${a.cd ? `<div class="cd">${a.cd}s cooldown</div>` : ''}
      </div>`;
    row.querySelector('input').addEventListener('change', (ev) => {
      if (ev.target.checked && full) { ev.target.checked = false; return; }
      s.abilityToggles[a.id] = ev.target.checked;
      persist(s);
      afterGearChange();
    });
    el.appendChild(row);
  }

  // One line standing in for everything not yet earned. The phone stylesheet hides the
  // locked rows this replaces; on a desktop it reads as a note of what is coming.
  const locked = CLASSES[s.classId].abilities.filter((x) => s.level < x.unlock);
  if (locked.length) {
    const more = document.createElement('div');
    more.className = 'lockedmore';
    more.textContent = `${locked.length} more unlock at level ${locked.map((a) => a.unlock).join(', ')}.`;
    el.appendChild(more);
  }

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = `Combat resolves automatically. You choose which ${MAX_ACTIVE_ABILITIES} abilities you take into it.`;
  el.appendChild(note);
}

// ---------------------------------------------------------------- gear + compare
const AFFIX_BY_STAT = Object.fromEntries(AFFIXES.map((a) => [a.stat, a]));

/** Flatten an item's affixes into a stat -> value map for diffing. */
function statMap(item) {
  const out = {};
  for (const a of scaledAffixes(item)) out[a.stat] = (out[a.stat] || 0) + a.value;
  return out;
}

function fmtStat(stat, value) {
  const def = AFFIX_BY_STAT[stat];
  return def ? def.fmt(value) : `${stat} ${value.toFixed(1)}`;
}

/** Signed, colour-coded delta rows between the equipped item and a candidate. */
/** Escape a string for use inside an HTML attribute. */
function attr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * What a trinket's talent grant actually does. A trinket names a specific talent, and
 * that talent may sit in a tree you have never opened -- so the item has to explain
 * itself where you read it.
 */
function talentTip(classId, talentId, ranks) {
  const t = (TALENTS[classId] || []).find((x) => x.id === talentId);
  if (!t) return '';
  const per = t.desc ? ' ' + t.desc : '';
  return t.name + ' (' + t.branch + ') — ' + ranks + ' free rank' + (ranks === 1 ? '' : 's') +
    ', and these can push a talent past its normal 5/5 cap.' + per;
}

/**
 * What equipping this would do to your damage, as a percentage.
 *
 * "Upgrade" used to mean "higher item score", which is a judgement about the item. This
 * is a judgement about YOUR CHARACTER: it re-derives the whole stat block with the piece
 * swapped in and asks what the build's damage does. A crit amulet reads as an upgrade
 * for a crit build and a sidegrade for one with no way to use it, which is the truth.
 */
function deltasFor(item) {
  const s = game.save;
  const beforeDps = estimateDps(s);
  const beforeEhp = estimateSurvival(s);

  const prev = s.equipped[item.slot];
  s.equipped[item.slot] = item;
  const afterDps = estimateDps(s);
  const afterEhp = estimateSurvival(s);
  s.equipped[item.slot] = prev;

  return {
    dps: beforeDps <= 0 ? (afterDps > 0 ? 1 : 0) : afterDps / beforeDps - 1,
    ehp: beforeEhp <= 0 ? (afterEhp > 0 ? 1 : 0) : afterEhp / beforeEhp - 1,
  };
}

/**
 * Both halves of what a piece of gear does to you.
 *
 * Damage alone is half an answer: a piece can be a clear damage upgrade and still get you
 * killed, and the stat that saves you is invisible if the only verdict is "+12% dps". The
 * two are shown side by side and sorting still uses damage, because that is the number
 * most decisions turn on -- but you can see the cost.
 */
function fmtPct(v) {
  const pct = (v * 100).toFixed(Math.abs(v) >= 0.1 ? 0 : 1);
  return (v > 0 ? '+' : '') + pct + '%';
}

function verdictFor(item) {
  const cur = game.save.equipped[item.slot];
  const d = deltasFor(item);
  const cls = (v) => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
  return {
    cls: cls(d.dps),
    delta: d.dps,
    text: cur ? `${fmtPct(d.dps)} dps` : 'empty slot',
    dpsText: `${fmtPct(d.dps)} dps`,
    dpsCls: cls(d.dps),
    ehpText: `${fmtPct(d.ehp)} survival`,
    ehpCls: cls(d.ehp),
  };
}

function deltaRows(equipped, candidate) {
  const rows = [];
  // Two trinkets rarely empower the same talent, so show both sides rather than a
  // single number that would imply they are interchangeable.
  if (equipped?.talentRanks && equipped.talentId !== candidate?.talentId) {
    rows.push(`<div class="delta down pts" title="${attr('Lost by unequipping. ' + talentTip(game.save.classId, equipped.talentId, equipped.talentRanks))}">−${equipped.talentRanks} ${equipped.talentName}</div>`);
  }
  if (candidate?.talentRanks) {
    const same = equipped?.talentId === candidate.talentId ? (equipped.talentRanks || 0) : 0;
    const diff = candidate.talentRanks - same;
    if (diff !== 0) rows.push(`<div class="delta ${diff > 0 ? 'up' : 'down'} pts" title="${attr(talentTip(game.save.classId, candidate.talentId, candidate.talentRanks))}">${diff > 0 ? '+' : '−'}${Math.abs(diff)} ${candidate.talentName}</div>`);
  }
  const a = statMap(equipped), b = statMap(candidate);
  const stats = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return rows.join('') + stats.map((stat) => {
    const diff = (b[stat] || 0) - (a[stat] || 0);
    if (Math.abs(diff) < 0.01) return '';
    const cls = diff > 0 ? 'up' : 'down';
    const sign = diff > 0 ? '+' : '−';
    const def = AFFIX_BY_STAT[stat];
    const shown = def && def.per < 0.01
      ? `${(Math.abs(diff) * 100).toFixed(1)}% ${def.name}`
      : `${Math.abs(diff).toFixed(0)} ${def ? def.name : stat}`;
    return `<div class="delta ${cls}" title="${attr(affixTip(stat))}">${sign}${shown}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- the pet choice
// At level 5 a companion class commits: keep the pet, or trade it for personal power.
// Going alone is a real alternative rather than a penalty, so the companion has to be
// worth choosing on its own merits -- which is why its baseline damage is modest and
// its talents scale hard.
const PET_CHOICE_LEVEL = 5;

function needsPetChoice(s) {
  return CLASSES[s.classId].companion && !s.petChoice && s.level >= PET_CHOICE_LEVEL;
}

function offerPetChoice() {
  const s = game.save;
  const cls = CLASSES[s.classId];
  const pet = cls.companion.name;
  const bonus = Math.round(cls.soloBonus * 100);

  $('choiceBody').innerHTML =
    `You've grown strong enough to fight your own way. Keep the ${pet} at your side, or
     send it away and turn everything inward.`;
  $('choiceKeep').innerHTML =
    `<b>Keep the ${pet}</b><span>Companion talents and Bond affixes stay available.
     Invest in them and it becomes your biggest damage source.</span>`;
  // Spell out the ability changes too. The flat bonuses are only half of what going
  // alone gives you; the other half is that your companion abilities become your own.
  const retargeted = cls.abilities.filter((a) => a.solo).length;
  $('choiceSolo').innerHTML =
    `<b>Go alone</b><span>+${bonus}% ${cls.primary === 'sp' ? 'Spell' : 'Attack'} Power and
     +${Math.round((cls.soloHp || 0) * 100)}% Health, permanently, and your ${retargeted} companion
     abilities are retargeted at you — ${cls.abilities.filter((a) => a.solo).map((a) => a.solo.name || a.name).join(', ')}.
     You'll be taking every hit yourself: no companion, no companion talents, no Bond affixes.</span>`;

  const decide = (choice) => {
    s.petChoice = choice;
    // Bond stops dropping for a solo build, but anything already rolled would sit there
    // as a dead stat forever. Convert it into the class's own damage stat instead.
    if (choice === 'solo') {
      const prime = cls.primary === 'sp' ? 'sp' : 'ap';
      let moved = 0;
      for (const slot of SLOTS) {
        const it = s.equipped[slot.id];
        for (const item of [it, ...s.inventory.filter((x) => x.slot === slot.id)]) {
          if (!item?.affixes) continue;
          for (const af of item.affixes) {
            if (af.id !== 'petpow') continue;
            af.id = prime;
            af.stat = prime;
            // Bond is a percentage and the primary stat is flat, so re-price it against
            // the two affixes' own per-point rates rather than copying the number.
            const from = AFFIXES.find((x) => x.id === 'petpow');
            const to = AFFIXES.find((x) => x.id === prime);
            af.value = (af.value / from.per) * to.per;
            moved++;
          }
        }
      }
      if (moved > 0) log('Bond fades from your gear, and what it held turns inward.', 'good');
    }
    log(choice === 'solo' ? `You send the ${pet} away for good.` : `The ${pet} stays at your side.`, 'big');
    $('choiceModal').classList.add('hidden');
    game.paused = game.pausedBeforeChoice;
    updatePauseUi();
    afterGearChange();
  };
  $('choiceKeep').onclick = () => decide('pet');
  $('choiceSolo').onclick = () => decide('solo');

  game.pausedBeforeChoice = game.paused;
  game.paused = true;
  updatePauseUi();
  $('choiceModal').classList.remove('hidden');
}

// ---------------------------------------------------------------- embers
// A small permanent reward for actually being at the screen. One ember is worth
// almost nothing on its own (EMBER_BONUS, 0.01% to everything); the point is that
// they only accrue while you're present, which is the same reason idle was removed.
const EMBER_MIN_GAP = 18, EMBER_MAX_GAP = 34, EMBER_LIFETIME = 9;

function scheduleEmber() {
  game.emberTimer = EMBER_MIN_GAP + Math.random() * (EMBER_MAX_GAP - EMBER_MIN_GAP);
}

function spawnEmber() {
  const box = $('embers');
  if (!box || box.children.length > 0) return; // never more than one on screen

  const el = document.createElement('button');
  el.className = 'ember';
  el.title = 'Collect ember';
  // Keep clear of the top-right toast lane and the ground line where sprites stand.
  el.style.left = (12 + Math.random() * 62) + '%';
  el.style.top = (16 + Math.random() * 46) + '%';

  let taken = false;
  el.addEventListener('click', () => {
    if (taken) return;
    taken = true;
    game.save.embers = (game.save.embers || 0) + 1;
    el.classList.add('taken');
    setTimeout(() => el.remove(), 260);
    log(`Ember collected (${game.save.embers} total).`, 'good');
    persist(game.save);
    afterGearChange();
  });

  box.appendChild(el);
  setTimeout(() => { if (!taken) el.remove(); }, EMBER_LIFETIME * 1000);
}

// ---------------------------------------------------------------- vitals strip
// One always-visible row of the numbers that matter. Equipping something changes it
// in place and flashes the difference, so you can see what a piece of gear did without
// opening anything. Build-defining stats only appear once they are non-zero, which
// keeps a fresh character's strip short and a specialised one's honest.
let prevVitals = null;

function vitalsFor(save) {
  const st = computeStats(save);
  const cls = CLASSES[save.classId];
  const lvl = save.level;

  // What the NEXT whole percent of a rating stat would cost, so the dashboard can say
  // out loud that these get more expensive the higher they already are.
  const nextPoint = (pct, rating, cap) =>
    Math.max(1, pctToRating(Math.min(cap - 0.001, pct + 0.01), lvl, cap) - Math.round(rating));

  const rows = [
    { key: 'power', label: cls.primary === 'sp' ? 'SPELL PWR' : 'ATK PWR', value: st.power, fmt: (v) => Math.round(v),
      tip: (cls.primary === 'sp' ? 'Spell Power' : 'Attack Power') +
        ' scales every ability you use and your auto-attack, and your companion inherits a share of it. It is the number every coefficient on your abilities multiplies.' },
    { key: 'hp', label: 'HEALTH', value: st.maxHp, fmt: (v) => Math.round(v),
      tip: 'Maximum health. You only recover about 10% between pulls and regenerate slowly, so a zone is an attrition run on this one bar.' },
    { key: 'armor', label: 'ARMOR', value: st.armor, fmt: (v) => Math.round(v),
      tip: 'Reduces the damage of each hit you take. It is measured against the ATTACKER, so the same armour is worth steadily less the deeper you push and has to keep climbing to hold its value.' },
    { key: 'crit', label: 'CRIT', value: st.crit, pct: true,
      tip: 'Chance for a hit to deal ' + Math.round(st.critDmg * 100) + '% damage.' +
        ' From ' + Math.round(st.critRating) + ' Crit Rating plus ' + (st.baseCrit * 100).toFixed(1) + '% base.' +
        (st.dotCrit > 0
          ? ' Your damage-over-time effects can crit at ' + Math.round(st.dotCrit * 100) + '% of this chance.'
          : ' Damage-over-time effects CANNOT crit until you take the talent for it.') +
        ' Next 1% costs about ' + nextPoint(st.crit, st.critRating, CRIT_CAP) + ' more rating — each point costs more than the last.' },
    { key: 'haste', label: 'HASTE', value: st.haste, pct: true,
      tip: 'Haste does three things: your auto-attack swings faster, EVERY ability cooldown is shortened by this much, and your damage-over-time effects tick faster (same total damage, delivered sooner).' +
        ' It does NOT speed up your companion. From ' + Math.round(st.hasteRating) + ' Haste Rating.' +
        ' Next 1% costs about ' + nextPoint(st.haste, st.hasteRating, HASTE_CAP) + ' more rating.' },
  ];
  const lives = save.lives ?? MAX_LIVES;
  rows.push({
    key: 'lives', label: 'LIVES', value: lives, fmt: (v) => `${v} / ${MAX_LIVES}`,
    tip: 'Lives remaining. Dying costs one; killing a boss gives one back, up to ' + MAX_LIVES + '. ' +
      'At zero this character is deleted — it is the only thing in the game that erases progress, ' +
      'which is what makes the deaths before it matter.',
  });

  const optional = [
    { key: 'petPow', label: 'COMPANION', value: st.petPow, pct: true, show: !!cls.companion,
      tip: 'Bonus damage your companion deals, from Bond affixes and companion talents. It multiplies the companion only — nothing here touches your own hits.' },
    { key: 'dot', label: 'DOT', value: st.dotDmg - 1, pct: true, show: true,
      tip: 'Bonus damage on every damage-over-time tick you apply, from talents. Multiplies with Spell/Attack Power rather than replacing it.' },
    { key: 'ability', label: 'ABILITY', value: st.abilityDmg - 1, pct: true, show: true,
      tip: 'Bonus damage on direct ability hits, from talents. Does not apply to damage-over-time ticks or your auto-attack.' },
  ];
  for (const o of optional) if (o.show && o.value > 0.0001) rows.push(o);
  // Embers are a permanent, always-growing bonus; show it once it exists.
  const embers = game.save.embers || 0;
  if (embers > 0) {
    const b = emberBonus(embers);
    const base = (v) => Math.round(v / (1 + b));
    rows.push({ key: 'embers', label: `EMBERS ${embers}`, value: b, pct: true, dp: 1,
      tip: 'A permanent +' + (b * 100).toFixed(1) + '% to your ' +
        (cls.primary === 'sp' ? 'Spell' : 'Attack') + ' Power, Health, Armor and companion damage' +
        ' — right now that is +' + (Math.round(st.power) - base(st.power)) + ' power, +' + (st.maxHp - base(st.maxHp)) +
        ' health and +' + (Math.round(st.armor) - base(st.armor)) + ' armor. It does NOT raise crit or haste,' +
        ' which are capped by their own curve. Diminishing: the next ember is worth about +' +
        (emberStep(embers) * 100).toFixed(2) + '%. Nothing accrues while you are away.' });
  }
  return rows;
}

/**
 * The dashboard is rebuilt only when its SHAPE changes, and otherwise updated in
 * place.
 *
 * It used to reassign innerHTML on every render, and renderAll() runs on every kill --
 * so the whole strip was torn down and recreated between one mob and the next. That is
 * what made it flicker and made stats look like they were jumping around at each
 * spawn. Your character does not change because something died in front of it, so the
 * dashboard should not either. DPS is the exception and updates on its own cadence.
 */
let vitalNodes = null;
let vitalShape = "";

function renderVitals({ flash = true } = {}) {
  const rows = vitalsFor(game.save);
  const el = $("vitals");
  const shape = rows.map((r) => r.key).join("|");

  if (shape !== vitalShape || !vitalNodes) {
    el.innerHTML = rows.map((r) =>
      `<div class="vital" data-k="${r.key}"><span class="vl">${r.label}</span><span class="vv"></span></div>`
    ).join("") +
      `<div class="vital" data-k="__dps"><span class="vl">DPS</span><span class="vv" id="vitalDps">0.0</span></div>`;
    vitalShape = shape;
    vitalNodes = new Map();
    for (const node of el.querySelectorAll(".vital")) vitalNodes.set(node.dataset.k, node);
  }

  for (const r of rows) {
    const node = vitalNodes.get(r.key);
    if (!node) continue;
    node.title = r.tip || "";
    // The label carries a live count for embers, so refresh it too.
    const labelEl = node.querySelector(".vl");
    if (labelEl.textContent !== r.label) labelEl.textContent = r.label;

    const shown = r.pct ? `${(r.value * 100).toFixed(r.dp ?? 1)}%` : r.fmt(r.value);
    const valueEl = node.querySelector(".vv");
    if (valueEl.textContent !== shown) valueEl.textContent = shown;

    const before = prevVitals?.[r.key];
    node.querySelector(".vdelta")?.remove();
    node.classList.remove("changed");
    if (flash && before !== undefined && Math.abs(r.value - before) > 1e-6) {
      const diff = r.value - before;
      const txt = r.pct ? `${(Math.abs(diff) * 100).toFixed(r.dp ?? 1)}%` : Math.round(Math.abs(diff));
      const d = document.createElement("span");
      d.className = `vdelta ${diff > 0 ? "up" : "down"}`;
      d.textContent = `${diff > 0 ? "▲" : "▼"}${txt}`;
      node.appendChild(d);
      node.classList.add("changed");
    }
  }

  const dpsNode = vitalNodes.get("__dps");
  if (dpsNode) dpsNode.title = "Your damage per second over the last 15 seconds, across everything you and your companion are doing. The full breakdown is the meter under the fight.";

  prevVitals = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  // Let the flash fade rather than sit there permanently.
  clearTimeout(renderVitals.timer);
  renderVitals.timer = setTimeout(() => {
    el.querySelectorAll(".vdelta").forEach((n) => n.remove());
    el.querySelectorAll(".changed").forEach((n) => n.classList.remove("changed"));
  }, 4000);
}
function renderEquipped() {
  const s = game.save;
  const eq = $('sec-equipped');
  eq.innerHTML = '';

  // Repairs live here rather than in the Camp: gear gets damaged from the first death,
  // long before the Camp unlocks at the zone-10 checkpoint.
  const damaged = SLOTS.map((sl) => s.equipped[sl.id]).filter((it) => it && (it.wear || 0) > 0);
  if (damaged.length) {
    const total = damaged.reduce((sum, it) => sum + repairCost(it), 0);
    const bar = document.createElement('div');
    bar.className = 'repairbar';
    bar.innerHTML = `<span>${damaged.length} damaged piece${damaged.length === 1 ? '' : 's'}</span>
      <button ${s.gold < total ? 'disabled' : ''}>Repair all — ${total}⛃</button>`;
    bar.querySelector('button').addEventListener('click', () => {
      if (s.gold < total) return;
      s.gold -= total;
      for (const it of damaged) it.wear = 0;
      log(`Repaired ${damaged.length} piece${damaged.length === 1 ? '' : 's'} for ${total} gold.`, 'good');
      afterGearChange();
    });
    eq.appendChild(bar);
  }
  for (const slot of SLOTS) {
    const it = s.equipped[slot.id];
    const row = document.createElement('div');
    row.className = 'slotrow';
    row.innerHTML = `<span class="sn">${slot.name}</span>
      <span class="iv">${it
        ? `<span style="color:${it.rarityColor}">${it.name}</span>${it.talentRanks ? ` <span class="pts">+${it.talentRanks} ${it.talentName}</span>` : ''}${it.wear ? ` <span class="worn">−${Math.round(it.wear * WEAR_STEP * 100)}% worn</span>` : ''} <span class="il">i${it.ilvl}</span>`
        : '<span class="empty">empty</span>'}</span>`;
    if (it) {
      row.style.cursor = 'pointer';
      row.title = scaledAffixes(it).map((a) => a.label).join('\n');
      row.addEventListener('click', () => {
        s.inventory.push(it);
        s.equipped[slot.id] = null;
        afterGearChange();
      });
    }
    eq.appendChild(row);
  }
}

/** Bags, each item shown side by side with whatever occupies its slot. */
function renderLoot() {
  const s = game.save;
  const bags = $('sec-loot');
  bags.innerHTML = '';
  if (s.inventory.length === 0) {
    bags.innerHTML = '<p class="note">Nothing in your bags. Gear drops as you kill; bosses always drop.</p>';
    return;
  }

  // Sorted by what each piece would do to your damage, so the best thing in the bag is
  // at the top for THIS build rather than the one with the biggest numbers on it.
  const scored = s.inventory.map((it) => ({ it, v: verdictFor(it) }));
  scored.sort((a, b) => b.v.delta - a.v.delta);
  for (const { it, v } of scored) {
    const cur = s.equipped[it.slot];
    const box = document.createElement('div');
    // Deltas only. Showing the equipped item's full stat list beside every bag item
    // doubled the reading for information already on the Character tab; what actually
    // drives the decision is the difference.
    box.className = 'compare';
    box.innerHTML = `
      <div class="cmphead">
        <span class="iname" style="color:${it.rarityColor}">${it.name}</span>
        <span class="verdicts">
          <span class="verdict ${v.dpsCls}" title="${attr('Estimated change to your damage per second, with the three abilities you have slotted, your talents and your companion.')}">${v.dpsText}</span>
          <span class="verdict ${v.ehpCls}" title="${attr('Estimated change to how long you survive sustained damage in this zone — your health, your armour and what your companion absorbs.')}">${v.ehpText}</span>
        </span>
      </div>
      <div class="il">${it.slotName} · i${it.ilvl}${cur ? ` · replaces ${cur.name}` : ''}</div>
      <div class="deltas">${deltaRows(cur, it) || '<div class="delta">no stat change</div>'}</div>
      <div class="row">
        <button class="${v.cls === 'up' ? 'up' : ''}" data-act="equip">Equip</button>
        <button data-act="sell">Sell ${sellValue(it)}⛃</button>
      </div>`;
    box.querySelector('[data-act="equip"]').addEventListener('click', () => {
      if (cur) s.inventory.push(cur);
      s.equipped[it.slot] = it;
      s.inventory = s.inventory.filter((x) => x.uid !== it.uid);
      afterGearChange();
    });
    box.querySelector('[data-act="sell"]').addEventListener('click', () => {
      s.gold += sellValue(it);
      s.inventory = s.inventory.filter((x) => x.uid !== it.uid);
      afterGearChange();
    });
    bags.appendChild(box);
  }
}

const sellValue = (it) => Math.round(it.ilvl * 3 + itemScore(it) * 0.4);

// ---------------------------------------------------------------- loot alerts
/**
 * Announce a drop over the viewport with Equip/Sell right there. Without this a drop
 * is just a line in the log, and acting on it means leaving the fight you're watching.
 */
/**
 * Ascensions get their own toast because they are not a gear decision -- there is
 * nothing to equip, sell or compare. It is an announcement, and it dismisses itself.
 */
/**
 * Ability copy is authored against the starting companion, so rewrite it to whatever is
 * actually standing there. Referring to a unit that no longer exists reads as a bug.
 */
/**
 * The ability as this character has it, matching what combat will actually fire. A
 * solo build sees "Field Dressing: patches yourself up", not "Mend Pet: heals your
 * wolf" for a wolf it sent away at level 5.
 */
function resolveAbility(a) {
  return a.solo && isSolo(game.save) ? { ...a, ...a.solo } : a;
}

function petText(text) {
  const s = game.save;
  const base = CLASSES[s.classId].companion;
  const form = currentForm(s);
  if (!base || !form || form.name === base.name) return text;
  return text
    .split(base.name).join(form.name)
    .split(base.name.toLowerCase()).join(form.name.toLowerCase());
}

/** Shown once, when the Hollow King goes down. */
function showVictory() {
  const s = game.save;
  $('choiceBody').innerHTML =
    `You have walked ${FINAL_ZONE} zones and put down the thing at the end of them.
     <b>${s.name}</b> finished at level ${s.level} with ${s.totalKills} kills.`;
  $('choiceTitle').textContent = 'The march is over';
  $('choiceKeep').innerHTML = '<b>Keep playing</b><span>The zones continue past 100. Nothing new is waiting, but the gear keeps dropping.</span>';
  $('choiceSolo').innerHTML = '<b>Back to the menu</b><span>Your character is saved exactly as it is.</span>';
  const close = () => {
    $('choiceModal').classList.add('hidden');
    game.paused = game.pausedBeforeChoice;
    updatePauseUi();
  };
  $('choiceKeep').onclick = () => { close(); afterGearChange(); };
  $('choiceSolo').onclick = () => { close(); leaveGame(); };
  game.pausedBeforeChoice = game.paused;
  game.paused = true;
  updatePauseUi();
  $('choiceModal').classList.remove('hidden');
}

function showAscendToast(form, oldName) {
  const el = document.createElement('div');
  el.className = 'toast ascend';
  el.innerHTML = `
    <div class="thead">
      <span class="tname">${form.name}</span>
      <span class="tverdict">ascended</span>
    </div>
    <div class="tsub">${oldName} → ${form.name}</div>
    <ul>
      <li>+${Math.round((form.ap - 1) * 100)}% companion damage</li>
      <li>+${Math.round((form.hp - 1) * 100)}% companion health</li>
      <li>+${Math.round((form.armor - 1) * 100)}% companion armour</li>
    </ul>`;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

/**
 * The ascension chase, made legible. Hiding the odds would make a rare drop feel
 * arbitrary rather than rare -- you should be able to see the pity ramp climbing.
 */
function renderPet() {
  const s = game.save;
  const forms = formsFor(s);
  $('petSec').classList.toggle('hidden', forms.length === 0 || !s.petChoice);
  if (forms.length === 0 || !s.petChoice) return;

  const cur = currentForm(s);
  const next = nextForm(s);
  const el = $('sec-pet');

  const pips = forms
    .map((f, i) => `<span class="pform ${i <= (s.petForm || 0) ? 'on' : ''}" title="${f.name}"></span>`)
    .join('');

  let chase;
  if (!next) {
    chase = '<p class="note">Fully ascended. There is nothing above this.</p>';
  } else if (Math.max(s.highestZone || 1, s.zone) < next.minZone) {
    chase = `<p class="note">Something further up the ladder stirs around Zone ${next.minZone}.</p>`;
  } else {
    const pct = bossChance(s, next);
    chase = `<p class="note">An ascension can drop from any kill, but bosses carry it.
      <b>${Math.round(pct * 100)}%</b> from the next boss — and that climbs with every boss
      that comes up empty.</p>`;
  }

  el.innerHTML = `
    <div class="petform">
      <span class="pname">${cur.name}</span>
      <span class="ppips">${pips}</span>
    </div>
    <div class="il">Form ${(s.petForm || 0) + 1} of ${forms.length}${
      (s.petForm || 0) > 0
        ? ` · +${Math.round((cur.ap - 1) * 100)}% damage, +${Math.round((cur.hp - 1) * 100)}% health`
        : ''
    }</div>
    ${chase}`;
}

/**
 * A drop is an announcement, not a decision.
 *
 * This used to be a card with Equip / Sell / Keep on it, which on a phone occupied a
 * third of the screen and put a three-way choice in front of the fight you were trying
 * to watch. Every one of those actions lives on the character sheet, next to the piece
 * it would replace -- which is the only place the comparison makes sense anyway. So this
 * says what fell and what it would do for you, and gets out of the way.
 */
/**
 * A drop is a nudge, not an event.
 *
 * This began as a card with Equip / Sell / Keep on it, which on a phone took a third of
 * the screen and put a three-way decision in front of the fight you were watching. Every
 * one of those actions lives on the character sheet now, beside the piece it would
 * replace, which is the only place the comparison means anything. So what is left is one
 * line: what fell, and whether it is worth walking over for.
 */
function showLootToast(item) {
  const v = verdictFor(item);
  const el = document.createElement("div");
  el.className = "nudge" + (v.delta > 0.005 ? " up" : "");
  el.innerHTML = `
    <span class="ndot" style="background:${item.rarityColor}"></span>
    <span class="nname">${item.name}</span>
    <span class="nver ${v.delta > 0.005 ? "up" : v.delta < -0.005 ? "down" : ""}">${v.dpsText}</span>`;
  el.addEventListener("click", () => { showTab("char"); el.remove(); });
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function afterGearChange() {
  // Rebuild so the fight immediately uses the new stats. Enemy HP carries over, and
  // so do health PERCENTAGES -- otherwise swapping gear mid-fight is a free full heal.
  const old = game.enc;
  const enemy = old.enemy;
  const pPct = old.player.hp / old.player.maxHp;
  const cPct = old.companion ? old.companion.hp / old.companion.maxHp : 1;

  rebuildEncounter();
  game.enc.enemy = enemy;
  game.enc.player.hp = Math.max(1, game.enc.player.maxHp * pPct);
  if (game.enc.companion) game.enc.companion.hp = game.enc.companion.maxHp * cPct;

  // Carry the whole POSITION IN THE FIGHT across, not just health. A fresh Encounter
  // starts with empty cooldowns and full swing timers, so spending a talent point or
  // equipping a piece mid-fight dumped every ability at once and looked like a
  // one-second haste burst. Changing your stats must not also refund your rotation.
  game.enc.companionReviveIn = old.companionReviveIn;
  game.enc.dots = old.dots;
  game.enc.hots = old.hots;
  game.enc.buffs = old.buffs;

  persist(game.save);
  renderAll();
}

// ---------------------------------------------------------------- talent points
// Allocatable points come from levelling alone. A trinket grants ranks directly to
// one named talent instead, so gear can never leave a character over-spent.
const availablePoints = (s) => earnedTalentPoints(s.level) - spentTalentPoints(s.talents);
// ---------------------------------------------------------------- wayside encounters
//
// The camp used to be a permanent panel on the Character tab holding an enchanter and a
// quartermaster: two shop UIs sitting there whether or not you cared, which you had to
// remember to go and visit. Same services, but they are now something that HAPPENS.
//
// You come across a chest nobody claimed, a merchant on the road, or an enchanter at a
// crossroads. Off a random kill these are rare enough to be a genuine find; after a boss
// one of the three is guaranteed, so the set-piece always pays out twice.
const ENCOUNTER_UNLOCK_LEVEL = 4;
const ENCOUNTER_CHANCE = 0.018;      // per ordinary kill -- deliberately rare
const ENCOUNTER_MIN_GAP = 12;        // kills since the last one, so it cannot cluster
const SHOP_SIZE = 3;

const shopPrice = (it) => Math.round(40 * it.ilvl + itemScore(it) * 6);

/** Roll for an encounter after a kill. A boss always produces one. */
function maybeEncounter(wasBoss) {
  const s = game.save;
  if (s.level < ENCOUNTER_UNLOCK_LEVEL) return false;
  const since = s.totalKills - (s.lastEncounterKill || 0);
  if (!wasBoss) {
    if (since < ENCOUNTER_MIN_GAP) return false;
    if (Math.random() >= ENCOUNTER_CHANCE) return false;
  }
  s.lastEncounterKill = s.totalKills;
  openEncounter(pickEncounter());
  return true;
}

function pickEncounter() {
  const roll = Math.random();
  if (roll < 0.45) return 'chest';
  if (roll < 0.78) return 'merchant';
  return 'enchanter';
}

function closeEncounter() {
  $('eventModal').classList.add('hidden');
  game.paused = game.pausedBeforeEvent;
  updatePauseUi();
  afterGearChange();
}

function openEncounter(kind) {
  const s = game.save;
  game.pausedBeforeEvent = game.paused;
  game.paused = true;
  updatePauseUi();
  $('eventModal').classList.remove('hidden');
  const body = $('eventBody');
  const zone = Math.max(1, s.zone - 1);

  const finish = () => closeEncounter();

  if (kind === 'chest') {
    const gold = Math.round(60 + zone * 22 * (0.7 + Math.random() * 0.8));
    const item = rollDrop(s.classId, zone + 2, true, { solo: isSolo(s) });
    $('eventTitle').textContent = 'An unclaimed chest';
    body.innerHTML = `
      <p class="note">Half-buried at the side of the trail, and whoever left it here is
        not coming back for it.</p>
      <div class="evloot">
        <div class="evgold">+${gold} gold</div>
        ${item ? `<div class="evitem" style="color:${item.rarityColor}">${item.name}</div>
          <div class="il">${item.slotName} · i${item.ilvl} · ${item.rarity}</div>` : ''}
      </div>`;
    $('eventActions').innerHTML = '<button class="primary">Take it</button>';
    $('eventActions').firstChild.onclick = () => {
      s.gold += gold;
      if (item) { s.inventory.push(item); log(`Chest: ${item.name} (${item.rarity}).`, 'big'); }
      log(`You pocket ${gold} gold from the chest.`, 'good');
      finish();
    };
    return;
  }

  if (kind === 'merchant') {
    const stock = [];
    for (let i = 0; i < SHOP_SIZE; i++) {
      const it = rollDrop(s.classId, zone, true, { solo: isSolo(s) });
      if (it) stock.push(it);
    }
    $('eventTitle').textContent = 'A merchant on the road';
    body.innerHTML = `
      <p class="note">A cart, a lamp, and someone who would rather be anywhere else.
        They will not be here on the way back.</p>
      <div id="evStock"></div>`;
    const wrap = body.querySelector('#evStock');
    for (const it of stock) {
      const price = shopPrice(it);
      const row = document.createElement('div');
      row.className = 'evrow';
      row.innerHTML = `
        <div class="ci">
          <span style="color:${it.rarityColor}">${it.name}</span>
          <div class="il">${it.slotName} · i${it.ilvl} · ${it.rarity}</div>
          <div class="evaff">${scaledAffixes(it).map((a) => `<span title="${attr(affixTip(a.stat))}">${a.label}</span>`).join('')}</div>
        </div>
        <button ${s.gold < price ? 'disabled' : ''}>${price}⛃</button>`;
      row.querySelector('button').addEventListener('click', (ev) => {
        if (s.gold < price) return;
        s.gold -= price;
        s.inventory.push(it);
        log(`Bought ${it.name} for ${price} gold.`, 'big');
        ev.target.disabled = true;
        ev.target.textContent = 'bought';
        renderAll();
      });
      wrap.appendChild(row);
    }
    $('eventActions').innerHTML = '<button>Move on</button>';
    $('eventActions').firstChild.onclick = finish;
    return;
  }

  // enchanter -- they will do two pieces and then they are done with you.
  const ENCHANTS_OFFERED = 2;
  let left = ENCHANTS_OFFERED;
  const worn = SLOTS.map((sl) => s.equipped[sl.id]).filter(Boolean).filter((it) => (it.enchant || 0) < ENCHANT_MAX);
  $('eventTitle').textContent = 'An enchanter at the crossroads';
  body.innerHTML = `
    <p class="note">They ask for nothing. An enchant scales every affix the piece has, so
      it makes the item more of what it already is — and they will do two.</p>
    ${worn.length === 0
      ? '<p class="note">Nothing you are wearing can take another enchant.</p>'
      : '<div class="enchleft" id="enchLeft"></div><div id="evEnch"></div>'}`;
  if (worn.length > 0) {
    const wrap = body.querySelector('#evEnch');
    for (const it of worn) {
      const rank = it.enchant || 0;
      // Free. Gold is already the repair economy and the merchant's; an enchanter you
      // happened to walk past is a piece of luck, and charging for luck makes it a shop.
      const cost = 0;
      const row = document.createElement('div');
      row.className = 'evrow';
      // Show the actual numbers, before and after. "Each affix +12%" is a percentage of
      // something you cannot see -- you have to already know what is on the piece for it
      // to mean anything, and four items deep you do not.
      const now = scaledAffixes(it);
      const next = scaledAffixes({ ...it, enchant: rank + 1 });
      const changes = now.map((a, i) => {
        const b = next[i];
        if (!b) return '';
        const fmt = (x) => AFFIXES.find((d) => d.stat === a.stat)?.fmt(x) ?? Math.round(x);
        return `<div class="enchrow" title="${attr(affixTip(a.stat))}">
          <span>${fmt(a.value)}</span><span class="arrow">→</span><b>${fmt(b.value)}</b></div>`;
      }).join('');

      row.innerHTML = `
        <div class="ci">
          <span style="color:${it.rarityColor}">${it.name}</span>${rank ? ` <b class="ench">+${rank}</b>` : ''}
          <div class="il">${it.slotName}${rank ? ` · currently +${rank}` : ''}</div>
          <div class="enchlist">${changes}</div>
        </div>
        <button>Enchant</button>`;
      row.querySelector('button').addEventListener('click', (ev) => {
        if (left <= 0) return;
        it.enchant = (it.enchant || 0) + 1;
        left--;
        log(`${it.name} enchanted to +${it.enchant}.`, 'big');
        ev.target.disabled = true;
        ev.target.textContent = 'done';
        updateEnchLeft();
        renderAll();
      });
      wrap.appendChild(row);
    }
  }
  // Two and no more, said out loud and counting down, so choosing WHICH two is the
  // decision rather than "enchant everything you can afford".
  function updateEnchLeft() {
    const el = $('enchLeft');
    if (el) el.textContent = left + '/' + ENCHANTS_OFFERED + ' enchants remaining';
    if (left > 0) return;
    for (const b of document.querySelectorAll('#evEnch button')) {
      if (b.textContent !== 'done') { b.disabled = true; b.textContent = 'no more'; }
    }
  }
  updateEnchLeft();
  $('eventActions').innerHTML = '<button>Move on</button>';
  $('eventActions').firstChild.onclick = finish;
}

// ---------------------------------------------------------------- talents
function renderTalents() {
  const s = game.save;
  const el = $('sec-talents');
  el.innerHTML = '';
  if (s.level < TALENT_UNLOCK_LEVEL) {
    el.innerHTML = `<p class="note">Talents unlock at character level ${TALENT_UNLOCK_LEVEL}. You're level ${s.level}.</p>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'statline';
  head.innerHTML = `<span>Unspent points</span><span>${availablePoints(s)}</span>`;
  el.appendChild(head);

  const addTalent = (t) => {
    const rank = s.talents[t.id] || 0;
    const bonus = trinketRanksFor(s, t.id);
    const locked = s.level < t.req;
    const row = document.createElement('div');
    row.className = 'talent' + (locked ? ' locked' : '');
    row.innerHTML = `
      <div class="tinfo"><div class="tn">${t.name}</div><div class="td">${t.desc}</div></div>
      <div class="rank${bonus ? ' boosted' : ''}">${rank + bonus}/${t.max}${bonus ? ` <span class="tri">+${bonus}</span>` : ''}</div>
      <button ${locked || rank >= t.max || availablePoints(s) < 1 ? 'disabled' : ''}>+</button>`;
    row.querySelector('button').addEventListener('click', () => {
      s.talents[t.id] = rank + 1;
      afterGearChange();
    });
    el.appendChild(row);
  };

  const solo = isSolo(s);
  const visible = TALENTS[s.classId].filter((t) => !(solo && isPetTalent(t)));

  let branch = null;
  for (const t of visible.filter((x) => x.tier === 1)) {
    if (t.branch !== branch) {
      branch = t.branch;
      const b = document.createElement('div');
      b.className = 'branch';
      b.textContent = branch.toUpperCase();
      el.appendChild(b);
    }
    addTalent(t);
  }

  const deep = visible.filter((x) => x.tier === 2);
  const dh = document.createElement('div');
  dh.className = 'branch mastery';
  dh.textContent = s.level >= DEEP_TALENT_LEVEL
    ? 'MASTERY — ABILITY SPECIALISATION'
    : `MASTERY — LOCKED UNTIL LEVEL ${DEEP_TALENT_LEVEL}`;
  el.appendChild(dh);
  for (const t of deep) addTalent(t);

  const cost = respecCost(s.respecCount);
  const btn = document.createElement('button');
  btn.className = 'primary wide';
  btn.textContent = `Respec — ${cost}⛃`;
  btn.disabled = s.gold < cost || Object.keys(s.talents).length === 0;
  btn.addEventListener('click', () => {
    if (s.gold < cost) return;
    s.gold -= cost;
    s.talents = {};
    s.respecCount++;
    log(`Respecced for ${cost} gold.`, 'big');
    afterGearChange();
  });
  el.appendChild(btn);
}

// The old Stats panel is gone on purpose: everything on it that mattered is now in the
// always-visible vitals strip, and the rest was a second place to look for one number.

// ---------------------------------------------------------------- controls
/**
 * One function drives both the desktop tab strip and the phone bottom bar, so the two
 * can never disagree about which panel is showing.
 */
function showTab(name) {
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('hidden', p.id !== 'tab-' + name);
  // On a phone the scene gives up its height when you are not watching it. Reading your
  // talents is not a moment you need to see the fight, and 198px is the difference
  // between a panel you scroll constantly and one you can read.
  $('screen-game').classList.toggle('scene-away', name !== 'play');
  for (const b of document.querySelectorAll('.tab, .bnav')) b.classList.toggle('active', b.dataset.tab === name);
  // Opening a tab is what clears its unread marker.
  if (name === 'play') { $('lootBadge').classList.add('hidden'); $('lootDot').classList.add('hidden'); }
  if (name === 'char') { $('talentBadge').classList.add('hidden'); $('talentDot').classList.add('hidden'); }
}

for (const btn of document.querySelectorAll('.tab, .bnav')) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
}

/**
 * Tap-to-read tooltips.
 *
 * Everything explanatory here carries a `title`, and a touch device never shows one --
 * so on a phone every stat description, affix explanation and talent grant was simply
 * invisible. Tapping anything explanatory opens a panel instead. Buttons and inputs are
 * skipped so this can never swallow an action.
 */
document.addEventListener('click', (ev) => {
  const tip = $('tipTap');
  if (!tip) return;
  const hit = ev.target.closest('[title]');
  const interactive = ev.target.closest('button, input, a, label, select');
  if (!hit || interactive || !hit.title) { tip.classList.add("hidden"); return; }
  const label = hit.querySelector('.vl')?.textContent || hit.textContent.trim().slice(0, 44) || 'Detail';
  tip.innerHTML = '<b></b><span></span>';
  tip.querySelector('b').textContent = label;
  tip.querySelector('span').textContent = hit.title;
  tip.classList.remove('hidden');
});

function updatePauseUi() {
  $('pauseBtn').textContent = game.paused ? 'Resume' : 'Pause';
  $('pauseBtn').disabled = game.awayPaused;
  $('awayNotice').classList.toggle('hidden', !game.awayPaused);
}

$('pauseBtn').addEventListener('click', () => {
  game.paused = !game.paused;
  updatePauseUi();
});

$('speedBtn').addEventListener('click', () => {
  game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 4 : 1;
  $('speedBtn').textContent = game.speed + '×';
});

$('menuContinue').addEventListener('click', () => {
  const existing = load();
  if (!existing) return showMenu();
  game.save = existing;
  startGame();
  if (needsPetChoice(existing)) offerPetChoice();
});

$('menuNew').addEventListener('click', () => {
  pickedClass = null;
  $('startBtn').disabled = true;
  $('charName').value = '';
  [...$('classGrid').children].forEach((n) => n.classList.remove('sel'));
  showScreen('screen-create');
});

$('createBack').addEventListener('click', showMenu);

$('menuWipe').addEventListener('click', () => {
  if (!confirm('Delete this character permanently? This cannot be undone.')) return;
  // Drop the in-memory character and stop the loop FIRST. Any later persist --
  // including the one on beforeunload -- would otherwise write it straight back.
  game.running = false;
  clearInterval(game.logicTimer);
  game.save = null;
  wipe();
  showMenu();
});

$('saveBtn').addEventListener('click', () => {
  if (!game.save) return;
  persist(game.save);
  const el = document.createElement('div');
  el.className = 'toast saved';
  el.innerHTML = '<div class="thead"><span class="tname">Saved</span></div>';
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 1600);
});

$('menuBtn').addEventListener('click', leaveGame);

$('deadOk').addEventListener('click', () => {
  $('deadModal').classList.add('hidden');
  showMenu();
});

window.addEventListener('beforeunload', () => { if (game.save) persist(game.save); });

// There is no offline or away progression: the game only advances while you are
// actually watching it. A hidden tab is explicitly halted rather than left to tick
// along in the background, so nothing happens that you weren't present for.
document.addEventListener('visibilitychange', () => {
  if (!game.save) return;
  if (document.hidden) {
    game.awayPaused = true;
    persist(game.save);
  } else {
    game.awayPaused = false;
    game.lastFrame = performance.now();
    game.lastLogic = performance.now();
  }
  updatePauseUi();
});

boot();

window.game = game; // exposed for debugging in the console
