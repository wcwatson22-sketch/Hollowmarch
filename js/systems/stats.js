// Derives the character's effective stats from class + level + equipped gear + talents.
// Everything else in the game reads from computeStats(); nothing caches its own copy.

import { CLASSES, MAX_ACTIVE_ABILITIES } from '../data/classes.js';
import { scaledAffixes } from '../data/affixes.js';
import { talentMods, abilityMods, resolveRanks } from '../data/talents.js';
import { currentForm } from '../data/evolution.js';

import { setStateFor, powersFor } from '../data/sets.js';

// Embers: the reward for actually being at the screen, since there is no idle play.
//
// They used to be a flat 0.01% each, which meant 36 collected embers -- most of an
// hour's attention -- came to +0.36%, i.e. nothing you could feel. They are now worth
// enough to notice immediately and they follow a DIMINISHING curve rather than a flat
// rate, because at roughly one ember every 26 seconds a linear bonus would run away
// into the hundreds of percent over a long session. This way the tenth ember is worth
// far more than the three-hundredth, but the three-hundredth is still worth something.
//
// The curve reaches further than it used to because levelling now stops at 60: past the
// cap, embers and gear are the only things still moving, so the long tail has to be
// worth walking.
// One per cent each, twenty-five of them, and then they stop coming.
//
// This was a diminishing curve asymptotic to +45%, which sounds generous and felt like
// nothing: the first ember was worth +0.41%, so collecting one moved 14 spell power to
// 14.06 and the number on screen did not change. A reward you cannot see is not a
// reward. Flat and small beats curved and invisible -- and a finite count means the
// scene stops being littered with them once you have them all.
export const EMBER_PER = 0.01;    // each ember: +1%
export const EMBER_COUNT = 25;    // ...and there are only ever this many
export const EMBER_MAX = EMBER_PER * EMBER_COUNT;   // +25% at the end of it

/** Total multiplier bonus from embers collected. */
export function emberBonus(count) {
  return Math.min(EMBER_MAX, EMBER_PER * Math.max(0, count || 0));
}

/** What the NEXT ember is worth right now: a flat 1%, or nothing once they are done. */
export function emberStep(count) {
  return (count || 0) >= EMBER_COUNT ? 0 : EMBER_PER;
}

// --- rating conversion -------------------------------------------------------------
//
//   pct = CAP * (1 - exp(-rating / K))
//
// Near-linear while your rating is small and flattening hard as it approaches the cap,
// so the first 10% is cheap and the last 10% is a build you had to construct.
//
// This replaced a hyperbolic curve (R / (R + K), K scaling with level) that was wrong
// in a way measuring caught immediately: it SATURATED at low rating, so a level 5
// character already sat at 32.8% crit and 26.7% haste, and the whole run from level 5
// to 60 moved crit only from 33% to 47%. Percentages were effectively decided at
// character creation. Run tools/ratings.mjs after touching any of these three numbers.
//
// The divisor scales with level rather than being a constant. With a fixed K the whole
// span from level 5 to 60 had to be carried by rating growth alone, and rating grows 38x
// over that span -- so the early game sat at 4% crit and 1.6% haste, which is close
// enough to zero that a crit or haste affix was never worth taking over raw power. Any
// single exponential that makes 40 rating meaningful also pins 4600 rating to the cap.
//
// K = K0 * level^p lets both ends be right: a crit affix is worth something the level it
// drops, and the percentages still climb the whole way rather than being decided at
// character creation. (The curve this replaced was hyperbolic with K scaling by level,
// which saturated instead -- a level 5 character sat at 32.8% crit. The exponential is
// what makes level-scaling safe here.)
//
// Fitted to these breakpoints -- run tools/ratings.mjs after touching any of them:
//   level  5, typical gear   -> ~10% crit,  ~6% haste
//   level 20, typical gear   -> ~23% crit, ~15% haste
//   level 60, typical gear   -> ~56% crit, ~42% haste
//   level 60, best-in-slot   -> ~80% crit, ~55% haste
// 50% haste and 75%+ crit remain endgame builds, not mid-game defaults.
export const CRIT_CAP = 0.85;
export const HASTE_CAP = 0.62;
const CRIT_K0 = 174, CRIT_P = 0.619;
const HASTE_K0 = 176, HASTE_P = 0.610;
const K_FOR = (cap, level) => (cap === HASTE_CAP
  ? HASTE_K0 * Math.pow(Math.max(1, level || 1), HASTE_P)
  : CRIT_K0 * Math.pow(Math.max(1, level || 1), CRIT_P));

export function ratingToPct(rating, level, cap) {
  return cap * (1 - Math.exp(-Math.max(0, rating || 0) / K_FOR(cap, level)));
}

/** Rating needed for a given percentage -- used by the tooltips to say what is next. */
export function pctToRating(pct, level, cap) {
  const frac = Math.min(0.999, Math.max(0, pct) / cap);
  return Math.round(-K_FOR(cap, level) * Math.log(1 - frac));
}
/** A companion class that chose to go alone at level 5. */
export const isSolo = (save) => save.petChoice === 'solo';

export function computeStats(save) {
  const cls = CLASSES[save.classId];
  const lvl = save.level;

  const s = {
    hp: cls.base.hp + cls.growth.hp * (lvl - 1),
    ap: cls.base.ap + cls.growth.ap * (lvl - 1),
    sp: cls.base.sp + cls.growth.sp * (lvl - 1),
    armor: cls.base.armor + cls.growth.armor * (lvl - 1),
    // Baseline percentages, before any rating from gear.
    baseCrit: cls.base.crit + cls.growth.crit * (lvl - 1),
    baseHaste: cls.base.haste + cls.growth.haste * (lvl - 1),
    critRating: 0,
    hasteRating: 0,
    petPow: 0,
    petHaste: 0,
    abilityPct: 0,
    critDmg: 1.85,
    // Share of your crit chance that applies to damage-over-time ticks. Zero until a
    // talent grants it: see the DoT crit talents in talents.js.
    dotCrit: 0,
  };

  // Going alone trades the companion for personal power.
  if (isSolo(save) && cls.soloBonus) {
    s.ap *= 1 + cls.soloBonus;
    s.sp *= 1 + cls.soloBonus;
    s.hp *= 1 + (cls.soloHp || 0);
  }

  // Gear: flat affix values, with enchant levels folded in.
  for (const item of Object.values(save.equipped)) {
    if (!item) continue;
    for (const a of scaledAffixes(item)) s[a.stat] = (s[a.stat] || 0) + a.value;
  }

  // Talents: percentage modifiers applied after gear.
  const ranks = resolveRanks(save);
  const m = talentMods(save.classId, ranks, { solo: isSolo(save) });

  // Set bonuses and legendary powers add into the same modifier bag as talents, so
  // every downstream consumer picks them up without knowing they exist.
  const setState = setStateFor(save);
  for (const [k, v] of Object.entries(setState.mods)) m[k] = (m[k] || 0) + v;
  s.setCount = setState.count;
  s.setActive = setState.active;
  s.setName = setState.set ? setState.set.name : '';

  s.powers = powersFor(save);
  for (const p of s.powers) {
    if (!p.mods) continue;
    for (const [k, v] of Object.entries(p.mods)) m[k] = (m[k] || 0) + v;
  }
  // Behavioural hooks, read by combat.js.
  s.hooks = {};
  s.hookIcd = {};
  for (const p of s.powers) {
    if (!p.hook) continue;
    s.hooks[p.hook] = p.value;
    if (p.icd) s.hookIcd[p.hook] = p.icd;
  }
  if (m.crit) s.baseCrit += m.crit;
  if (m.haste) s.baseHaste += m.haste;
  if (m.dotCrit) s.dotCrit += m.dotCrit;
  if (m.petPow) s.petPow += m.petPow;
  if (m.critDmg) s.critDmg += m.critDmg;
  if (m.sp) s.sp *= 1 + m.sp;
  if (m.hpPct) s.hp *= 1 + m.hpPct;
  if (m.armorPct) s.armor *= 1 + m.armorPct;

  // Per-damage-type bonuses. This is what lets a class have real branches: a Fire
  // warlock and a Shadow warlock spend their points on different multipliers rather
  // than on slightly different amounts of the same one.
  s.typeDmg = {
    physical: 1 + (m.physicalDmg || 0),
    bleed:    1 + (m.bleedDmg || 0),
    fire:     1 + (m.fireDmg || 0),
    poison:   1 + (m.poisonDmg || 0),
    shadow:   1 + (m.shadowDmg || 0),
    holy:     1 + (m.holyDmg || 0),
    arcane:   1 + (m.arcaneDmg || 0),
  };

  // Damage reflected back at whatever hit you, as a share of your Attack/Spell Power.
  s.thorns = m.thorns || 0;

  s.dotDmg = 1 + (m.dotDmg || 0);
  // Ability damage from talents AND from Potency on an amulet.
  s.abilityDmg = 1 + (m.abilityDmg || 0) + (s.abilityPct || 0);
  s.healPow = 1 + (m.healPow || 0);
  // Share of every heal that is also dealt to the enemy. See the Atonement talent.
  s.atonement = m.atonement || 0;
  s.petHp = 1 + (m.petHp || 0);
  s.petArmor = 1 + (m.petArmor || 0);
  s.petHaste = 1 + (m.petHaste || 0);

  // Tier-2 talents: per-ability potency / cooldown / duration overrides.
  s.abilityMods = abilityMods(save.classId, ranks);

  // Embers: a permanent bonus to everything, earned by clicking them out of the scene.
  const ember = 1 + emberBonus(save.embers || 0);
  // Deliberately NOT critRating or hasteRating. Multiplying a rating compounds with the
  // conversion curve and pushed a capped character to 84-85% crit -- the hard cap --
  // when the gear curve alone was fitted to reach 75%. Embers make you bigger; they do
  // not raise the ceiling on your percentages.
  for (const k of ['ap', 'sp', 'armor', 'petPow']) s[k] *= ember;
  s.hp *= ember;

  // Per-class survivability knob, solved by tools/tune.mjs alongside dmgMult.
  s.hp *= cls.defMult;

  // Ratings resolve to percentages last, so every source of rating shares one curve.
  s.crit = Math.min(0.95, s.baseCrit + ratingToPct(s.critRating, lvl, CRIT_CAP));
  s.haste = s.baseHaste + ratingToPct(s.hasteRating, lvl, HASTE_CAP);
  s.dotCrit = Math.min(1, s.dotCrit);

  s.hp = Math.round(s.hp);
  s.maxHp = s.hp;
  s.swingTime = cls.swingTime / (1 + s.haste);
  s.power = cls.primary === 'sp' ? s.sp : s.ap;
  return s;
}

/**
 * Companion stats scale off the owner, then take companion-specific talent mods.
 *
 * The companion also ramps in with owner level. At level 1 a pet contributing its full
 * share dwarfs everything else the character does, which made pet classes run away with
 * the early game; by level 12 it is at full strength.
 */
export const petRamp = (level) => 0.55 + 0.45 * Math.min(1, (level - 1) / 11);

export function computeCompanion(save, stats) {
  const cfg = CLASSES[save.classId].companion;
  if (!cfg || isSolo(save)) return null;
  const ramp = petRamp(save.level);
  // An ascension multiplies the class's base companion rather than replacing it, so
  // every pet talent and Bond affix you already own scales up with the new form.
  const form = currentForm(save) || { hp: 1, ap: 1, armor: 1, swing: 1 };
  const maxHp = Math.round(stats.maxHp * cfg.hpMult * stats.petHp * ramp * form.hp);
  return {
    name: form.name || cfg.name,
    color: form.color || cfg.color,
    // Drawing data, so the renderer never has to guess the species from the name.
    body: form.body || null,
    gear: form.gear || null,
    formIndex: save.petForm || 0,
    maxHp,
    hp: maxHp,
    ap: stats.power * cfg.apMult * (1 + stats.petPow) * ramp * form.ap,
    armor: stats.armor * cfg.armorMult * stats.petArmor * form.armor,
    swingTime: cfg.swingTime * form.swing / Math.max(0.2, stats.petHaste || 1),
  };
}

/**
 * Analytical DPS estimate for the build as currently equipped and slotted.
 *
 * This exists so "upgrade" can stop being a guess. The old verdict compared a flat
 * item score, which cheerfully told a damage-over-time build that a crit ring was a
 * sidegrade and a stamina helm was an upgrade. Here every stat is valued by what it
 * does to the damage THIS character actually deals: the three abilities it has slotted,
 * its own crit and haste, its damage-type bonuses, and its companion.
 *
 * It is an estimate, not a simulation -- no cooldown collisions, no execute phases --
 * but it is the right SHAPE, which is all a comparison needs.
 */
export function estimateDps(save) {
  const st = computeStats(save);
  const cls = CLASSES[save.classId];

  const critMult = 1 + st.crit * (st.critDmg - 1);
  const dotCritMult = 1 + st.crit * st.dotCrit * (st.critDmg - 1);
  const type = (a) => st.typeDmg[a.type] || 1;

  // Auto-attack: continuous, and the only thing haste touched before.
  let dps = (st.power * cls.autoCoef * critMult) / Math.max(0.1, st.swingTime);

  const slotted = cls.abilities
    .filter((a) => save.level >= a.unlock && save.abilityToggles?.[a.id] !== false)
    .slice(0, MAX_ACTIVE_ABILITIES);

  for (const base of slotted) {
    const a = base.solo && isSolo(save) ? { ...base, ...base.solo } : base;
    const mods = st.abilityMods[base.id] || {};
    const potency = 1 + (mods.potency || 0);
    const cd = Math.max(1, (a.cd || 1) * (1 - Math.min(0.6, mods.cdr || 0)) / (1 + st.haste));
    const p = st.power * type(a) * potency;

    switch (a.kind) {
      case 'nuke':
        dps += (p * a.coef * st.abilityDmg * critMult) / cd; break;
      case 'stun':
        dps += (p * a.coef * st.abilityDmg * critMult) / cd; break;
      case 'drain':
        dps += (p * a.coef * st.abilityDmg * critMult) / cd; break;
      case 'execute':
        // Weighted toward the ordinary hit: most of a fight is not the execute window.
        dps += (p * (a.coef * 0.75 + a.executeCoef * 0.25) * st.abilityDmg * critMult) / cd; break;
      case 'dot': {
        const burst = a.burst ? p * a.burst * st.abilityDmg * critMult : 0;
        const ticks = (a.ticks || 0) + (mods.ticks || 0);
        dps += (burst + p * a.coef * ticks * st.dotDmg * dotCritMult) / cd;
        break;
      }
      default: break; // heals and buffs are not damage
    }
  }

  // The companion, if there is one.
  const comp = computeCompanion(save, st);
  if (comp) dps += (comp.ap * critMult) / Math.max(0.1, comp.swingTime);

  return dps * cls.dmgMult;
}

/** Standard mitigation curve: armor is worth less against higher-level content. */
export function mitigate(damage, armor, attackerZone) {
  // A tighter constant makes armour matter more, which is what turns "my gear is
  // behind" into "I am dying" rather than merely "this is slow".
  //
  // The quadratic term is zero below zone 20 and takes over past it. Armour grows with
  // item level AND rarity, and rarity improves with depth, so it compounds -- a capped
  // character carries ~3,900 armour against a k of 1,440 at zone 100, which is 73%
  // reduction and rising. Deep content could not land a meaningful hit on anyone, and
  // the Hollow King was being beaten at 100% health by builds picked to be bad.
  const deep = Math.pow(Math.max(0, attackerZone - 20), 2);
  const k = 40 + 14 * attackerZone + 0.9 * deep;
  return damage * (1 - armor / (armor + k));
}

/** Total gear score, used for the "am I actually strong enough" readout. */
export function gearScore(save) {
  let total = 0;
  for (const item of Object.values(save.equipped)) {
    if (item) total += item.ilvl;
  }
  return Math.round(total);
}
