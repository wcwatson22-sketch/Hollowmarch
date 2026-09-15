// Loot generation. Gear only ever drops from kills you are present for.

import { SLOTS, RARITIES, SLOT_WEIGHT, AFFIXES, itemName, pickNoun, scaledAffixes, TRINKET_FOCUS, TRINKET_POINTS } from '../data/affixes.js';
import { CLASSES } from '../data/classes.js';
import { TALENTS, isPetTalent } from '../data/talents.js';
import { SETS, rollPower } from '../data/sets.js';

// Injectable so the balance tools can measure with reproducible gear rolls. Random
// gear is by far the largest source of variance between simulated runs, and a solver
// fed noisy measurements chases the noise instead of the signal.
let rng = Math.random;
export function setLootRng(fn) { rng = fn || Math.random; }

/**
 * Depth multiplier on the top two rarities.
 *
 * At the flat weights a legendary was roughly one drop in 2,200 -- which reads as
 * "very rare" until you notice a four-piece set needs four of them, at which point the
 * chase is not hard, it is arithmetically out of reach. Scaling with zone keeps them
 * genuinely rare early and makes assembling a set the thing the last stretch of the
 * game is FOR.
 */
const depthLuck = (zone) => 1 + Math.pow(Math.max(0, zone - 8) / 12, 1.45);

function pickRarity(luckMult = 1, zone = 1) {
  // Weights bias toward common; luckMult tilts the tail without touching common.
  const deep = depthLuck(zone);
  const pool = RARITIES.map((r) => ({
    r,
    w: r.id === 'common' ? r.weight
      : r.weight * luckMult * (r.id === 'legendary' || r.id === 'epic' ? deep : 1),
  }));
  const total = pool.reduce((a, b) => a + b.w, 0);
  let roll = rng() * total;
  for (const p of pool) { roll -= p.w; if (roll <= 0) return p.r; }
  return RARITIES[0];
}

/** Class-appropriate affix pool: melee classes never roll Spell Power, and vice versa. */
function affixPool(classId, solo, slotBase) {
  const cls = CLASSES[classId];
  const wrongPower = cls.primary === 'sp' ? 'ap' : 'sp';
  return AFFIXES.filter((a) => {
    if (a.id === wrongPower) return false;
    // Bond is dead weight without a companion, so it never rolls for one.
    if (a.id === 'petpow' && (!cls.companion || solo)) return false;
    // Potency is the amulet's reason to exist; it must not dilute every other slot.
    if (a.neckOnly && slotBase !== 'neck') return false;
    return true;
  });
}

/**
 * @param zone  the zone the kill happened in (drives item level)
 * @param boss  bosses always drop, and drop better
 */
// The opening minutes are judged on whether anything happens at all, so the first few
// kills are far more generous than the steady-state rate. This tapers off quickly and
// does not touch the long-run drop economy.
const EARLY_KILLS = 12;
const EARLY_DROP_CHANCE = 0.55;
const BASE_DROP_CHANCE = 0.11;

export function earlyDropChance(killIndex) {
  if (killIndex <= 1) return 1;                      // first kill always drops
  if (killIndex > EARLY_KILLS) return BASE_DROP_CHANCE;
  const k = (killIndex - 1) / (EARLY_KILLS - 1);     // 0 -> 1 across the early window
  return EARLY_DROP_CHANCE + (BASE_DROP_CHANCE - EARLY_DROP_CHANCE) * k;
}

/**
 * @param zone      the zone the kill happened in (drives item level)
 * @param boss      bosses always drop, and drop better
 * @param killIndex 1-based lifetime kill number, used only for the early-game boost
 */
/**
 * Set pieces do not drop before this. A legendary is a set piece, and a set is a chase
 * that wants a character capable of having one -- handing a level 4 a piece of a
 * four-item set it will not complete for another forty levels is a tease, not a reward.
 * Below it a legendary roll becomes an epic, which is still the best thing in the zone.
 */
export const SET_MIN_LEVEL = 15;

export function rollDrop(classId, zone, boss, { killIndex = Infinity, solo = false, level = null } = {}) {
  const cls = CLASSES[classId];
  const dropChance = boss ? 1.0 : earlyDropChance(killIndex);
  if (!boss && rng() > dropChance) return null;

  // Tools and encounters that do not track a character use the level the zone implies.
  const charLevel = level ?? Math.max(1, Math.round(zone / 1.4));

  // A boss is a set-piece you spent a zone reaching; handing back a grey is an
  // anticlimax the rest of the fight cannot pay for. Rare is the floor.
  let rarity = pickRarity(boss ? 5.0 : 1, zone);
  if (rarity.id === 'legendary' && charLevel < SET_MIN_LEVEL) {
    rarity = RARITIES[RARITIES.findIndex((r) => r.id === 'legendary') - 1];
  }
  if (boss) {
    const floorIdx = RARITIES.findIndex((r) => r.id === 'rare');
    const gotIdx = RARITIES.findIndex((r) => r.id === rarity.id);
    if (gotIdx < floorIdx) rarity = RARITIES[floorIdx];
  }
  const slot = SLOTS[Math.floor(rng() * SLOTS.length)];
  const slotBase = slot.base || slot.id;

  // Item level drifts +/- 2 around the zone so upgrades aren't perfectly monotonic.
  const ilvl = Math.max(1, zone + (boss ? 3 : 0) + Math.floor(rng() * 5) - 2);
  // Item budget grows with item level to the power of 1.5 rather than linearly.
  //
  // A linear budget is enormous at the bottom and merely large at the top: an item
  // level 3 weapon rolled +104 Health against a base pool of 130, so a single common
  // drop nearly doubled a new character. Meanwhile the same curve had gear supplying
  // over 90% of a capped character's health, which is why every number in the game
  // felt like it arrived at once. The exponent keeps the top of the curve almost
  // exactly where it was (ilvl 96 is ~90% of the old budget) and cuts the bottom hard
  // (ilvl 3 is ~16%), so early upgrades are increments rather than transformations.
  let budget = 0.55 * Math.pow(ilvl, 1.5) * SLOT_WEIGHT[slotBase] * rarity.mult;

  const pool = affixPool(classId, solo, slotBase).slice();
  // A trinket is not a stat stick: it grants talent points and dumps its entire budget
  // into a single stat, so equipping one is a build decision rather than an upgrade
  // check. Every other slot rolls the usual spread.
  const isTrinket = slotBase === 'trinket';
  const count = isTrinket ? 1 : Math.min(rarity.affixes, pool.length);
  const chosen = [];
  for (let i = 0; i < count; i++) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }

  // Roll FEWER, bigger affixes rather than more empty ones. Rarity decides how many
  // affixes an item wants, but at low item level the budget cannot fill that many and
  // every share rounds away -- an uncommon at item level 2 was showing "+0 Crit Rating,
  // +0 Armor". Drop affixes until the ones that remain are each worth something.
  if (!isTrinket) {
    while (chosen.length > 1) {
      const evenShare = budget / chosen.length;
      if (chosen.every((a) => evenShare * a.per >= (a.min ?? 1))) break;
      pool.push(chosen.pop());
    }
  }

  if (slotBase === 'trinket') budget *= TRINKET_FOCUS;

  // A trinket empowers one specific talent rather than handing out loose points, so
  // finding one is a reason to build around it instead of a generic upgrade.
  let trinketGrant = {};
  if (slotBase === 'trinket') {
    const tree = (TALENTS[classId] || []).filter((t) => !(solo && isPetTalent(t)));
    const pick = tree[Math.floor(rng() * tree.length)];
    if (pick) {
      trinketGrant = {
        talentId: pick.id,
        talentName: pick.name,
        talentRanks: TRINKET_POINTS[rarity.id] || 1,
      };
    }
  }

  // Split the budget unevenly so one affix reads as the item's identity.
  const shares = chosen.map(() => 0.5 + rng());
  const shareSum = shares.reduce((a, b) => a + b, 0);

  const affixes = chosen.map((a, i) => {
    const portion = budget * (shares[i] / shareSum);
    // Uneven shares mean one affix can still land under its floor even after the count
    // has been trimmed, so clamp. Slightly over-delivering on a level 1 item is fine;
    // printing a zero is not.
    const value = Math.max(a.min ?? 1, portion * a.per);
    return { id: a.id, stat: a.stat, value, label: a.fmt(value) };
  });

  const noun = pickNoun(slotBase, rng, classId, cls.armorType);
  const topIdx = shares.indexOf(Math.max(...shares));
  return {
    uid: `${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`,
    name: itemName(noun, rarity, chosen[topIdx].id),
    // The noun doubles as the sprite key, so the art always matches the name.
    art: noun,
    slot: slot.id,
    slotName: slot.name,
    rarity: rarity.id,
    rarityColor: rarity.color,
    // Legendaries are set pieces with a named power, not just five-affix rares.
    ...(rarity.id === 'legendary' && SETS[classId]
      ? { setId: SETS[classId].id, setName: SETS[classId].name, power: rollPower(rng) }
      : {}),
    ilvl,
    affixes,
    ...trinketGrant,
  };
}

/**
 * Promote an item one rarity step, in place.
 *
 * This is what a boss pays out. Scaling the affixes a piece already has makes it more of
 * what it was; raising its rarity changes what it IS -- every existing affix is rebudgeted
 * at the higher multiplier AND the piece gains a slot for a new one. A rare with three
 * affixes becoming an epic with four is a meaningful step in a way that "+12% to each"
 * never is, which is the point of killing the thing.
 *
 * Returns the new rarity, or null if the piece is already legendary.
 */
export function upgradeRarity(item, classId, solo = false) {
  if (!item) return null;
  const idx = RARITIES.findIndex((r) => r.id === item.rarity);
  if (idx < 0 || idx >= RARITIES.length - 1) return null;
  const from = RARITIES[idx];
  const to = RARITIES[idx + 1];

  // Every affix is rebudgeted at the new rarity's multiplier.
  const scale = to.mult / from.mult;
  const affixes = item.affixes.map((a) => {
    const def = AFFIXES.find((d) => d.id === a.id);
    const value = a.value * scale;
    return { ...a, value, label: def ? def.fmt(value) : a.label };
  });

  // ...and the piece gains an affix if the new rarity carries more. Trinkets are a single
  // focused stat by design, so they only ever get the rescale.
  const isTrinket = item.slot === 'trinket';
  if (!isTrinket && affixes.length < to.affixes) {
    const taken = new Set(affixes.map((a) => a.id));
    const slotBase = item.slot === 'ring2' ? 'ring' : item.slot;
    const pool = affixPool(classId, solo, slotBase).filter((a) => !taken.has(a.id));
    if (pool.length) {
      const def = pool[Math.floor(rng() * pool.length)];
      const share = 0.55 * Math.pow(item.ilvl, 1.5) * SLOT_WEIGHT[item.slot === 'ring2' ? 'ring' : item.slot] * to.mult / to.affixes;
      const value = Math.max(def.min ?? 1, share * def.per);
      affixes.push({ id: def.id, stat: def.stat, value, label: def.fmt(value) });
    }
  }

  item.affixes = affixes;
  item.rarity = to.id;
  item.rarityColor = to.color;
  item.name = itemName(item.art, to, affixes[0].id);
  // A promotion INTO legendary makes it a set piece with a power, like a dropped one.
  if (to.id === 'legendary' && SETS[classId] && !item.setId) {
    item.setId = SETS[classId].id;
    item.setName = SETS[classId].name;
    item.power = rollPower(rng);
  }
  return to;
}

/** Rough single number for comparing two items in the same slot. */
export function itemScore(item) {
  if (!item) return 0;
  const W = { ap: 1, sp: 1, hp: 0.12, armor: 0.4, crit: 380, haste: 380, petPow: 260 };
  const stats = scaledAffixes(item).reduce((sum, a) => sum + a.value * (W[a.stat] || 1), 0);
  // Talent points are the point of a trinket, so they have to count toward its score
  // or every comparison would call a 3-point legendary a downgrade.
  // Granted talent ranks are most of a trinket’s value.
  return stats + (item.talentRanks || 0) * 420;
}
