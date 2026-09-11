// Legendary set pieces and the powers they carry.
//
// Legendaries are not "a rare with more affixes". Each one is a piece of its class's
// SET and carries a named POWER that changes how the class plays. Two of them turn on a
// 2-piece bonus, four turn on a 4-piece -- and both bonuses are pointed at one specific
// playstyle, so a set is something you build toward rather than something that happens
// to you.
//
// They are meant to be very rare and very strong. At a 0.6% base rarity weight you will
// see a handful in a long run, and the 4-piece is a genuine chase.

/** One set per class, aimed squarely at one of that class's three branches. */
export const SETS = {
  warrior: {
    id: 'gorewrought',
    name: 'Gorewrought',
    branch: 'Bleed',
    bonus2: { bleedDmg: 0.25 },
    bonus4: { dotCrit: 0.60, bleedDmg: 0.30 },
    desc2: 'Your bleeds deal 25% more damage.',
    desc4: 'Your bleeds deal a further 30% more, and 60% of your crit chance applies to them.',
  },
  hunter: {
    id: 'venomweave',
    name: 'Venomweave',
    branch: 'Assassin',
    bonus2: { poisonDmg: 0.25 },
    bonus4: { dotCrit: 0.60, dotDmg: 0.25 },
    desc2: 'Your poisons deal 25% more damage.',
    desc4: 'All damage-over-time effects deal 25% more, and 60% of your crit chance applies to them.',
  },
  priest: {
    id: 'vesperlight',
    name: 'Vesperlight',
    branch: 'Holy',
    bonus2: { holyDmg: 0.25 },
    bonus4: { abilityDmg: 0.22, healPow: 0.25 },
    desc2: 'Your holy damage is increased by 25%.',
    desc4: 'Your abilities hit 22% harder and you heal for 25% more.',
  },
  warlock: {
    id: 'cindersoul',
    name: 'Cindersoul',
    branch: 'Fire',
    bonus2: { fireDmg: 0.25 },
    bonus4: { fireDmg: 0.30, critDmg: 0.35 },
    desc2: 'Your fire damage is increased by 25%.',
    desc4: 'Your fire damage is increased by a further 30%, and your critical strikes hit 35% harder.',
  },
};

/**
 * Powers a legendary can roll. Each is a real behaviour change rather than a number --
 * that is the whole point of a legendary over a very good epic.
 *
 *   mods    -- folded into the same bag talents use, so no new plumbing
 *   hook    -- read by combat.js: 'echo' | 'critHeal' | 'lastStand' | 'quicken'
 */
export const POWERS = {
  echo: {
    id: 'echo',
    name: 'Echoing',
    hook: 'echo',
    value: 0.16,
    desc: 'Your ability hits have a 16% chance to strike a second time for 60% damage.',
  },
  critheal: {
    id: 'critheal',
    name: 'Bloodbound',
    hook: 'critHeal',
    value: 0.015,
    // Once every two seconds, not once per crit. At 3.5% per crit with no cooldown this
    // was an unconditional sustain engine: a capped character crits most of the time and
    // has a huge health pool, so it healed 46,802 over a 147-second fight with no heals
    // slotted -- almost exactly the damage taken. It beat the final boss at 100% health.
    icd: 2,
    desc: 'Your critical strikes heal you for 1.5% of your maximum health, at most once every 2s.',
  },
  laststand: {
    id: 'laststand',
    name: 'Cornered',
    hook: 'lastStand',
    value: 0.35,
    desc: 'While below 35% health, you deal 35% more damage.',
  },
  quicken: {
    id: 'quicken',
    name: 'Unravelling',
    hook: 'quicken',
    value: 0.25,
    desc: 'Your damage-over-time effects tick 25% faster.',
  },
  savagery: {
    id: 'savagery',
    name: 'Savage',
    mods: { critDmg: 0.30 },
    desc: 'Your critical strikes deal 30% more damage.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Unyielding',
    mods: { hpPct: 0.14, armorPct: 0.16 },
    desc: 'You gain 14% maximum health and 16% armor.',
  },
};

const POWER_IDS = Object.keys(POWERS);

/** Pick a power for a legendary. Separate from the affix roll so it is always present. */
export const rollPower = (rng) => POWER_IDS[Math.floor(rng() * POWER_IDS.length)];

/** Equipped legendary set pieces, and the bonuses they currently grant. */
export function setStateFor(save) {
  const set = SETS[save.classId];
  if (!set) return { set: null, count: 0, mods: {}, active: [] };

  let count = 0;
  for (const item of Object.values(save.equipped || {})) {
    if (item && item.setId === set.id) count++;
  }

  const mods = {};
  const active = [];
  const add = (bag) => { for (const [k, v] of Object.entries(bag)) mods[k] = (mods[k] || 0) + v; };
  if (count >= 2) { add(set.bonus2); active.push({ pieces: 2, desc: set.desc2 }); }
  if (count >= 4) { add(set.bonus4); active.push({ pieces: 4, desc: set.desc4 }); }
  return { set, count, mods, active };
}

/** Powers currently active, from equipped legendaries. Duplicates do not stack. */
export function powersFor(save) {
  const seen = new Map();
  for (const item of Object.values(save.equipped || {})) {
    if (item?.power && POWERS[item.power]) seen.set(item.power, POWERS[item.power]);
  }
  return [...seen.values()];
}
