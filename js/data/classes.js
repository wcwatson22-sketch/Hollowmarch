// Class definitions: base stats, per-level growth, companion, and ability kits.
// Abilities are cooldown-based and player-toggleable. `unlock` is character level.
// The first ability is available at level 1: an auto-battler with nothing in the
// rotation is a spectator sport, and that is the whole of the opening minutes.
//
// Companion apMult is deliberately modest: an untalented pet supports the owner, it
// does not out-damage them. Companion talents and Bond affixes are what turn one into
// the primary damage source, so a minion build is a choice rather than the default.
//
// Two tuning knobs exist so classes can be balanced without redesigning their kits:
//   armorType -- plate / leather / cloth: drives which item nouns drop and how the
//                gear is drawn on the sprite
//   autoCoef  -- power coefficient of the auto-attack / auto-cast
//   autoName  -- what that swing or cast is called in the log and damage meter
//   solo      -- what an ability BECOMES for a character that chose to go alone at
//                level 5. Companion abilities are dead weight for a solo build, and
//                with only three slots that was fatal: a solo hunter had 2 of 4
//                abilities worth taking and a solo priest had 1 of 4. Retargeting
//                them at the owner keeps both builds choosing from a full kit, which
//                is the whole point of capping the slots.
//   dmgMult   -- flat multiplier on ALL damage this class deals, companion included
//   defMult   -- flat multiplier on max health, which also scales companion health
// Both are solved for by tools/tune.mjs; don't hand-edit dmgMult without re-running it.

// You may only slot this many abilities at once. Every class unlocks four, so the cap
// forces a build decision instead of "tick everything and watch".
export const MAX_ACTIVE_ABILITIES = 3;

export const SCHOOL = { PHYS: 'phys', MAGIC: 'magic' };

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    blurb: 'Stuns, bleeds, and executes. Highest armor, hits like a truck below 25%.',
    color: '#c8492f',
    armorType: 'plate',
    primary: 'ap',
    swingTime: 2.4,
    autoName: 'Melee',
    autoCoef: 0.95,
    dmgMult: 1.076,
    defMult: 1.665,
    base: { hp: 130, ap: 12, sp: 0, armor: 26, crit: 0.030, haste: 0.00 },
    growth: { hp: 19, ap: 2.6, sp: 0, armor: 3.2, crit: 0.0008, haste: 0.0008 },
    companion: null,
    abilities: [
      { id: 'rend', type: 'bleed', name: 'Rend', unlock: 1, cd: 9, kind: 'dot', school: SCHOOL.PHYS,
        coef: 0.35, ticks: 5, tick: 1.8, desc: 'Bleeds the target for 35% AP per tick, 5 ticks.' },
      { id: 'heroic', type: 'physical', name: 'Heroic Strike', unlock: 2, cd: 7, kind: 'nuke', school: SCHOOL.PHYS,
        coef: 1.25, desc: 'A hard swing for 125% AP.' },
      { id: 'shieldbash', type: 'physical', name: 'Shield Bash', unlock: 3, cd: 14, kind: 'stun', school: SCHOOL.PHYS,
        coef: 0.6, stun: 2.5, desc: 'Damage plus a 2.5s stun.' },
      { id: 'execute', type: 'physical', name: 'Execute', unlock: 5, cd: 7, kind: 'execute', school: SCHOOL.PHYS,
        coef: 1.1, executeCoef: 3.0, threshold: 0.25, desc: 'Big hit. Triples in damage below 25% enemy HP.' },
      { id: 'shout', type: 'physical', name: 'Battle Shout', unlock: 7, cd: 26, kind: 'buff', school: SCHOOL.PHYS,
        stat: 'ap', amount: 0.20, dur: 15, desc: '+20% Attack Power for 15s.' },
      { id: 'deepwound', type: 'bleed', name: 'Deep Wound', unlock: 9, cd: 11, kind: 'dot', school: SCHOOL.PHYS,
        coef: 0.50, ticks: 4, tick: 2.5, desc: 'A slow, heavy bleed: 50% AP per tick, 4 ticks.' },
      { id: 'laststand', type: 'physical', name: 'Last Stand', unlock: 11, cd: 45, kind: 'buff', school: SCHOOL.PHYS,
        stat: 'maxHp', amount: 0.35, dur: 20, desc: '+35% max Health for 20s, and healed for the difference.' },
      { id: 'mortal', type: 'physical', name: 'Mortal Strike', unlock: 14, cd: 10, kind: 'nuke', school: SCHOOL.PHYS,
        coef: 2.0, desc: 'A committed swing for 200% AP.' },
      { id: 'secondwind', type: 'physical', name: 'Second Wind', unlock: 17, cd: 26, kind: 'healself', school: SCHOOL.PHYS,
        coef: 1.5, desc: 'Catch your breath: heals you for 150% AP.' },
      { id: 'bladestorm', type: 'physical', name: 'Bladestorm', unlock: 20, cd: 16, kind: 'nuke', school: SCHOOL.PHYS,
        coef: 3.2, desc: 'Everything you have, all at once: 320% AP.' },
    ],
  },

  hunter: {
    id: 'hunter',
    name: 'Hunter',
    blurb: 'Ranged physical damage with a loyal wolf that fights alongside you.',
    color: '#3f9d54',
    armorType: 'leather',
    primary: 'ap',
    swingTime: 2.8,
    autoName: 'Auto Shot',
    autoCoef: 0.80,
    dmgMult: 1.051,
    defMult: 1.034,
    base: { hp: 95, ap: 13, sp: 0, armor: 14, crit: 0.050, haste: 0.01 },
    growth: { hp: 13, ap: 2.8, sp: 0, armor: 1.8, crit: 0.0011, haste: 0.0011 },
    // Chosen at level 5 instead of keeping the companion. Solved by tools/solo.mjs so
    // that neither choice is a trap: soloHp covers the tank you no longer have.
    soloBonus: 0.238,
    soloHp: 0.25,
    companion: { name: 'Wolf', color: '#8a8f98', hpMult: 0.82, apMult: 0.44, swingTime: 2.1, armorMult: 0.70 },
    abilities: [
      { id: 'sting', type: 'poison', name: 'Serpent Sting', unlock: 1, cd: 10, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.30, ticks: 5, tick: 2.0, desc: 'Poisons the target for 30% AP per tick, 5 ticks.' },
      { id: 'arcaneshot', type: 'arcane', name: 'Arcane Shot', unlock: 2, cd: 6, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 1.05, desc: 'A quick charged shot for 105% AP.' },
      { id: 'aimed', type: 'physical', name: 'Aimed Shot', unlock: 3, cd: 8, kind: 'nuke', school: SCHOOL.PHYS,
        coef: 1.6, desc: 'A slow, heavy shot for 160% AP.' },
      { id: 'killcmd', type: 'physical', name: 'Kill Command', unlock: 4, cd: 7, kind: 'petstrike', school: SCHOOL.PHYS,
        coef: 1.5, desc: 'Your wolf tears in for 150% of ITS attack power. Scales with Bond and your pack talents, not with yours.',
        solo: { name: 'Point Blank', kind: 'nuke', coef: 1.0,
          desc: 'A shot taken at close range for 100% AP.' } },
      { id: 'mendpet', type: 'physical', name: 'Mend Pet', unlock: 5, cd: 16, kind: 'healpet',
        coef: 1.2, desc: 'Heals your wolf for 120% AP.',
        solo: { name: 'Field Dressing', kind: 'healself', coef: 1.2,
          desc: 'Patches yourself up for 120% AP.' } },
      { id: 'bwrath', type: 'physical', name: "Beast's Fury", unlock: 7, cd: 35, kind: 'buffpet',
        stat: 'ap', amount: 0.5, dur: 12, desc: 'Your wolf deals +50% damage for 12s.',
        // Smaller than the pet version on purpose: it multiplies your whole output
        // rather than a companion that is roughly a third of it.
        solo: { name: 'Rapid Fire', kind: 'buff', stat: 'ap', amount: 0.14, dur: 12,
          desc: 'You deal +14% damage for 12s.' } },
      { id: 'trap', type: 'fire', name: 'Explosive Trap', unlock: 9, cd: 13, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.42, ticks: 4, tick: 2.0, burst: 0.6, desc: 'Bursts for 60% AP, then burns for 42% per tick.' },
      { id: 'concussive', type: 'physical', name: 'Concussive Shot', unlock: 11, cd: 13, kind: 'stun', school: SCHOOL.PHYS,
        coef: 0.9, stun: 2.5, desc: 'Damage plus a 2.5s stun.' },
      { id: 'killshot', type: 'physical', name: 'Kill Shot', unlock: 14, cd: 9, kind: 'execute', school: SCHOOL.PHYS,
        coef: 1.0, executeCoef: 3.1, threshold: 0.25, desc: 'Triples in damage below 25% enemy HP.' },
      { id: 'hawk', type: 'physical', name: 'Aspect of the Hawk', unlock: 17, cd: 35, kind: 'buff', school: SCHOOL.PHYS,
        stat: 'ap', amount: 0.26, dur: 20, desc: '+26% Attack Power for 20s.' },
      { id: 'bestial', type: 'physical', name: 'Bestial Wrath', unlock: 20, cd: 60, kind: 'buffpet',
        stat: 'ap', amount: 0.80, dur: 15, desc: 'Your wolf deals +80% damage for 15s.',
        solo: { name: 'Focused Aim', kind: 'buff', stat: 'ap', amount: 0.20, dur: 15,
          desc: 'You deal +20% damage for 15s.' } },
    ],
  },

  priest: {
    id: 'priest',
    name: 'Priest',
    blurb: 'Holy caster. A frail mercenary warrior tanks for you — keep them alive.',
    color: '#e0d7b8',
    armorType: 'cloth',
    primary: 'sp',
    swingTime: 2.6,
    autoName: 'Wand',
    autoCoef: 1.05, // the priest's "auto" is a Smite cast, so it hits harder per swing
    dmgMult: 0.951,
    defMult: 0.500,
    base: { hp: 90, ap: 0, sp: 14, armor: 8, crit: 0.035, haste: 0.015 },
    growth: { hp: 12, ap: 0, sp: 3.0, armor: 1.2, crit: 0.0011, haste: 0.0014 },
    // Still the frailest companion, but it has to contribute enough to be worth healing.
    // Chosen at level 5 instead of keeping the companion.
    soloBonus: 0.302,
    soloHp: 0.30,
    companion: { name: 'Mercenary', color: '#9a7b4f', hpMult: 0.85, apMult: 0.56, swingTime: 2.4, armorMult: 0.9 },
    abilities: [
      { id: 'renew', type: 'holy', name: 'Renew', unlock: 1, cd: 8, kind: 'hot',
        coef: 0.30, ticks: 5, tick: 1.5, desc: 'Heals the Mercenary for 30% SP per tick, 5 ticks.',
        solo: { kind: 'hotself', coef: 0.30,
          desc: 'Heals you for 30% SP per tick, 5 ticks.' } },
      { id: 'holyfire', type: 'fire', name: 'Holy Fire', unlock: 2, cd: 10, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.34, ticks: 5, tick: 2.0, burst: 0.5, desc: 'Sears for 50% SP, then burns for 34% per tick.' },
      { id: 'command', type: 'holy', name: 'Holy Command', unlock: 4, cd: 7, kind: 'petstrike', school: SCHOOL.PHYS,
        coef: 1.4, desc: 'The Mercenary drives in for 140% of ITS attack power. Scales with Bond and your Faith talents.',
        solo: { name: 'Smite', kind: 'nuke', coef: 1.0, school: SCHOOL.MAGIC,
          desc: 'A bolt of holy light for 100% SP.' } },
      { id: 'zeal', type: 'holy', name: 'Zeal', unlock: 8, cd: 28, kind: 'buffpet',
        stat: 'ap', amount: 0.40, dur: 16, desc: 'The Mercenary gains +40% attack power for 16s.',
        solo: { name: 'Inner Fire', kind: 'buff', stat: 'ap', amount: 0.22, dur: 16,
          desc: 'You gain +22% spell power for 16s.' } },
      { id: 'fort', type: 'holy', name: 'Power Word: Fortitude', unlock: 3, cd: 40, kind: 'buffpet',
        stat: 'maxHp', amount: 0.30, dur: 25, desc: 'Mercenary gains +30% max HP for 25s.',
        solo: { kind: 'buff', stat: 'maxHp', amount: 0.20, dur: 25,
          desc: 'You gain +20% max HP for 25s.' } },
      { id: 'swp', type: 'shadow', name: 'Shadow Word: Pain', unlock: 5, cd: 12, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.40, ticks: 6, tick: 2.0, desc: 'Afflicts the target for 40% SP per tick, 6 ticks.' },
      { id: 'gheal', type: 'holy', name: 'Greater Heal', unlock: 7, cd: 10, kind: 'healpet',
        coef: 1.5, desc: 'A big emergency heal on the Mercenary for 150% SP.',
        solo: { kind: 'healself', coef: 1.5,
          desc: 'A big emergency heal on yourself for 150% SP.' } },
      { id: 'holynova', type: 'holy', name: 'Holy Nova', unlock: 9, cd: 8, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 1.45, desc: 'A burst of light for 145% SP.' },
      { id: 'innerfire', type: 'holy', name: 'Inner Fire', unlock: 11, cd: 30, kind: 'buff', school: SCHOOL.MAGIC,
        stat: 'ap', amount: 0.24, dur: 20, desc: '+24% Spell Power for 20s.' },
      { id: 'mending', type: 'holy', name: 'Prayer of Mending', unlock: 14, cd: 18, kind: 'healpet',
        coef: 1.9, desc: 'A heavy heal on the Mercenary for 190% SP.',
        solo: { kind: 'healself', coef: 1.9,
          desc: 'A heavy heal on yourself for 280% SP.' } },
      { id: 'shadowfiend', type: 'shadow', name: 'Shadowfiend', unlock: 17, cd: 14, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 2.6, desc: 'Sets something small and hungry on the target: 260% SP.' },
      { id: 'penance', type: 'holy', name: 'Penance', unlock: 20, cd: 14, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 3.0, desc: 'Three bolts of judgement for 300% SP.' },
    ],
  },

  warlock: {
    id: 'warlock',
    name: 'Warlock',
    blurb: 'Stacked damage-over-time and a demon that soaks hits while you burn.',
    color: '#7c4fa8',
    armorType: 'cloth',
    primary: 'sp',
    swingTime: 3.0,
    // The auto-attack is the wand in your hand, not a school of magic -- calling it
    // Shadow Bolt implied it scaled with shadow talents, which it never did.
    autoName: 'Wand',
    autoCoef: 0.80,
    dmgMult: 0.930,
    defMult: 1.282,
    base: { hp: 100, ap: 0, sp: 13, armor: 10, crit: 0.030, haste: 0.010 },
    growth: { hp: 14, ap: 0, sp: 2.9, armor: 1.4, crit: 0.0009, haste: 0.0011 },
    // Chosen at level 5 instead of keeping the companion.
    soloBonus: 0.188,
    soloHp: 0.46,
    companion: { name: 'Imp', color: '#b0453f', hpMult: 0.52, apMult: 0.46, swingTime: 1.9, armorMult: 0.45 },
    abilities: [
      { id: 'corruption', type: 'shadow', name: 'Corruption', unlock: 1, cd: 9, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.32, ticks: 6, tick: 2.0, desc: 'Rots the target for 32% SP per tick, 6 ticks.' },
      { id: 'agony', type: 'shadow', name: 'Curse of Agony', unlock: 2, cd: 12, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.28, ticks: 7, tick: 2.0, desc: 'A long curse: 28% SP per tick, 7 ticks.' },
      { id: 'immolate', type: 'fire', name: 'Immolate', unlock: 3, cd: 11, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.38, ticks: 5, tick: 2.0, burst: 0.7, desc: 'Burst for 70% SP, then burns for 38% SP per tick.' },
      { id: 'drain', type: 'shadow', name: 'Drain Life', unlock: 5, cd: 14, kind: 'drain', school: SCHOOL.MAGIC,
        coef: 1.3, leech: 0.6,
        desc: 'Deals 130% SP. Heals for 60% of the damage, split between you and your demon — the larger share going to whichever is worse off.' },
      { id: 'felcommand', type: 'fire', name: 'Fel Command', unlock: 4, cd: 7, kind: 'petstrike', school: SCHOOL.MAGIC,
        coef: 1.5, desc: 'Your demon lashes out for 150% of ITS attack power. Scales with Bond and your Demonology talents, not with yours.',
        solo: { name: 'Shadowburn', kind: 'nuke', coef: 1.0, school: SCHOOL.MAGIC, type: 'shadow',
          desc: 'A burst of raw shadow for 100% SP.' } },
      { id: 'demonic', type: 'shadow', name: 'Demonic Empowerment', unlock: 7, cd: 35, kind: 'buffpet',
        stat: 'ap', amount: 0.6, dur: 12, desc: 'Your demon deals +60% damage for 12s.',
        solo: { name: 'Dark Pact', kind: 'buff', stat: 'ap', amount: 0.35, dur: 12,
          desc: 'You deal +35% damage for 12s.' } },
      { id: 'ua', type: 'shadow', name: 'Unstable Affliction', unlock: 9, cd: 12, kind: 'dot', school: SCHOOL.MAGIC,
        coef: 0.45, ticks: 5, tick: 2.0, desc: 'A violent rot: 45% SP per tick, 5 ticks.' },
      { id: 'shadowburn', type: 'fire', name: 'Shadowburn', unlock: 11, cd: 10, kind: 'execute', school: SCHOOL.MAGIC,
        coef: 1.0, executeCoef: 3.2, threshold: 0.25, desc: 'Triples in damage below 25% enemy HP.' },
      { id: 'chaosbolt', type: 'shadow', name: 'Chaos Bolt', unlock: 14, cd: 12, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 2.4, desc: 'Raw chaos for 240% SP.' },
      { id: 'felarmor', type: 'shadow', name: 'Fel Armor', unlock: 17, cd: 35, kind: 'buff', school: SCHOOL.MAGIC,
        stat: 'maxHp', amount: 0.28, dur: 25, desc: '+28% max Health for 25s, and healed for the difference.' },
      { id: 'soulfire', type: 'fire', name: 'Soul Fire', unlock: 20, cd: 24, kind: 'nuke', school: SCHOOL.MAGIC,
        coef: 3.4, desc: 'A slow, enormous cast for 340% SP.' },
    ],
  },
};


/**
 * A sensible three-ability loadout at a given level.
 *
 * With ten abilities and three slots, "the first three" stops being a loadout the
 * moment anything unlocks above level 3 -- a simulated level 26 character was still
 * fighting with its level 1-3 kit, which measures a character nobody would play. The
 * balance tools call this so they benchmark the build a player would actually run.
 *
 * Scored as throughput per second of cooldown. Taking the NEWEST three would be
 * simpler but would strip a class of its identity the moment a big nuke unlocked.
 */
export function suggestedKit(classId, level, solo = false) {
  const value = (a) => {
    const cd = Math.max(1, a.cd || 1);
    switch (a.kind) {
      case "nuke": return a.coef / cd;
      case "dot": return ((a.burst || 0) + a.coef * a.ticks) / cd;
      case "stun": return (a.coef + 0.5) / cd;
      case "execute": return (a.coef * 0.7 + a.executeCoef * 0.3) / cd;
      case "drain": return (a.coef * 1.15) / cd;
      // Scaled off the companion's attack power rather than yours, and a pet carrying a
      // pet build runs at roughly four fifths of its owner's power once Bond and the pack
      // talents are in. Without a case here it fell to the default 0.10 and the ability
      // added for pet builds was the one thing a pet build never picked up.
      case "petstrike": return solo ? 0 : (a.coef * 1.0) / cd;
      case "buff":
      case "buffpet": {
        if (solo && a.kind === "buffpet" && !a.solo) return 0;
        const uptime = Math.min(1, (a.dur || 0) / cd);
        return a.stat === "ap" ? a.amount * uptime * 0.9 : a.amount * uptime * 0.35;
      }
      // Keeping something alive is throughput too, just never the top pick.
      case "healpet": case "hot": return 0.14;
      default: return 0.10;
    }
  };

  const pool = CLASSES[classId].abilities.filter((a) => a.unlock <= level);
  const ranked = [...pool].sort((x, y) => value(y) - value(x));
  const picked = ranked.slice(0, MAX_ACTIVE_ABILITIES);

  // A class whose companion is doing the tanking keeps one way to keep it standing.
  // Left purely to the score, the priest drops every heal and then watches its
  // mercenary die on every pull.
  // healpet and hot resolve to healself and hotself for a character that went alone, so
  // this is the solo build's only sustain as well as the pet build's. Gating it on having
  // a companion cost solo hunters and priests every run to permadeath.
  // A leech counts. The warlock owns no heal at all, so this guarantee found nothing for
  // it and a solo warlock went out with three damage spells and no way to get health
  // back -- the only build measured that ran itself out of lives.
  const isSustain = (a) => a.kind === "healpet" || a.kind === "hot" || a.kind === "drain";
  if (CLASSES[classId].companion && !picked.some(isSustain)) {
    const heal = ranked.find(isSustain);
    if (heal && picked.length === MAX_ACTIVE_ABILITIES) picked[picked.length - 1] = heal;
  }
  return picked.map((a) => a.id);
}

/** Apply suggestedKit to a save in place. Used by the balance tools. */
export function autoSlot(save) {
  const keep = new Set(suggestedKit(save.classId, save.level, save.petChoice === 'solo'));
  for (const a of CLASSES[save.classId].abilities) save.abilityToggles[a.id] = keep.has(a.id);
  return save;
}

export const CLASS_LIST = Object.values(CLASSES);
