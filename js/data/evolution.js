// Companion ascension.
//
// A pet build's long chase. An ascension is never bought, never crafted and never
// guaranteed: it drops. When it lands, the thing walking beside you is replaced by a
// bigger, meaner version of itself -- a different SILHOUETTE, not a recolour -- and it
// keeps that form permanently.
//
// Why it works this way:
//   * It is the one reward in the game that only a pet build can receive, which is what
//     makes choosing "keep the companion" at level 5 feel like a bet rather than a tax.
//   * Bosses carry most of the chance, so the ascension is tied to the set-pieces. Trash
//     carries a sliver of it, because an out-of-nowhere ascension mid-pull is the moment
//     people tell each other about.
//   * The boss chance climbs with every boss that fails to produce one. It still feels
//     lucky, but a run cannot dead-end on it forever.

/**
 * The ladder for each companion class, in order. Index 0 is what you start with.
 *
 *   body    -- grid from bodies.js; this is what actually sells the upgrade
 *   minZone -- the earliest zone this form can drop, so an apex form cannot land at zone 2
 *   luck    -- multiplier on the drop chance. The first rung is the one that gives a
 *              pet build its identity, so it is merely rare; the apex is a trophy.
 *   hp/ap/armor/swing -- multipliers applied on top of the class's base companion
 *   gear    -- optional armour overlays, used to re-dress the priest's humanoid companion
 */
export const FORMS = {
  hunter: [
    { name: 'Wolf', body: 'wolf', color: '#8a8f98', hp: 1, ap: 1, armor: 1, swing: 1, minZone: 0 },
    {
      name: 'Dire Wolf', body: 'direwolf', color: '#6b6257',
      hp: 1.40, ap: 1.22, armor: 1.35, swing: 0.96, minZone: 8, luck: 2.2,
      flavor: 'The wolf comes back from the treeline half again the size it went in.',
    },
    {
      name: 'Ashfang', body: 'direwolf', color: '#33373f',
      hp: 1.85, ap: 1.45, armor: 1.70, swing: 0.92, minZone: 25, luck: 1,
      flavor: 'Its coat has gone the colour of cold ash, and nothing in the zone will look at it.',
    },
  ],
  warlock: [
    { name: 'Imp', body: 'imp', color: '#b0453f', hp: 1, ap: 1, armor: 1, swing: 1, minZone: 0 },
    {
      name: 'Voidfiend', body: 'demon', color: '#7a3ba0',
      hp: 1.40, ap: 1.22, armor: 1.35, swing: 0.96, minZone: 8, luck: 2.2,
      flavor: 'The imp folds inward and something with a wingspan unfolds in its place.',
    },
    {
      name: 'Dreadlord', body: 'demon', color: '#3d2352',
      hp: 1.85, ap: 1.45, armor: 1.70, swing: 0.92, minZone: 25, luck: 1,
      flavor: 'It stops answering to the name you gave it.',
    },
  ],
  priest: [
    { name: 'Mercenary', body: 'humanoid', color: '#9a7b4f', hp: 1, ap: 1, armor: 1, swing: 1, minZone: 0 },
    {
      name: 'Vanguard', body: 'humanoid', color: '#7c8592',
      hp: 1.40, ap: 1.22, armor: 1.35, swing: 0.96, minZone: 8, luck: 2.2,
      // The sellsword finally buys plate. Reusing the gear art is what makes the
      // humanoid companion read as a different unit without a second body grid.
      gear: [
        { slot: 'chest', art: 'Cuirass', rarity: 'rare' },
        { slot: 'head', art: 'Helm', rarity: 'rare' },
        { slot: 'shoulders', art: 'Pauldrons', rarity: 'rare' },
      ],
      flavor: 'The sellsword spends every coin you paid them on plate.',
    },
    {
      name: 'Champion', body: 'humanoid', color: '#5b6474',
      hp: 1.85, ap: 1.45, armor: 1.70, swing: 0.92, minZone: 25, luck: 1,
      gear: [
        { slot: 'chest', art: 'Breastplate', rarity: 'legendary' },
        { slot: 'head', art: 'Greathelm', rarity: 'legendary' },
        { slot: 'shoulders', art: 'Spaulders', rarity: 'legendary' },
      ],
      flavor: 'They no longer fight for the wage.',
    },
  ],
};

/** Chance a boss carries an ascension, before the pity ramp. */
export const ASCEND_BOSS_BASE = 0.10;
/** Added to the boss chance for every boss since the last ascension. */
export const ASCEND_BOSS_STEP = 0.04;
/** Ceiling on the ramp, so it never becomes a certainty you can plan around. */
export const ASCEND_BOSS_CAP = 0.60;
/** Chance any ordinary kill produces one. Deliberately tiny. */
export const ASCEND_MOB = 0.0012;

/** The chance the next boss carries an ascension, given the pity counter so far. */
export function bossChance(save, next) {
  if (!next) return 0;
  const misses = save.petAscendMisses || 0;
  return Math.min(ASCEND_BOSS_CAP, (ASCEND_BOSS_BASE + ASCEND_BOSS_STEP * misses) * (next.luck || 1));
}

/** The ladder for this save, or an empty list for classes and builds with no companion. */
export function formsFor(save) {
  if (!save || save.petChoice === 'solo') return [];
  return FORMS[save.classId] || [];
}

/** The form the companion is currently in. */
export function currentForm(save) {
  const forms = formsFor(save);
  if (forms.length === 0) return null;
  return forms[Math.min(save.petForm || 0, forms.length - 1)];
}

/** The next form up, if there is one and the zone is deep enough to have reached it. */
export function nextForm(save) {
  const forms = formsFor(save);
  const next = forms[(save.petForm || 0) + 1];
  return next || null;
}

/**
 * Roll for an ascension on a kill. Returns the form gained, or null.
 * Mutates the pity counter on the save; the caller applies the form.
 */
export function rollAscension(save, boss, rng = Math.random) {
  const next = nextForm(save);
  if (!next) return null;
  // Gate on the deepest zone reached rather than the current one, so being knocked
  // back to a checkpoint does not also revoke the chance you had already earned.
  if (Math.max(save.highestZone || 1, save.zone || 1) < next.minZone) return null;

  const luck = next.luck || 1;
  if (!boss) return rng() < ASCEND_MOB * luck ? next : null;

  const misses = save.petAscendMisses || 0;
  const chance = bossChance(save, next);
  if (rng() < chance) return next;
  save.petAscendMisses = misses + 1;
  return null;
}

/** Apply a gained form. Kept here so the save shape is only written in one place. */
export function applyAscension(save) {
  save.petForm = (save.petForm || 0) + 1;
  save.petAscendMisses = 0;
}
