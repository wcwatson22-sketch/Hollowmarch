// Canvas renderer.
//
// Sprites are still PLACEHOLDER art -- 16x16 grids tinted per unit -- but everything
// around them is doing the work: sprites are pre-rendered to offscreen canvases with a
// baked 1px outline (the single biggest readability win in pixel art, and far too
// expensive to redraw per frame cell-by-cell), hits produce lunge/flinch/flash/shake,
// deaths dissolve into falling pixels, and each zone carries its own parallax depth and
// weather. Swapping in real sprite sheets means replacing `buildSprite` and nothing else.

import { themeForZone, isBossZone } from '../data/mobs.js';
import { lookFor, DRAW_ORDER, shiftRgb } from './gear-art.js';
import { BODIES } from './bodies.js';
import { SLOTS } from '../data/affixes.js';

const PX = 4;
// The scene grew with the characters: a 96px-tall hero needs room to stand and space
// between three combatants.
const GROUND_Y = 300;
export const VW = 720, VH = 380;

// The width that must stay on screen. The scene is 720 across, but the outer 80 either
// side is scenery -- the player stands at x=132, the companion at 300, the enemy at 578,
// each about 96 wide. Cover-filling a phone canvas crops the sides, and this is how much
// of that crop is safe to take.
export const CONTENT_W = 550;
const OUTLINE = '#141018';

export const ANCHORS = {
  player: { x: 64, cx: 132, facing: 1 },
  pet:    { x: 160, cx: 300, facing: 1 },
  enemy:  { x: 420, cx: 578, facing: -1 },
};

// PX is now the humanoid's cell size; each body carries its own in BODIES.
const HUMANOID = BODIES.humanoid.grid;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return `rgb(${clamp(((n >> 16) & 255) + amt)},${clamp(((n >> 8) & 255) + amt)},${clamp((n & 255) + amt)})`;
}

function palette(color) {
  return {
    b: color,               // garment base
    a: shade(color, -24),   // sleeve: darker than the torso so arms read as limbs
    L: shade(color, 26),    // garment light
    B: shade(color, -34),   // garment shadow
    h: '#3a2c22', H: '#57422f',        // hair
    k: '#e0b892', K: '#b8906c',        // skin, skin shadow
    e: '#241a14',                      // eye
    l: shade(color, -58), M: shade(color, -78),  // trousers
    s: '#3b3128', S: '#544639',        // boots
    t: shade(color, -20),              // horn / tail accent
    f: '#e0b892', w: shade(color, -25), m: shade(color, -70),
  };
}

// --- sprite cache -----------------------------------------------------------------
const spriteCache = new Map();
const CACHE_LIMIT = 240;

/**
 * Composite a body grid with any number of gear overlays into one cached canvas.
 *
 * The outline is computed from the COMBINED silhouette, so a helmet's horns or a
 * blade get outlined too -- which is the whole reason gear is baked in here rather
 * than drawn as separate passes at render time.
 */
const MARGIN = 4;             // cells of headroom for gear that overhangs the body

function buildSprite(kind, color, overlays, flip, white) {
  const body = BODIES[kind] || BODIES.humanoid;
  const grid = body.grid, cell = body.cell;
  const rows = grid.length, cols = grid[0].length;
  const cv = document.createElement('canvas');
  cv.width = (cols + MARGIN * 2) * cell;
  cv.height = (rows + MARGIN * 2) * cell;
  const g = cv.getContext('2d');
  const pal = palette(color);
  const OX = MARGIN, OY = MARGIN;

  const filled = new Set();
  const mark = (x, y) => filled.add(`${x},${y}`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (grid[r][c] !== '.') mark(c, r);
  }
  for (const o of overlays) {
    for (const [x, y, w, h] of [...o.rects, ...(o.ornate || [])]) {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) mark(x + dx, y + dy);
    }
  }

  g.fillStyle = OUTLINE;
  for (const key of filled) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      g.fillRect((x + OX + dx) * cell, (y + OY + dy) * cell, cell, cell);
    }
  }

  // Body.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      if (ch === '.') continue;
      g.fillStyle = white ? '#ffffff' : (pal[ch] || color);
      g.fillRect((c + OX) * cell, (r + OY) * cell, cell, cell);
    }
  }

  // Gear, painted over the body in slot order. Three tones per piece -- a lit top
  // edge, the base, and a shadowed bottom -- is what separates "armour" from "a
  // coloured rectangle" at this resolution.
  for (const o of overlays) {
    for (const [x, y, w, h] of o.rects) {
      const px = (x + OX) * cell, py = (y + OY) * cell;
      g.fillStyle = white ? '#ffffff' : o.color;
      g.fillRect(px, py, w * cell, h * cell);
      if (white) continue;
      // Light from the upper-left, shadow to the lower-right. Shading only the top row
      // left big plate pieces looking like flat slabs.
      g.fillStyle = shiftRgb(o.color, 30);
      g.fillRect(px, py, w * cell, cell);
      if (w > 2) g.fillRect(px, py, cell, h * cell);
      g.fillStyle = shiftRgb(o.color, -38);
      if (h > 2) g.fillRect(px, py + (h - 1) * cell, w * cell, cell);
      if (w > 2) g.fillRect(px + (w - 1) * cell, py, cell, h * cell);
    }

    // Detail pass: rivets, seams, belts, lacing, hems. A numeric tone shifts the
    // piece's own colour; 'trim' paints the armour type's accent. This is what turns
    // a shaded rectangle into a recognisable piece of armour.
    if (white) continue;
    for (const [x, y, w, h, tone] of o.detail || []) {
      g.fillStyle = tone === 'trim' ? o.trim : shiftRgb(o.color, tone);
      g.fillRect((x + OX) * cell, (y + OY) * cell, w * cell, h * cell);
    }
    // Ornaments: spikes, crests, gorgets, pommel gems. Only present on better gear, so
    // a legendary reads as forged better rather than merely painted a different colour.
    for (const [x, y, w, h, tone] of o.ornate || []) {
      g.fillStyle = tone === 'trim' ? o.trim : shiftRgb(o.color, tone);
      g.fillRect((x + OX) * cell, (y + OY) * cell, w * cell, h * cell);
      g.fillStyle = shiftRgb(tone === 'trim' ? o.trim : o.color, 34);
      g.fillRect((x + OX) * cell, (y + OY) * cell, w * cell, cell);
    }
  }

  if (!flip) return cv;
  const fv = document.createElement('canvas');
  fv.width = cv.width; fv.height = cv.height;
  const fg = fv.getContext('2d');
  fg.translate(cv.width, 0);
  fg.scale(-1, 1);
  fg.drawImage(cv, 0, 0);
  return fv;
}

function getSprite(kind, color, flip, white, overlays = []) {
  const sig = overlays.map((o) => `${o.color}:${o.trim}:${o.rects.length}:${o.rects[0]}:${(o.detail || []).length}:${(o.ornate || []).length}`).join('/');
  const id = `${kind}|${color}|${sig}|${flip ? 1 : 0}|${white ? 1 : 0}`;
  let cv = spriteCache.get(id);
  if (!cv) {
    // Gear changes create new combinations; bound the cache rather than leak canvases.
    if (spriteCache.size > CACHE_LIMIT) spriteCache.clear();
    cv = buildSprite(kind, color, overlays, flip, white);
    spriteCache.set(id, cv);
  }
  return cv;
}

/** Equipped armour and weapon, resolved to draw layers in body order. */
function gearOverlays(save) {
  if (!save?.equipped) return [];
  const out = [];
  for (const slotId of DRAW_ORDER) {
    const slot = SLOTS.find((s) => s.id === slotId);
    if (!slot) continue;
    const look = lookFor(slot.base || slot.id, save.equipped[slot.id], save.classId);
    if (look) out.push(look);
  }
  return out;
}

/** The composited player sprite, exposed so gear art can be previewed at scale. */
export function playerSpriteCanvas(save, classColor) {
  return getSprite('humanoid', classColor, false, false, gearOverlays(save));
}

/**
 * An ascended companion wears real armour rather than a recolour. Reusing the gear art
 * is what lets the priest's humanoid companion change shape without a second body grid.
 */
function companionOverlays(gear) {
  if (!gear || gear.length === 0) return [];
  const out = [];
  for (const slotId of DRAW_ORDER) {
    const g = gear.find((x) => x.slot === slotId);
    // Always plate: an ascended guard is armoured regardless of who is healing it.
    if (g) {
      const look = lookFor(g.slot, { art: g.art, rarity: g.rarity }, 'warrior');
      if (look) out.push(look);
    }
  }
  return out;
}

function spriteKindFor(name) {
  if (/wolf|hound/i.test(name)) return 'wolf';
  if (/imp|fiend/i.test(name)) return 'imp';
  if (/grub|wisp|blob|lurker|horror/i.test(name)) return 'blob';
  if (/rat|boar|crawler|stalker/i.test(name)) return 'beast';
  return 'humanoid';
}


// --- damage types -----------------------------------------------------------------
//
// The floating number tells you WHAT hit, not just how hard. A screen of identical
// white numbers is unreadable at four hits a second, and it hides the thing you most
// want to see: whether the build you are actually running is the one doing the work.
export const DAMAGE_COLOR = {
  physical: '#f2f2f2',
  bleed:    '#a82020',
  fire:     '#d2691e',
  poison:   '#4faf4f',
  shadow:   '#9a5fd0',
  holy:     '#ffe9a8',
  arcane:   '#7fa8e8',
  crit:     '#ffd75f',
};

/** Damage type per ability id. Anything unlisted is physical. */
export const ABILITY_TYPE = {
  // warrior
  rend: 'bleed', deepwound: 'bleed',
  // hunter
  sting: 'poison', trap: 'fire', arcaneshot: 'arcane',
  // priest
  holyfire: 'fire', holynova: 'holy', penance: 'holy', smite: 'holy', atonement: 'holy',
  swp: 'shadow', shadowfiend: 'shadow',
  // warlock
  corruption: 'shadow', agony: 'shadow', ua: 'shadow', drain: 'shadow',
  chaosbolt: 'shadow',
  // The warlock auto-attack is a wand, and arcane rather than shadow.
  wandshot: 'arcane',
  immolate: 'fire', shadowburn: 'fire', soulfire: 'fire',
};

/** Colour for a damage number. A crit is always gold, whatever produced it. */
export function damageColor(id, crit, kind) {
  if (crit) return DAMAGE_COLOR.crit;
  const key = (id || "").toLowerCase().replace(/[^a-z]/g, "");
  return DAMAGE_COLOR[ABILITY_TYPE[key]] || DAMAGE_COLOR.physical;
}
const SCHOOL_COLOR = { magic: '#b98ce8', phys: '#ffe0a0' };

/**
 * Each spell gets its own colour and delivery so the fight is readable at a glance:
 * fire is an orange orb, shadow a violet one, a hunter's shot is an arrow, and Drain
 * Life is a sustained beam rather than a thrown ball.
 *   core  — the bright centre        glow — the halo and trail
 *   kind  — orb | arrow | beam | slash
 */
const SPELLS = {
  // warlock
  agony:      { core: '#b6f0a0', glow: '#3f7a2f', kind: 'orb' },
  ua:         { core: '#e0a0ff', glow: '#6a1fa0', kind: 'orb' },
  shadowburn: { core: '#ffc890', glow: '#c04010', kind: 'orb' },
  chaosbolt:  { core: '#f0c0ff', glow: '#8a20d0', kind: 'orb' },
  soulfire:   { core: '#ffe0a0', glow: '#e05010', kind: 'orb' },
  felarmor:   { core: '#c0f0a0', glow: '#4a7a2f', kind: 'orb' },
  // priest
  holyfire:   { core: '#ffe0a0', glow: '#e08020', kind: 'orb' },
  holynova:   { core: '#fff8e0', glow: '#e0b040', kind: 'orb' },
  penance:    { core: '#fff0c0', glow: '#d0a030', kind: 'orb' },
  shadowfiend:{ core: '#d0a8f0', glow: '#5a2080', kind: 'orb' },
  renew:      { core: '#d0ffd8', glow: '#3f9a5f', kind: 'orb' },
  gheal:      { core: '#e0ffe8', glow: '#3f9a5f', kind: 'orb' },
  mending:    { core: '#e0ffe8', glow: '#3f9a5f', kind: 'orb' },
  fort:       { core: '#fff0c0', glow: '#b08a3a', kind: 'orb' },
  innerfire:  { core: '#ffe8b0', glow: '#c08030', kind: 'orb' },
  // hunter
  arcaneshot: { core: '#c8d8ff', glow: '#4a5fb0', kind: 'arrow' },
  trap:       { core: '#ffc070', glow: '#b05020', kind: 'arrow' },
  concussive: { core: '#f0e0b0', glow: '#8a7040', kind: 'arrow' },
  killshot:   { core: '#ffd0c0', glow: '#b03020', kind: 'arrow' },
  hawk:       { core: '#d8f0a0', glow: '#5f8a2f', kind: 'orb' },
  bestial:    { core: '#ffc0a0', glow: '#a04020', kind: 'orb' },
  mendpet:    { core: '#d0ffd8', glow: '#3f9a5f', kind: 'orb' },
  bwrath:     { core: '#ffc0a0', glow: '#a04020', kind: 'orb' },
  demonic:    { core: '#e0a0ff', glow: '#7a2fb0', kind: 'orb' },
  // warrior
  heroic:     { core: '#ffe8b8', glow: '#8a7040', kind: 'slash' },
  deepwound:  { core: '#ff9a9a', glow: '#8a1010', kind: 'slash' },
  mortal:     { core: '#ffd0b0', glow: '#a03020', kind: 'slash' },
  bladestorm: { core: '#fff0d0', glow: '#c06020', kind: 'slash' },
  laststand:  { core: '#ffd890', glow: '#a06020', kind: 'orb' },
  secondwind: { core: '#d0ffd8', glow: '#3f9a5f', kind: 'orb' },
  // warlock
  corruption: { core: '#c79cf5', glow: '#7b3fb5', kind: 'orb' },
  immolate:   { core: '#ffd070', glow: '#e05a1a', kind: 'orb' },
  drain:      { core: '#e0a0ff', glow: '#8a2fc0', kind: 'beam' },
  // priest
  swp:        { core: '#d0a8f0', glow: '#6a2f9a', kind: 'orb' },
  smite:      { core: '#fff6d0', glow: '#e0b040', kind: 'orb' },
  // hunter
  sting:      { core: '#c8f59a', glow: '#4f9a2f', kind: 'arrow' },
  aimed:      { core: '#fff0c0', glow: '#b08a3a', kind: 'arrow' },
  shot:       { core: '#f0e4c0', glow: '#8a7040', kind: 'arrow' },
  // warrior
  rend:       { core: '#ff9a9a', glow: '#a02020', kind: 'slash' },
  shieldbash: { core: '#ffe0a0', glow: '#9a7030', kind: 'slash' },
  execute:    { core: '#ffd0d0', glow: '#c02020', kind: 'slash' },
  attack:     { core: '#ffe0a0', glow: '#8a7040', kind: 'slash' },
};

/**
 * The colour an ability draws in, exposed so the damage meter can use the same one.
 * A bar that matches the bolt you just watched cross the screen is readable without
 * having to read it.
 */
export function abilityColor(id, name, school) {
  return spellFor(id, name, school, null).core;
}

function spellFor(id, name, school, kind) {
  if (SPELLS[id]) return SPELLS[id];
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (SPELLS[key]) return SPELLS[key];
  const magic = school === 'magic';
  return {
    core: magic ? '#d8b8ff' : '#ffe0a0',
    glow: magic ? '#7b3fb5' : '#8a7040',
    kind: kind === 'auto' || kind === 'stun' || kind === 'execute' ? 'slash' : 'orb',
  };
}

/** Per-unit impact state. Everything decays back to rest on its own. */
const newUnitState = () => ({ lunge: 0, flinch: 0, flash: 0 });

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.floaters = [];
    this.casts = [];
    this.projectiles = [];
    this.slashes = [];
    this.motes = [];
    this.bits = [];      // death dissolve + impact debris
    this.bursts = [];    // expanding impact rings
    this.beams = [];     // sustained channels
    this.auraTimer = 0;  // paces the drifting motes a DoT leaves on its target
    this.weather = [];
    this.units = { player: newUnitState(), pet: newUnitState(), enemy: newUnitState() };
    this.shakeAmount = 0;
    this.t = 0;
    this.lastZone = null;
  }

  // --- impact API -----------------------------------------------------------

  /**
   * A one-off flourish for something that happens rarely enough to deserve one.
   * Rings out from the unit plus a shower of motes, so an ascension is a moment on
   * screen and not just a line in the log.
   */
  celebrate(who, color) {
    const a = ANCHORS[who];
    if (!a) return;
    for (let i = 0; i < 3; i++) {
      this.bursts.push({
        x: a.cx, y: GROUND_Y - 60, r: 6 + i * 10,
        max: 90 + i * 34, life: 0.7 + i * 0.16, max_life: 0.7 + i * 0.16, color,
      });
    }
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 130;
      this.bits.push({
        x: a.cx, y: GROUND_Y - 60,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60,
        size: 2 + Math.random() * 3, color, life: 0.6 + Math.random() * 0.7, grav: 120,
      });
    }
    this.shake(7);
  }
  /** Wind the attacker forward; the swing reads as intent before the number lands. */
  onAttack(who) {
    const u = this.units[who];
    if (u) u.lunge = 1;
  }

  /** Recoil, flash, debris and shake, all scaled to how big the hit was. */
  onHit(who, { amount = 0, maxHp = 1, crit = false, school = 'phys' } = {}) {
    const u = this.units[who];
    if (!u) return;
    const severity = Math.max(0.25, Math.min(1, (amount / Math.max(1, maxHp)) * 6));
    u.flinch = Math.max(u.flinch, severity);
    u.flash = 1;

    const a = ANCHORS[who];
    const color = crit ? '#ffd75f' : SCHOOL_COLOR[school] || '#ffffff';
    const count = crit ? 10 : 4 + Math.round(severity * 4);
    for (let i = 0; i < count; i++) {
      const ang = Math.PI * (0.15 + Math.random() * 0.7) * -a.facing + (a.facing > 0 ? 0 : Math.PI);
      const speed = 30 + Math.random() * 70 * (crit ? 1.6 : 1);
      this.bits.push({
        x: a.cx + (Math.random() * 16 - 8),
        y: GROUND_Y - 64 - Math.random() * 34,
        vx: Math.cos(ang) * speed, vy: -Math.abs(Math.sin(ang)) * speed - 20,
        size: crit ? 3 : 2, color, life: 0.4 + Math.random() * 0.3, grav: 260,
      });
    }
    this.bursts.push({
      x: a.cx, y: GROUND_Y - 64, r: crit ? 10 : 6,
      max: (crit ? 42 : 26) * (0.6 + severity), life: crit ? 0.34 : 0.24,
      max_life: crit ? 0.34 : 0.24, color,
    });
    this.shake((crit ? 3.2 : 1.6) * severity);
  }

  /** Break the sprite into falling pixels rather than blinking it out of existence. */
  onDeath(who, { name = '', color = '#888', boss = false } = {}) {
    const a = ANCHORS[who];
    if (!a) return;
    const kind = spriteKindFor(name);
    const body = BODIES[kind];
    const grid = body.grid, cell = body.cell;
    const pal = palette(color);
    const scale = boss ? 1.5 : 1;
    const spriteW = grid[0].length * cell * scale;
    const left = a.cx - spriteW / 2;
    const top = GROUND_Y - grid.length * cell * scale;

    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        const ch = grid[r][c];
        if (ch === '.' || Math.random() > 0.4) continue;
        this.bits.push({
          x: left + (grid[r].length - 1 - c) * cell * scale,
          y: top + r * cell * scale,
          vx: (Math.random() - 0.3) * 70,
          vy: -40 - Math.random() * 90,
          size: Math.max(2, cell * scale), color: pal[ch] || color,
          life: 0.6 + Math.random() * 0.5, grav: 320,
        });
      }
    }
    this.shake(boss ? 6 : 2.5);
  }

  shake(amount) {
    this.shakeAmount = Math.min(9, this.shakeAmount + amount);
  }

  // --- floating text --------------------------------------------------------
  addFloater(text, anchor, color, { crit = false, kind = 'ability' } = {}) {
    const a = ANCHORS[anchor] || ANCHORS.enemy;
    const tick = kind === 'dot' || kind === 'pet';

    // Numbers used to land on a random scatter and pile on top of each other. A short
    // rotating lane per unit keeps them legible without making the fight feel gridded.
    this.floatSlot = ((this.floatSlot || 0) + 1) % 5;
    const lane = (this.floatSlot - 2) * 13;

    this.floaters.push({
      text, color, crit,
      size: crit ? 16 : tick ? 9 : 12,
      x: a.cx + lane + (Math.random() * 6 - 3),
      y: 196 + (this.floatSlot % 2) * 9,
      vy: crit ? -42 : tick ? -20 : -28,
      // Ticks fade fast so they never queue up in front of the hits that matter.
      life: crit ? 1.5 : tick ? 0.75 : 1.1,
      pop: crit ? 1 : 0,
    });
  }

  addCast({ id, name, school, kind, target, casterColor }) {
    const from = kind === 'pet' ? ANCHORS.pet : ANCHORS.player;
    const to = target === 'enemy' ? ANCHORS.enemy : target === 'pet' ? ANCHORS.pet : ANCHORS.player;
    const color = SCHOOL_COLOR[school] || '#ffffff';

    if (kind !== 'auto' && kind !== 'pet') {
      const MAX_LABELS = 3;
      if (this.casts.length >= MAX_LABELS) this.casts.shift();
      this.casts.push({
        text: name, x: from.cx, y: 176 - this.casts.length * 13,
        life: 1.4, color: casterColor || color,
      });
    }

    if (kind === 'healpet' || kind === 'hot') {
      for (let i = 0; i < 7; i++) {
        this.motes.push({
          x: to.cx + (Math.random() * 24 - 12),
          y: GROUND_Y - 26 - Math.random() * 52,
          life: 0.9 + Math.random() * 0.4, color: '#8fe8b0',
        });
      }
      return;
    }
    if (kind === 'buff' || kind === 'buffpet') {
      for (let i = 0; i < 9; i++) {
        this.motes.push({
          x: to.cx + (Math.random() * 26 - 13),
          y: GROUND_Y - 8 - Math.random() * 12,
          life: 1.0, rise: -34, color: '#ffd75f',
        });
      }
      return;
    }

    const spell = spellFor(id, name, school, kind);
    if (spell.kind === 'slash') {
      this.slashes.push({ x: to.cx - 20, y: GROUND_Y - 84, life: 0.28, color: spell.core });
    } else if (spell.kind === 'beam') {
      this.beams.push({
        x: from.cx, y: GROUND_Y - 82, tx: to.cx, ty: GROUND_Y - 78,
        life: 0.8, max: 0.8, core: spell.core, glow: spell.glow,
      });
    } else {
      this.projectiles.push({
        x: from.cx, y: GROUND_Y - 74, tx: to.cx, ty: GROUND_Y - 78,
        core: spell.core, glow: spell.glow, arrow: spell.kind === 'arrow',
        life: 0.42, max: 0.42, big: kind === 'nuke' || kind === 'dot',
      });
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    // COVER, not contain.
    //
    // Scaling by width alone means the scene is always 720x380, so a phone gets a 375px
    // wide strip 198px tall no matter how much room the layout gives it -- the fight ends
    // up the smallest thing on screen in a game about watching a fight. Taking the larger
    // of the two scales fills whatever box the layout hands over, and the overflow is
    // trimmed off the SIDES, which is empty scenery: the player stands at x=132, the
    // companion at 300 and the enemy at 578, all well inside the crop at any sane aspect.
    const w = rect.width * dpr, h = rect.height * dpr;
    this.dpr = dpr;
    this.scale = Math.max(w / VW, h / VH);
    this.offsetX = (w - VW * this.scale) / 2;
    this.offsetY = h - VH * this.scale;   // keep the ground line on the floor
    this.ctx.imageSmoothingEnabled = false;
  }

  // --- weather --------------------------------------------------------------
  spawnWeather(theme, dt) {
    const rate = { pollen: 6, ash: 14, rain: 42, void: 8 }[theme.weather] || 0;
    this.weatherAcc = (this.weatherAcc || 0) + rate * dt;
    while (this.weatherAcc >= 1) {
      this.weatherAcc -= 1;
      const kind = theme.weather;
      if (kind === 'rain') {
        this.weather.push({ kind, x: Math.random() * (VW + 60) - 30, y: -6, vx: -50, vy: 420, life: 1.2 });
      } else if (kind === 'ash') {
        this.weather.push({ kind, x: Math.random() * VW, y: -4, vx: -14 + Math.random() * 8, vy: 22 + Math.random() * 18, life: 9 });
      } else if (kind === 'pollen') {
        this.weather.push({ kind, x: Math.random() * VW, y: GROUND_Y - Math.random() * 90, vx: 10 + Math.random() * 12, vy: -6 - Math.random() * 8, life: 6 });
      } else {
        this.weather.push({ kind, x: Math.random() * VW, y: GROUND_Y - Math.random() * 110, vx: -6 + Math.random() * 12, vy: -14 - Math.random() * 12, life: 5 });
      }
    }
  }

  drawWeather(ctx, theme, dt) {
    for (const w of this.weather) {
      w.life -= dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      if (w.kind === 'ash' || w.kind === 'pollen') w.x += Math.sin(this.t * 2 + w.y * 0.05) * 8 * dt;

      if (w.kind === 'rain') {
        ctx.fillStyle = 'rgba(170,205,215,0.5)';
        ctx.fillRect(w.x, w.y, 1, 7);
      } else if (w.kind === 'ash') {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#d8c0a0';
        ctx.fillRect(w.x, w.y, 2, 2);
        ctx.globalAlpha = 1;
      } else if (w.kind === 'pollen') {
        ctx.globalAlpha = 0.5 + Math.sin(this.t * 3 + w.x) * 0.25;
        ctx.fillStyle = '#f2f0c0';
        ctx.fillRect(w.x, w.y, 2, 2);
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#c39cf0';
        ctx.fillRect(w.x, w.y, 2, 2);
        ctx.globalAlpha = 1;
      }
    }
    this.weather = this.weather.filter((w) => w.life > 0 && w.y < VH + 10);
  }

  // --- main draw ------------------------------------------------------------
  draw(enc, save, dt) {
    if (!this.scale) this.resize();
    const ctx = this.ctx;
    this.t += dt;

    const theme = themeForZone(save.zone);
    if (save.zone !== this.lastZone) {
      this.lastZone = save.zone;
      this.weather.length = 0;
    }

    // Decay impact state.
    for (const u of Object.values(this.units)) {
      u.lunge = Math.max(0, u.lunge - dt / 0.18);
      u.flinch = Math.max(0, u.flinch - dt / 0.16);
      u.flash = Math.max(0, u.flash - dt / 0.09);
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 26);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const sx = (Math.random() - 0.5) * this.shakeAmount;
    const sy = (Math.random() - 0.5) * this.shakeAmount;
    ctx.setTransform(
      this.scale, 0, 0, this.scale,
      this.offsetX + sx * this.scale,
      this.offsetY + sy * this.scale
    );

    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, theme.sky);
    sky.addColorStop(1, theme.sky2 || shade(theme.sky, 30));
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, VW + 20, VH + 20);

    // Parallax: far ridge, mid ridge, then the ground the fight happens on.
    this.drawHills(ctx, theme.far, 26, 16, 0.020, 3, 0.0);   // distant, slow, tall
    this.drawHills(ctx, theme.mid, 6, 9, 0.045, 11, 2.3);   // nearer, faster, lower

    ctx.fillStyle = theme.ground;
    ctx.fillRect(-10, GROUND_Y, VW + 20, VH - GROUND_Y + 10);
    ctx.fillStyle = shade(theme.ground, 26);
    ctx.fillRect(-10, GROUND_Y, VW + 20, 4);
    ctx.fillStyle = theme.accent;
    for (let x = -20; x < VW + 20; x += 16) {
      const j = ((x * 7919) % 11) - 5;
      ctx.fillRect(x + j, GROUND_Y + 14 + (j % 3), 6, 3);
    }

    this.spawnWeather(theme, dt);
    this.drawWeather(ctx, theme, dt);

    // Combatants.
    const bob = Math.sin(this.t * 4) * 2;
    const clsColor = { warrior: '#c8492f', hunter: '#3f9d54', priest: '#e0d7b8', warlock: '#7c4fa8' }[save.classId];
    this.drawUnit(ctx, 'player', 'humanoid', clsColor, bob, 1, gearOverlays(save));
    if (enc.companion && enc.companion.hp > 0) {
      const pet = enc.companion;
      this.drawUnit(
        ctx, 'pet', pet.body || spriteKindFor(pet.name), pet.color, -bob, 1,
        companionOverlays(pet.gear)
      );
    }

    const e = enc.enemy;
    this.drawUnit(ctx, 'enemy', spriteKindFor(e.name), e.color, bob, e.boss ? 1.5 : 1);

    // Foreground silhouettes, drawn over the action for depth.
    this.drawForeground(ctx, theme);

    if (enc.enemyStun > 0) {
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd75f';
      ctx.fillText('★ stunned', ANCHORS.enemy.cx, GROUND_Y - 150);
    }

    // A target under damage-over-time smoulders: motes drift off it between ticks so
    // the effect is visible in the gaps, not just when a number pops.
    this.auraTimer -= dt;
    if (this.auraTimer <= 0 && enc.dots && enc.dots.length) {
      this.auraTimer = 0.12;
      const d = enc.dots[Math.floor(Math.random() * enc.dots.length)];
      const spell = spellFor(d.id, d.name, 'magic', 'dot');
      this.bits.push({
        x: ANCHORS.enemy.cx + (Math.random() * 40 - 20),
        y: GROUND_Y - 20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 12, vy: -22 - Math.random() * 18,
        size: 3, color: spell.core, life: 0.7, grav: -20,
      });
    }

    this.drawEffects(ctx, dt);
    this.drawFloaters(ctx, dt);
    this.drawGrade(ctx, theme);

    // The zone banner used to be drawn here. Zone and kill progress live in the top
    // bar now: two copies of the same line is one too many, and this one sat exactly
    // where a loot card lands, so each covered the other.
  }

  /**
   * One parallax band as a continuous silhouette. Layered sines give an irregular
   * ridgeline; heights are quantised to 2px so it still reads as pixel art. Uniform
   * blocks at a uniform height read as a hedge, not as distance.
   */
  drawHills(ctx, color, baseHeight, amp, freq, speed, phase) {
    if (!color) return;
    const off = this.t * speed;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-12, GROUND_Y + 8);
    for (let x = -12; x <= VW + 12; x += 3) {
      const n = Math.sin((x + off) * freq + phase)
              + Math.sin((x + off) * freq * 2.7 + phase * 1.7) * 0.45
              + Math.sin((x + off) * freq * 0.6 + phase * 0.4) * 0.7;
      const h = GROUND_Y - baseHeight - Math.round((n * amp) / 2) * 2;
      ctx.lineTo(x, h);
    }
    ctx.lineTo(VW + 12, GROUND_Y + 8);
    ctx.closePath();
    ctx.fill();
  }

  /** Tufts and rubble in front of the action, scrolling fastest for depth. */
  drawForeground(ctx, theme) {
    if (!theme.fg) return;
    ctx.fillStyle = theme.fg;
    const off = (this.t * 42) % 84;
    for (let i = -1; i < VW / 84 + 2; i++) {
      const x = i * 84 - off;
      // A tuft: three blades of differing height.
      ctx.fillRect(x, GROUND_Y + 24, 3, 12);
      ctx.fillRect(x + 4, GROUND_Y + 18, 3, 18);
      ctx.fillRect(x + 8, GROUND_Y + 26, 3, 10);
      // A low rock further along.
      ctx.fillRect(x + 46, GROUND_Y + 28, 14, 8);
      ctx.fillRect(x + 50, GROUND_Y + 24, 7, 6);
    }
    ctx.fillRect(-12, VH - 8, VW + 24, 16);
  }

  /** Colour grade plus a vignette, so the scene reads as one lit space. */
  drawGrade(ctx, theme) {
    if (theme.tint) {
      ctx.fillStyle = theme.tint;
      ctx.fillRect(-10, -10, VW + 20, VH + 20);
    }
    const v = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = v;
    ctx.fillRect(-10, -10, VW + 20, VH + 20);
  }

  drawUnit(ctx, who, kind, color, bob, scale, overlays = []) {
    const a = ANCHORS[who];
    const u = this.units[who];
    const flip = a.facing < 0;
    const body = BODIES[kind] || BODIES.humanoid;
    const cell = body.cell;

    const lungeX = a.facing * u.lunge * 5;
    const flinchX = -a.facing * u.flinch * 4;
    const sprite = getSprite(kind, color, flip, u.flash > 0.5, overlays);

    // Squash on impact: wider and shorter for a moment, pivoting on the feet.
    const sqx = 1 + u.flinch * 0.16;
    const sqy = 1 - u.flinch * 0.16;
    const w = sprite.width * scale, h = sprite.height * scale;
    // Bodies differ in size, so centre on the anchor and rest the last row of the
    // grid on the ground line rather than assuming one fixed sprite footprint.
    const baseX = a.cx - w / 2 + lungeX + flinchX;
    const baseY = GROUND_Y - (body.grid.length + MARGIN) * cell * scale + bob;

    ctx.save();
    ctx.translate(baseX + w / 2, baseY + h);
    ctx.scale(sqx, sqy);
    ctx.drawImage(sprite, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawEffects(ctx, dt) {
    for (const p of this.projectiles) {
      p.life -= dt;
      const k = 1 - Math.max(0, p.life) / p.max;
      const x = p.x + (p.tx - p.x) * k;
      const y = p.y + (p.ty - p.y) * k - Math.sin(k * Math.PI) * 16;
      const size = p.big ? 8 : 6;

      if (p.arrow) {
        // A shaft with a bright head, rather than a ball of light.
        ctx.fillStyle = p.glow;
        ctx.fillRect(x - 14, y - 1, 16, 3);
        ctx.fillStyle = p.core;
        ctx.fillRect(x - 2, y - 2, 7, 4);
      } else {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = p.glow;
        ctx.fillRect(x - size * 1.6, y - size, size * 3.2, size * 2);
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x - size, y - size / 2, size * 2, size);
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.core;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      // Trail motes so the path lingers for a frame or two.
      if (Math.random() < 0.7) {
        this.bits.push({
          x, y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
          size: 2, color: p.glow, life: 0.22, grav: 0,
        });
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);

    // Sustained channels: a thick glow with a bright core, jittering along its length.
    for (const b of this.beams) {
      b.life -= dt;
      const a = Math.max(0, b.life / b.max);
      ctx.globalAlpha = a * 0.35;
      ctx.strokeStyle = b.glow;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      for (let t = 0.1; t <= 1; t += 0.1) {
        ctx.lineTo(b.x + (b.tx - b.x) * t, b.y + (b.ty - b.y) * t + Math.sin(this.t * 26 + t * 9) * 5);
      }
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = b.core;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }
    this.beams = this.beams.filter((b) => b.life > 0);

    // Impact rings.
    for (const b of this.bursts) {
      b.life -= dt;
      const k = 1 - Math.max(0, b.life) / b.max_life;
      const r = b.r + (b.max - b.r) * k;
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.85;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }
    this.bursts = this.bursts.filter((b) => b.life > 0);

    for (const s of this.slashes) {
      s.life -= dt;
      ctx.globalAlpha = Math.max(0, s.life / 0.28);
      ctx.fillStyle = s.color;
      for (let i = 0; i < 5; i++) ctx.fillRect(s.x + i * 5, s.y + i * 5, 4, 4);
      ctx.globalAlpha = 1;
    }
    this.slashes = this.slashes.filter((s) => s.life > 0);

    // Debris and death dissolve share one simple ballistic particle.
    for (const b of this.bits) {
      b.life -= dt;
      b.vy += b.grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > GROUND_Y + 12) { b.y = GROUND_Y + 12; b.vy *= -0.3; b.vx *= 0.6; }
      ctx.globalAlpha = Math.max(0, Math.min(1, b.life * 2));
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.size, b.size);
      ctx.globalAlpha = 1;
    }
    this.bits = this.bits.filter((b) => b.life > 0);

    for (const m of this.motes) {
      m.life -= dt;
      m.y += (m.rise || -20) * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, m.life));
      ctx.fillStyle = m.color;
      ctx.fillRect(m.x, m.y, 3, 3);
      ctx.globalAlpha = 1;
    }
    this.motes = this.motes.filter((m) => m.life > 0);

    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (const c of this.casts) {
      c.life -= dt;
      c.y -= dt * 10;
      ctx.globalAlpha = Math.max(0, Math.min(1, c.life));
      ctx.fillStyle = '#000';
      ctx.fillText(c.text, c.x + 1, c.y + 1);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
      ctx.globalAlpha = 1;
    }
    this.casts = this.casts.filter((c) => c.life > 0);
  }

  drawFloaters(ctx, dt) {
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= 0.94;
      if (f.pop > 0) f.pop = Math.max(0, f.pop - dt / 0.14);

      const size = Math.round(f.size * (1 + f.pop * 0.5));
      ctx.font = `${f.crit ? 'bold ' : ''}${size}px monospace`;
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }
}
