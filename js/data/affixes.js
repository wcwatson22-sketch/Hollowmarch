// Gear: slots, rarities, and randomly rolled affixes.
// Rarity controls affix COUNT and a flat power multiplier, so an unlucky legendary
// still beats a lucky rare -- but affix choice is what actually shapes a build.

export const SLOTS = [
  { id: 'weapon',    name: 'Weapon'    },
  { id: 'head',      name: 'Head'      },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'chest',     name: 'Chest'     },
  { id: 'hands',     name: 'Hands'     },
  { id: 'legs',      name: 'Legs'      },
  { id: 'feet',      name: 'Feet'      },
  { id: 'trinket',   name: 'Trinket',   base: 'trinket' },
  // An amulet is the one slot that carries ABILITY damage rather than raw stats, so
  // there is a piece you chase specifically to make the three things you cast hit
  // harder rather than to make your character bigger.
  { id: 'neck',      name: 'Amulet',    base: 'neck'    },
];

export const RARITIES = [
  { id: 'common',    name: 'Common',    color: '#b8b8b8', affixes: 1, mult: 1.00, weight: 100 },
  { id: 'uncommon',  name: 'Uncommon',  color: '#4fc04f', affixes: 2, mult: 1.25, weight: 45  },
  { id: 'rare',      name: 'Rare',      color: '#4f8fe0', affixes: 3, mult: 1.60, weight: 16  },
  { id: 'epic',      name: 'Epic',      color: '#a35fd0', affixes: 4, mult: 2.10, weight: 4.5 },
  { id: 'legendary', name: 'Legendary', color: '#e0952f', affixes: 5, mult: 3.20, weight: 0.6 },
];

// Base item power per slot -- weapons carry the most, trinkets carry the least raw stat.
// These were all scaled by 0.9 when the shoulders slot was added, so the TOTAL budget a
// fully-geared character carries is unchanged (~7.1). Adding a slot without rescaling
// would have handed every class ~11% more power and invalidated the tuned mob curves.
export const SLOT_WEIGHT = {
  weapon: 1.44, head: 0.77, shoulders: 0.72, chest: 0.90,
  hands: 0.68, legs: 0.86, feet: 0.68,
  // A trinket pours its whole budget into ONE affix (see TRINKET_FOCUS), so its
  // weight is low while the number it produces is large.
  trinket: 0.45,
  neck: 0.52,
};

// `per` is stat gained per point of item budget. Percent stats use tiny values on purpose.
export const AFFIXES = [
  { id: 'ap',     name: 'Attack Power', stat: 'ap',     per: 0.55, min: 1, fmt: (v) => `+${Math.round(v)} Attack Power`,
    tip: 'Scales every attack and ability you use. The main damage stat for warriors and hunters.' },
  { id: 'sp',     name: 'Spell Power',  stat: 'sp',     per: 0.55, min: 1, fmt: (v) => `+${Math.round(v)} Spell Power`,
    tip: 'Scales every spell, damage-over-time and heal you cast. The main stat for priests and warlocks.' },
  { id: 'hp',     name: 'Stamina',      stat: 'hp',     per: 4.00, min: 1, fmt: (v) => `+${Math.round(v)} Health`,
    tip: 'Raises your maximum health. Between pulls you only recover a sip, so a bigger pool is what carries you through a zone.' },
  { id: 'armor',  name: 'Armor',        stat: 'armor',  per: 1.10, min: 1, fmt: (v) => `+${Math.round(v)} Armor`,
    tip: 'Reduces the damage each hit does to you. Worth less against deeper zones, so it has to keep climbing to keep up.' },
  // Crit and Haste are RATINGS on gear -- a flat number you can add up across pieces --
  // and convert to a percentage on the dashboard. A percentage printed on an item is a
  // lie the moment you gain a level, because the same +2% is worth less every time the
  // content scales; a rating is honest about that and makes two pieces comparable.
  { id: 'crit',   name: 'Crit Rating',  stat: 'critRating',  per: 1.55, min: 1, fmt: (v) => `+${Math.round(v)} Crit Rating`,
    tip: 'Chance for a hit to land for extra damage (+50% by default). Converts to a percentage that gets harder to raise the higher it already is.' },
  { id: 'haste',  name: 'Haste Rating', stat: 'hasteRating', per: 1.45, min: 1, fmt: (v) => `+${Math.round(v)} Haste Rating`,
    tip: 'Speeds up your auto-attacks, shortens every ability cooldown, and makes your damage-over-time effects tick faster.' },
  { id: 'abil',   name: 'Potency',      stat: 'abilityPct', per: 0.0042, min: 0.005, fmt: (v) => `+${(v * 100).toFixed(1)}% Ability Damage`,
    tip: 'Raises the damage of your direct ability hits. It does not touch your auto-attack or your damage-over-time ticks.', neckOnly: true },
  { id: 'petpow', name: 'Bond',         stat: 'petPow', per: 0.0060, min: 0.005, fmt: (v) => `+${(v * 100).toFixed(1)}% Companion Damage`,
    tip: 'Raises your companion damage. Only drops for a build that kept its companion.' },
];

/** Plain-language explanation of a stat, for tooltips. */
export const affixTip = (stat) => (AFFIXES.find((a) => a.stat === stat) || {}).tip || '';

// --- Enchanting -------------------------------------------------------------
// An enchant scales every affix on the item rather than adding a new one, so it
// sharpens whatever the item already was instead of blurring every piece together.
// A trinket concentrates its budget into a single stat instead of spreading it.
export const TRINKET_FOCUS = 2.2;
// Talent points granted by an equipped trinket, by rarity.
export const TRINKET_POINTS = { common: 1, uncommon: 1, rare: 2, epic: 2, legendary: 3 };

// Dying damages your gear. Each point of wear weakens every affix on the item, and
// repairing costs gold -- so death drains the same economy that buys upgrades rather
// than deleting progress outright.
export const WEAR_STEP = 0.08;
export const WEAR_MAX = 5;

export const ENCHANT_STEP = 0.12;
export const ENCHANT_MAX = 5;

const AFFIX_BY_ID = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));

/**
 * An item's affixes as they actually apply, with enchant levels folded in.
 * Everything that reads item power -- stats, scoring, comparisons, tooltips -- must
 * go through this, or an enchanted item will read as weaker than it is.
 */
export function scaledAffixes(item) {
  if (!item) return [];
  const rank = item.enchant || 0;
  const wear = Math.min(WEAR_MAX, item.wear || 0);
  if (rank === 0 && wear === 0) return item.affixes;
  const mult = (1 + ENCHANT_STEP * rank) * (1 - WEAR_STEP * wear);
  return item.affixes.map((a) => {
    const value = a.value * mult;
    const def = AFFIX_BY_ID[a.id];
    return { ...a, value, label: def ? def.fmt(value) : a.label };
  });
}

/** Gold to repair one item back to pristine. */
export function repairCost(item) {
  const wear = Math.min(WEAR_MAX, item.wear || 0);
  return wear === 0 ? 0 : Math.round(18 * Math.max(1, item.ilvl) * wear);
}

/** Gold to take an item from its current enchant level to the next. */
export function enchantCost(item) {
  const rank = item.enchant || 0;
  return Math.round(90 * Math.max(1, item.ilvl) * Math.pow(rank + 1, 1.7));
}

// Prefix/suffix naming so items read like items instead of "Rare Chest #418".
const PREFIX = {
  ap: 'Brutal', sp: 'Arcane', hp: 'Stalwart', armor: 'Ironbound',
  crit: 'Keen', haste: 'Swift', petpow: 'Kindred',
};
// Armour nouns are per armour type, so a warrior never loots a Robe and a priest never
// loots Sabatons. Every noun here has a matching silhouette in ui/gear-art.js.
const ARMOR_NOUN = {
  plate: {
    head: ['Helm', 'Barbute', 'Greathelm'],
    shoulders: ['Pauldrons', 'Spaulders'],
    chest: ['Breastplate', 'Cuirass', 'Hauberk'],
    hands: ['Gauntlets', 'Handguards'],
    legs: ['Greaves', 'Platelegs'],
    feet: ['Sabatons', 'Warboots'],
  },
  leather: {
    head: ['Cowl', 'Coif', 'Hood'],
    shoulders: ['Shoulderpads', 'Mantle'],
    chest: ['Jerkin', 'Vest', 'Tunic'],
    hands: ['Gloves', 'Grips'],
    legs: ['Leggings', 'Chaps'],
    feet: ['Boots', 'Treads'],
  },
  cloth: {
    head: ['Circlet', 'Cap', 'Crown'],
    shoulders: ['Amice', 'Shawl'],
    chest: ['Robe', 'Vestments'],
    hands: ['Mitts', 'Handwraps'],
    legs: ['Trousers', 'Skirt'],
    feet: ['Slippers', 'Sandals'],
  },
};

const SLOT_NOUN = {
  trinket: ['Idol', 'Charm', 'Sigil', 'Talisman'],
  neck: ['Amulet', 'Pendant', 'Locket', 'Torc', 'Chain'],
};

// Weapons are named per class -- a warrior looting a "Longbow" reads as a bug even
// when the stats on it are correct.
const WEAPON_NOUN = {
  warrior: ['Blade', 'Maul', 'Greatsword', 'Axe'],
  hunter: ['Longbow', 'Shortbow', 'Crossbow'],
  priest: ['Scepter', 'Prayer Rod', 'Censer'],
  warlock: ['Wand', 'Grimoire', 'Bone Staff'],
};

/** The noun an item is built from. Also drives which sprite the gear art uses. */
export function pickNoun(slotBase, rng, classId, armorType) {
  let nouns;
  if (slotBase === 'weapon') nouns = WEAPON_NOUN[classId];
  else if (armorType && ARMOR_NOUN[armorType] && ARMOR_NOUN[armorType][slotBase]) {
    nouns = ARMOR_NOUN[armorType][slotBase];
  } else nouns = SLOT_NOUN[slotBase];
  nouns = nouns && nouns.length ? nouns : ['Relic'];
  return nouns[Math.floor(rng() * nouns.length)];
}

/** Every armour noun the generator can produce, for validating the art tables. */
export const ALL_ARMOR_NOUNS = Object.values(ARMOR_NOUN)
  .flatMap((byslot) => Object.values(byslot).flat());

export function itemName(noun, rarity, topAffixId) {
  const pre = PREFIX[topAffixId] || 'Worn';
  return rarity.id === 'legendary' ? `${pre} ${noun} of the Fallen` : `${pre} ${noun}`;
}
