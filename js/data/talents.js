// Talent trees.
//
// Tier 1 unlocks at character level 5 and tunes broad stats.
// Tier 2 ("mastery") unlocks at level 15 and modifies SPECIFIC abilities -- potency,
// cooldown, extra DoT ticks, execute thresholds. That's where builds get their teeth:
// a warlock can pour everything into Corruption, a warrior into Execute.
//
// Both tiers draw from the same pool of points (one per level from 5 onward).
//
// `dotCrit` is the share of your crit chance that applies to damage-over-time ticks.
// DoTs could not crit at all, which meant crit rating was dead weight for a DoT build
// and the only scaling it had was flat +dotDmg talents -- the reason those builds felt
// like putting points into nothing. Gating it behind a talent rather than giving it
// away keeps it a build decision, and because it MULTIPLIES your crit rather than
// replacing it, taking it is what makes crit gear start mattering to you.

export const RESPEC_BASE_COST = 2500;
export const RESPEC_GROWTH = 1.75; // cost multiplies each time you respec
export const TALENT_UNLOCK_LEVEL = 5;
export const DEEP_TALENT_LEVEL = 15;

const t = (id, name, branch, max, per, desc) =>
  ({ id, name, branch, max, per, desc, tier: 1, req: TALENT_UNLOCK_LEVEL });

/** Tier-2 talent bound to one ability. `per` keys: potency, cdr, ticks, threshold, stun. */
/** Tier-2 talent with no ability binding: a build-defining stat instead. */
const deepStat = (id, name, branch, max, per, desc) =>
  ({ id, name, branch, max, per, desc, tier: 2, req: DEEP_TALENT_LEVEL });

const deep = (id, name, branch, ability, max, per, desc) =>
  ({ id, name, branch, ability, max, per, desc, tier: 2, req: DEEP_TALENT_LEVEL });

export const TALENTS = {
  // BLEED (Arms) -- damage over time, and the talent that lets it crit.
  // THORNS (Prot) -- you want to be hit; the damage comes back out.
  // SHOUTS (Fury) -- stacking self-buffs that multiply everything else.
  warrior: [
    t('deepwounds', 'Deep Wounds',  'Bleed', 5, { bleedDmg: 0.13 }, '+13% bleed damage per rank.'),
    t('bloodfrenzy','Blood Frenzy', 'Bleed', 5, { dotCrit: 0.20 },  'Your bleeds can critically strike: +20% of your crit chance applies to them per rank.'),
    t('hemorrhage', 'Hemorrhage',   'Bleed', 5, { dotDmg: 0.08 },   '+8% damage from all damage-over-time effects per rank.'),
    t('impale',     'Impale',       'Bleed', 5, { critDmg: 0.10 },  '+10% critical damage per rank.'),

    t('bloodthirst','Bloodthirst',  'Shouts', 5, { leech: 0.02 },   'You recover 2% of all damage you deal as health, per rank. Capped at 10% from every source.'),
    t('rendingblow','Rending Blow',  'Bleed', 5, { autoDot: 0.01 },  'Your melee swings have a 1% chance per rank to open a wound that bleeds.'),
    t('thorns',     'Spiked Armor', 'Thorns', 5, { thorns: 0.22 },  'Reflect 22% of your Attack Power at anything that hits you, per rank.'),
    t('retaliation','Retaliation',  'Thorns', 5, { thorns: 0.16, armorPct: 0.04 }, 'Reflect a further 16% of Attack Power and gain +4% armor per rank.'),
    t('toughness',  'Toughness',    'Thorns', 5, { armorPct: 0.07 },'+7% armor per rank.'),
    t('ironhide',   'Iron Hide',    'Thorns', 5, { hpPct: 0.05 },   '+5% max health per rank.'),

    t('cruelty',    'Cruelty',      'Shouts', 5, { crit: 0.008 },   '+0.8% crit chance per rank.'),
    t('flurry',     'Flurry',       'Shouts', 5, { haste: 0.012 },  '+1.2% haste per rank.'),
    t('warbringer', 'Warbringer',   'Shouts', 5, { physicalDmg: 0.09 }, '+9% physical damage per rank.'),
    t('endurance',  'Endurance',    'Shouts', 5, { hpPct: 0.04 },   '+4% max health per rank.'),

    deep('m_rend',    'Bloodletting',   'Mastery', 'rend',       5, { potency: 0.14 }, 'Rend deals +14% damage per rank.'),
    deep('m_rend2',   'Gushing Wounds', 'Mastery', 'rend',       3, { ticks: 1 },      'Rend bleeds for 1 additional tick per rank.'),
    deep('m_deep',    'Mortal Wounds',  'Mastery', 'deepwound',  5, { potency: 0.15 }, 'Deep Wound deals +15% damage per rank.'),
    deep('m_exec',    'Sudden Death',   'Mastery', 'execute',    5, { potency: 0.15 }, 'Execute deals +15% damage per rank.'),
    deep('m_exec2',   'Blood Scent',    'Mastery', 'execute',    4, { threshold: 0.04 }, 'Execute triggers 4% higher per rank.'),
    deep('m_bash',    'Concussion',     'Mastery', 'shieldbash', 5, { potency: 0.16, stun: 0.2 }, 'Shield Bash: +16% damage and +0.2s stun per rank.'),
    deep('m_shout',   'Commanding Presence', 'Mastery', 'shout', 4, { cdr: 0.10 },     'Battle Shout cooldown -10% per rank.'),
    deep('m_storm',   'Whirling Edge',  'Mastery', 'bladestorm', 5, { potency: 0.16 }, 'Bladestorm deals +16% damage per rank.'),
  ],

  // RANGER -- direct shots, crit, and the big single hits.
  // ASSASSIN -- entirely poisons and bleeds, with the talent that lets them crit.
  // PACK -- the companion build.
  hunter: [
    t('lethalshots', 'Lethal Shots',  'Ranger', 5, { crit: 0.009 },  '+0.9% crit chance per rank.'),
    t('mortalshots', 'Mortal Shots',  'Ranger', 5, { critDmg: 0.11 },'+11% critical damage per rank.'),
    t('rapidkilling','Rapid Killing', 'Ranger', 5, { haste: 0.012 }, '+1.2% haste per rank.'),
    t('marksman',    'Marksmanship',  'Ranger', 5, { physicalDmg: 0.09 }, '+9% physical damage per rank.'),

    t('bloodletting','Bloodletting',  'Assassin', 5, { autoDot: 0.01 },  'Your shots have a 1% chance per rank to leave a bleeding wound.'),
    t('survivalist', 'Survivalist',   'Ranger', 5, { leech: 0.02 },    'You recover 2% of all damage you deal as health, per rank. Capped at 10% from every source.'),
    t('toxicology',  'Toxicology',    'Assassin', 5, { poisonDmg: 0.14 }, '+14% poison damage per rank.'),
    t('lethaldoses', 'Lethal Doses',  'Assassin', 5, { dotCrit: 0.20 },   'Your poisons and bleeds can critically strike: +20% of your crit chance applies to them per rank.'),
    t('virulence',   'Virulence',     'Assassin', 5, { dotDmg: 0.10 },    '+10% damage from all damage-over-time effects per rank.'),
    t('firetrap',    'Scorched Earth','Assassin', 5, { fireDmg: 0.12 },   '+12% fire damage per rank.'),

    t('beastmastery','Beast Mastery', 'Pack', 5, { petPow: 0.16 },  '+16% companion damage per rank.'),
    t('thickhide',   'Thick Hide',    'Pack', 5, { petArmor: 0.14 },'+14% companion armor per rank.'),
    t('endurancetrn','Endurance Training','Pack', 5, { petHp: 0.12 }, '+12% companion health per rank.'),
    t('frenzy',      'Frenzy',        'Pack', 5, { petHaste: 0.08 }, '+8% companion attack speed per rank. Compounds with Bond and with Kill Command.'),

    deep('m_sting',  'Improved Sting', 'Mastery', 'sting',      5, { potency: 0.15 }, 'Serpent Sting deals +15% damage per rank.'),
    deep('m_sting2', 'Lingering Venom','Mastery', 'sting',      3, { ticks: 1 },      'Serpent Sting lasts 1 additional tick per rank.'),
    deep('m_trap',   'Napalm',         'Mastery', 'trap',       5, { potency: 0.15 }, 'Explosive Trap deals +15% damage per rank.'),
    deep('m_aimed',  'Careful Aim',    'Mastery', 'aimed',      5, { potency: 0.15 }, 'Aimed Shot deals +15% damage per rank.'),
    deep('m_kill',   'Executioner',    'Mastery', 'killshot',   5, { potency: 0.16 }, 'Kill Shot deals +16% damage per rank.'),
    deep('m_bwrath', 'Unleashed Fury', 'Mastery', 'bwrath',     4, { cdr: 0.10 },     "Beast's Fury cooldown -10% per rank."),
    deep('m_bestial','Primal Rage',    'Mastery', 'bestial',    4, { cdr: 0.10 },     'Bestial Wrath cooldown -10% per rank.'),
    deep('m_killcmd','Go for the Throat','Mastery','killcmd',    5, { potency: 0.16 }, 'Kill Command deals +16% damage per rank.'),
    deepStat('m_pack', 'Alpha',          'Mastery', 5, { petPow: 0.14, petHaste: 0.05 }, 'The wolf leads: +14% companion damage and +5% companion attack speed per rank.'),
  ],

  // HOLY -- direct light damage and the heals that keep the mercenary standing.
  // SHADOW -- damage over time, with the talent that lets it crit.
  // FAITH -- the companion build.
  priest: [
    t('searinglight','Searing Light',  'Holy', 5, { holyDmg: 0.12 }, '+12% holy damage per rank.'),
    t('divinefury',  'Divine Fury',    'Holy', 5, { crit: 0.009 },   '+0.9% crit chance per rank.'),
    t('holyspec',    'Holy Specialization','Holy', 5, { critDmg: 0.10 }, '+10% critical damage per rank.'),
    t('spiritualitv','Spirituality',   'Holy', 5, { healPow: 0.10 }, '+10% healing done per rank.'),
    t('atonement',   'Atonement',      'Holy', 5, { atonement: 0.12 }, 'Healing also strikes the enemy for 12% of the amount healed, per rank.'),

    t('darkness',     'Darkness',      'Shadow', 5, { shadowDmg: 0.13 }, '+13% shadow damage per rank.'),
    t('twistedfaith', 'Twisted Faith', 'Shadow', 5, { dotCrit: 0.20 },   'Your damage-over-time effects can critically strike: +20% of your crit chance applies to them per rank.'),
    t('shadowweaving','Shadow Weaving','Shadow', 5, { dotDmg: 0.10 },    '+10% damage from all damage-over-time effects per rank.'),
    t('shadowform',   'Shadowform',    'Shadow', 5, { haste: 0.012 },    '+1.2% haste per rank.'),

    t('mercreach',   'Inspiring Presence','Faith', 5, { petPow: 0.15 },  '+15% mercenary damage per rank.'),
    t('wardoffaith', 'Ward of Faith',    'Faith', 5, { petArmor: 0.14 }, '+14% mercenary armor per rank.'),
    t('bulwark',     'Bulwark',          'Faith', 5, { petHp: 0.13 },    '+13% mercenary health per rank.'),
    t('zealotry',    'Zealotry',         'Faith', 5, { petHaste: 0.075 }, '+7.5% Mercenary attack speed per rank. Compounds with Bond and with Holy Command.'),

    deep('m_swp',    'Eternal Torment', 'Mastery', 'swp',        5, { potency: 0.15 }, 'Shadow Word: Pain deals +15% damage per rank.'),
    deep('m_swp2',   'Unending Pain',   'Mastery', 'swp',        3, { ticks: 1 },      'Shadow Word: Pain lasts 1 additional tick per rank.'),
    deep('m_holyfire','Blaze',          'Mastery', 'holyfire',   5, { potency: 0.15 }, 'Holy Fire deals +15% damage per rank.'),
    deep('m_nova',   'Radiance',        'Mastery', 'holynova',   5, { potency: 0.15 }, 'Holy Nova deals +15% damage per rank.'),
    deep('m_penance','Castigation',     'Mastery', 'penance',    5, { potency: 0.15 }, 'Penance deals +15% damage per rank.'),
    deep('m_renew',  'Empowered Renew', 'Mastery', 'renew',      5, { potency: 0.16 }, 'Renew heals +16% per rank.'),
    deep('m_gheal',  'Divine Providence','Mastery','gheal',      4, { cdr: 0.10 },     'Greater Heal cooldown -10% per rank.'),
    deep('m_command','Righteous Order',  'Mastery','command',    5, { potency: 0.16 }, 'Holy Command deals +16% damage per rank.'),
    deepStat('m_faith','Sworn Blade',    'Mastery', 5, { petPow: 0.13, petHaste: 0.05 }, 'The Mercenary fights for something: +13% damage and +5% attack speed per rank.'),
  ],

  // FIRE -- Immolate, Shadowburn, Soul Fire: burst and burn.
  // SHADOW -- stacked rot, and the talent that lets it crit.
  // DEMONOLOGY -- the pet build.
  warlock: [
    t('emberstorm',  'Emberstorm',    'Fire', 5, { fireDmg: 0.13 }, '+13% fire damage per rank.'),
    t('devastation', 'Devastation',   'Fire', 5, { crit: 0.009 },   '+0.9% crit chance per rank.'),
    t('ruin',        'Ruin',          'Fire', 5, { critDmg: 0.11 }, '+11% critical damage per rank.'),
    t('backdraft',   'Backdraft',     'Fire', 5, { haste: 0.012 },  '+1.2% haste per rank.'),

    t('soulsiphon',   'Soul Siphon',  'Shadow', 5, { leech: 0.02 },     'You recover 2% of all damage you deal as health, per rank. Capped at 10% from every source.'),
    t('embertouch',   'Ember Touch',  'Fire', 5, { autoDot: 0.01 },    'Your wand shots have a 1% chance per rank to leave a cinder burning.'),
    t('shadowmastery','Shadow Mastery','Shadow', 5, { shadowDmg: 0.13 }, '+13% shadow damage per rank.'),
    t('pandemic',     'Pandemic',     'Shadow', 5, { dotCrit: 0.20 },    'Your damage-over-time effects can critically strike: +20% of your crit chance applies to them per rank.'),
    t('contagion',    'Contagion',    'Shadow', 5, { dotDmg: 0.11 },     '+11% damage from all damage-over-time effects per rank.'),
    t('siphonlife',   'Siphon Life',  'Shadow', 5, { hpPct: 0.045 },     '+4.5% max health per rank.'),

    t('demonicknow', 'Demonic Knowledge', 'Demonology', 5, { petPow: 0.16 }, '+16% demon damage per rank.'),
    t('felstamina',  'Fel Stamina',       'Demonology', 5, { petHp: 0.13 },  '+13% demon health per rank.'),
    t('demonicaegis','Demonic Aegis',     'Demonology', 5, { petArmor: 0.14 }, '+14% demon armor per rank.'),
    t('demonicfrenzy','Demonic Frenzy',   'Demonology', 5, { petHaste: 0.08 }, '+8% demon attack speed per rank. Compounds with Bond and with Fel Command.'),

    deep('m_corr',   'Improved Corruption','Mastery', 'corruption', 5, { potency: 0.15 }, 'Corruption deals +15% damage per rank.'),
    deep('m_corr2',  'Nightfall',          'Mastery', 'corruption', 3, { ticks: 1 },      'Corruption lasts 1 additional tick per rank.'),
    deep('m_agony',  'Amplify Curse',      'Mastery', 'agony',      5, { potency: 0.15 }, 'Curse of Agony deals +15% damage per rank.'),
    deep('m_immo',   'Improved Immolate',  'Mastery', 'immolate',   5, { potency: 0.15 }, 'Immolate deals +15% damage per rank.'),
    deep('m_ua',     'Malefic Grasp',      'Mastery', 'ua',         5, { potency: 0.16 }, 'Unstable Affliction deals +16% damage per rank.'),
    deep('m_soulfire','Emberfall',         'Mastery', 'soulfire',   5, { potency: 0.16 }, 'Soul Fire deals +16% damage per rank.'),
    deep('m_drain',  'Soul Leech',         'Mastery', 'drain',      5, { potency: 0.16 }, 'Drain Life deals +16% damage per rank.'),
    deep('m_felcmd', 'Command Demon',      'Mastery', 'felcommand', 5, { potency: 0.16 }, 'Fel Command deals +16% damage per rank.'),
    deepStat('m_demon','Master of Demons',  'Mastery', 5, { petPow: 0.14, petHaste: 0.05 }, 'The demon is the weapon: +14% demon damage and +5% demon attack speed per rank.'),
  ],
};

/** Talents that only do anything for a character with a companion. */
export const isPetTalent = (tal) =>
  Boolean(tal.per.petPow || tal.per.petHp || tal.per.petArmor || tal.per.petHaste);

/**
 * Ranks actually in effect: points you allocated, plus ranks granted by an equipped
 * trinket. A trinket can push a talent PAST its normal maximum (5/5 + 2 = 7/5) and
 * the effect scales with the full number, which is the whole appeal of finding one.
 */
export function resolveRanks(save) {
  const out = { ...(save.talents || {}) };
  const tri = save.equipped?.trinket;
  if (tri && tri.talentId && tri.talentRanks) {
    out[tri.talentId] = (out[tri.talentId] || 0) + tri.talentRanks;
  }
  // Tomes are permanent and are not refunded by a respec: they are not points you
  // spent, they are pages you found. Like a trinket's grant they can push a talent past
  // its normal maximum, which is the whole appeal of finding one for a talent you have
  // already capped.
  for (const [id, n] of Object.entries(save.tomes || {})) out[id] = (out[id] || 0) + n;
  return out;
}

/** A talent a tome can grant to this character, or null if there is nothing sensible. */
export function tomeTargetFor(save, rng = Math.random) {
  const pool = (TALENTS[save.classId] || []).filter((t) => {
    if (save.petChoice === 'solo' && isPetTalent(t)) return false;
    if (t.tier === 2 && t.ability && save.abilityToggles?.[t.ability] === false) return false;
    return true;
  });
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/** Ranks a trinket is adding to one talent, for display. */
export const trinketRanksFor = (save, talentId) => {
  const tri = save.equipped?.trinket;
  return tri && tri.talentId === talentId ? tri.talentRanks || 0 : 0;
};

/** Sum every tier-1 talent's per-rank effect into one modifier bag. */
export function talentMods(classId, points, { solo = false } = {}) {
  const mods = {};
  for (const tal of TALENTS[classId] || []) {
    if (tal.tier === 2 && tal.ability) continue; // ability-bound ones go to abilityMods
    if (solo && isPetTalent(tal)) continue;      // no companion, no companion talents
    const rank = points?.[tal.id] || 0;
    if (!rank) continue;
    for (const [k, v] of Object.entries(tal.per)) mods[k] = (mods[k] || 0) + v * rank;
  }
  return mods;
}

/**
 * Per-ability modifiers from tier-2 talents.
 * @returns { [abilityId]: { potency, cdr, ticks, threshold, stun } }
 */
export function abilityMods(classId, points) {
  const out = {};
  for (const tal of TALENTS[classId] || []) {
    if (tal.tier !== 2 || !tal.ability) continue;
    const rank = points?.[tal.id] || 0;
    if (!rank) continue;
    const bag = (out[tal.ability] ||= {});
    for (const [k, v] of Object.entries(tal.per)) bag[k] = (bag[k] || 0) + v * rank;
  }
  return out;
}

/** Points granted by levelling. Trinkets add more on top; see availablePoints(). */
export const earnedTalentPoints = (level) =>
  level >= TALENT_UNLOCK_LEVEL ? level - TALENT_UNLOCK_LEVEL + 1 : 0;

export const spentTalentPoints = (talents) =>
  Object.values(talents || {}).reduce((a, b) => a + b, 0);

/**
 * The first respec is free.
 *
 * Talents are the one decision you make with the least information -- you are choosing
 * at level 5, before you have seen a single one of them actually resolve. Charging for
 * the correction taxes the player for the game's own opacity, and the practical effect
 * is that people stop experimenting rather than pay. Every respec after the first still
 * escalates, so it stays a commitment rather than a scratchpad.
 */
export function respecCost(timesRespecced) {
  if (timesRespecced <= 0) return 0;
  return Math.round(RESPEC_BASE_COST * Math.pow(RESPEC_GROWTH, timesRespecced - 1));
}
