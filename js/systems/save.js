// localStorage save/load. The shape is versioned so a future server sync or a
// Capacitor app build can migrate it instead of wiping characters.

import { SLOTS } from '../data/affixes.js';
import { CLASSES, MAX_ACTIVE_ABILITIES } from '../data/classes.js';
import { rollDrop } from './loot.js';
import { RARITIES } from '../data/affixes.js';
import { MAX_LIVES } from '../data/mobs.js';

// Name AND art key, so the starter weapon looks like what it is called.
const STARTERS = {
  warrior: { name: 'Notched Longsword', art: 'Blade' },
  hunter:  { name: 'Frayed Shortbow',   art: 'Shortbow' },
  priest:  { name: 'Chipped Prayer Rod', art: 'Prayer Rod' },
  warlock: { name: 'Cracked Bone Wand',  art: 'Wand' },
};

const KEY = 'hollowmarch.save.v2';
// Keys this game has used before. Read-only: a character found under one of these is
// migrated to KEY on load, so renaming the game never silently eats someone's save.
const LEGACY_KEYS = ['pixelidle.save.v2'];
export const SAVE_VERSION = 2;

export function newSave(classId, name) {
  const equipped = {};
  for (const s of SLOTS) equipped[s.id] = null;

  // Start with a weapon. A character who owns nothing has no build to reason about
  // and no reason to open the gear panel, which makes the first minutes inert.
  const starter = rollDrop(classId, 1, false, { killIndex: 1 });
  if (starter) {
    starter.slot = 'weapon';
    starter.slotName = 'Weapon';
    const st = STARTERS[classId];
    if (st) { starter.name = st.name; starter.art = st.art; }
    // Force it common. The roll could come back legendary, and only the NAME was being
    // overridden -- so a fraction of new characters started with a legendary set piece
    // and a legendary power, disguised as a "Frayed Shortbow".
    const common = RARITIES[0];
    starter.rarity = common.id;
    starter.rarityColor = common.color;
    delete starter.power;
    delete starter.setId;
    delete starter.setName;
    equipped.weapon = starter;
  }

  // Only the first few start slotted; the rest are yours to choose as they unlock.
  const abilityToggles = {};
  CLASSES[classId].abilities.forEach((a, i) => { abilityToggles[a.id] = i < MAX_ACTIVE_ABILITIES; });

  return {
    version: SAVE_VERSION,
    name: name || CLASSES[classId].name,
    classId,
    level: 1,
    xp: 0,
    gold: 0,
    zone: 1,
    highestZone: 1,
    // Death returns you here. Advanced only by killing a boss.
    checkpoint: 1,
    // Clickable rewards picked out of the scene, and the vendor stock.
    embers: 0,
    // null until level 5: 'pet' keeps the companion, 'solo' trades it for power.
    petChoice: null,
    // Index into the companion's ascension ladder, and the pity counter that feeds it.
    petForm: 0,
    petAscendMisses: 0,
    // Set once the Hollow King is down; the zones continue past it.
    completed: false,
    completedAt: 0,
    lastEncounterKill: 0,
    // Consecutive deaths with no kill between them; see STALL_DEATHS.
    deathStreak: 0,
    // Run out and the character is finished. A boss kill gives one back.
    lives: MAX_LIVES,
    shop: [],
    shopZone: 0,
    mobsKilledInZone: 0,
    totalKills: 0,
    equipped,
    inventory: [],
    talents: {},
    respecCount: 0,
    abilityToggles,
    lastSeen: Date.now(),
    createdAt: Date.now(),
  };
}

export function save(state) {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Save failed', e);
  }
}

export function load() {
  try {
    let raw = localStorage.getItem(KEY);
    let migrated = false;

    if (!raw) {
      for (const old of LEGACY_KEYS) {
        raw = localStorage.getItem(old);
        if (raw) { migrated = true; break; }
      }
    }
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (data.version !== SAVE_VERSION) return null;
    // Slots added after a save was written must exist, or the gear panel and the
    // sprite compositor read undefined for them.
    for (const sl of SLOTS) if (!(sl.id in data.equipped)) data.equipped[sl.id] = null;
    // Fields added after a save was written default rather than reading undefined.
    if (typeof data.petForm !== 'number') data.petForm = 0;
    if (typeof data.lives !== 'number') data.lives = MAX_LIVES;
    if (typeof data.petAscendMisses !== 'number') data.petAscendMisses = 0;

    // An ability added after a save was written has no entry in abilityToggles, and the
    // slot test is `!== false` -- so a new ability arrives switched ON and a character
    // who had filled their three slots silently ends up carrying four or five. Anything
    // unseen is explicitly off; the player opts in.
    const known = CLASSES[data.classId];
    if (known) {
      for (const ab of known.abilities) {
        if (!(ab.id in data.abilityToggles)) data.abilityToggles[ab.id] = false;
      }
    }
    if (migrated) save(data); // re-home it under the current key
    return data;
  } catch (e) {
    console.warn('Load failed', e);
    return null;
  }
}

export function wipe() {
  localStorage.removeItem(KEY);
  for (const old of LEGACY_KEYS) localStorage.removeItem(old);
}
