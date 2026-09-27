// Zone + mob definitions. A "zone" is a game level, not a character level.
// Zones 1-9 hold 10 mobs each; every 10th zone is a boss zone (one boss, no trash).

export const MOBS_PER_ZONE = 10;

/**
 * Where the march ends. Zone 100 holds the last thing on the road, and it is meant to
 * be unbeatable by a character who merely arrived: only a build that has been actually
 * tuned -- the right three abilities, talents committed to one branch, and set pieces
 * behind them -- gets through it. Everything before zone 100 is the preparation.
 */
/**
 * Falling back below your checkpoint.
 *
 * A checkpoint used to be a hard floor, which made a stuck run permanently stuck: die
 * in the zone you respawn into, respawn into it again, and you never gain the XP or
 * gear that would let you stop dying. One sweep run spent 115 simulated minutes with
 * zero kills and 77 deaths. After this many deaths with nothing killed in between, the
 * floor gives way and you drop toward content you can actually farm.
 */

export const STALL_DEATHS = 3;
export const STALL_DROP = 2;   // zones lost per death once the floor gives way

export const FINAL_ZONE = 100;
export const isFinalZone = (zone) => zone >= FINAL_ZONE;
// Every fifth zone. At every tenth, a checkpoint was forty trash mobs apart -- losing
// one cost most of an hour, and the set-piece the whole zone builds toward arrived twice
// an evening. Checkpoints move with bosses (see onKill), so this halves the cost of a
// death as well as doubling the pacing.
export const isBossZone = (zone) => zone % 5 === 0;

// Every tenth is the real one. Both set a checkpoint and both are a set-piece, but only
// a major boss sends you to the enchanter -- a full rarity on a worn piece every five
// zones, twice over, outran the content badly enough that the final boss fell in
// seconds. The minor ones pay a tome instead: small, permanent, and additive.
export const isMajorBossZone = (zone) => zone % 10 === 0;

// `sky2` is the horizon colour, `far`/`mid` are the two parallax bands behind the
// action and `fg` is the silhouette layer in front of it. `weather` and `tint` drive
// the ambient particle system and the colour grade in the renderer.
const THEMES = [
  { name: 'Greenwood Trail', sky: '#7fb7e0', sky2: '#cfe6f2', ground: '#4a7a3a', accent: '#2f5a28',
    far: '#6f9fbe', mid: '#3f6b34', fg: '#1d3a1c', weather: 'pollen', tint: 'rgba(255,240,180,0.05)',
    mobs: [['Field Rat', '#7a6a55'], ['Wild Boar', '#8a5a3a'], ['Bandit Scout', '#6a6a8a']] },
  { name: 'Ashen Quarry', sky: '#c08a5a', sky2: '#e8c398', ground: '#6a5a4a', accent: '#4a3e33',
    far: '#9c7358', mid: '#5c4c40', fg: '#2e251f', weather: 'ash', tint: 'rgba(255,170,90,0.08)',
    mobs: [['Rock Grub', '#8a8a6a'], ['Quarry Thug', '#7a5a4a'], ['Ash Hound', '#5a4a4a']] },
  { name: 'Drowned Fen', sky: '#5a7a7a', sky2: '#93b3ad', ground: '#3a5a4a', accent: '#26382d',
    far: '#4e6d69', mid: '#324d40', fg: '#182a22', weather: 'rain', tint: 'rgba(120,190,190,0.07)',
    mobs: [['Bog Lurker', '#4a7a5a'], ['Fen Wisp', '#7ac0a0'], ['Rotting Husk', '#6a7a4a']] },
  { name: 'Obsidian Reach', sky: '#3a2f4a', sky2: '#6b4f78', ground: '#3a3346', accent: '#241f2e',
    far: '#4a3b5c', mid: '#302a3c', fg: '#171320', weather: 'void', tint: 'rgba(150,90,220,0.09)',
    mobs: [['Shade Stalker', '#5a4a7a'], ['Void Crawler', '#7a4a8a'], ['Cinder Fiend', '#a04a4a']] },
];

const BOSS_NAMES = [
  ['Grukk the Unbroken', '#a03a2a'],
  ['Foreman Vayle', '#b0763a'],
  ['Mirebound Horror', '#3a8a5a'],
  ['Nharos, the Hollow', '#8a3aa0'],
];

export function themeForZone(zone) {
  return THEMES[Math.floor((zone - 1) / 10) % THEMES.length];
}

/** Deterministic mob for (zone, index) so the same spot always spawns the same thing. */
export function makeMob(zone, index) {
  const theme = themeForZone(zone);
  const boss = isBossZone(zone);

  if (boss) {
    // The last one is a different animal: far more health, hits appreciably harder, and
    // swings faster than anything before it.
    //
    // His damage came down from x1.42 and his health from x5.8, and the reason is worth
    // recording because it is not "he was too hard". Measured across eight builds that
    // each marched to zone 99 honestly (tools/p2-king.mjs), the fight was bimodal: three
    // builds won 12 times out of 12 and five lost 12 out of 12, with nothing in between
    // and no relationship to damage -- the highest-throughput build in the study, at
    // 25,856 damage per second, lost every attempt while one doing 8,246 won every one.
    //
    // What separated them was health per second returned to the PLAYER, and at x1.42 the
    // threshold sat so high that only a continuous leech stream could clear it. Granting
    // a losing build 15% leech -- around 3,000 health a second -- still lost, because
    // healing arrives in lumps that overheal while his swings arrive on a metronome.
    // Scaling his health instead did nothing at all: at x0.25 health the builds that
    // could not survive him still could not survive him.
    //
    // So the lever is his damage, and only his damage. x0.72 moves the median attempt
    // from stripping 15-35% of him to stripping 50-100%, which is the difference between
    // a loss that tells you nothing and a loss that tells you to go and get more gear.
    // The health cut is smaller and does a different job: it keeps the fight from
    // turning into a nine-minute war of attrition now that more builds can survive it.
    if (zone === FINAL_ZONE) {
      // Divided back out of the phase shape on purpose. The shape exists to make the
      // last twenty zones examine a finished build, and it multiplies mobHp, which
      // bossHp is four times -- so adding it silently made the King 1.55x tougher as a
      // side effect of a change aimed at trash. He is 5.3 x bossHp because that number
      // was measured in Phase 4, and if it should move it should move because someone
      // measured him again, not because the approach to him got steeper.
      const kingHp = Math.round((bossHp(zone) / phaseShape(zone)) * 5.3);
      return {
        name: 'The Hollow King', color: '#2a2038', boss: true, final: true, zone,
        maxHp: kingHp, hp: kingHp,
        ap: mobAp(zone) * 1.48,
        armor: mobArmor(zone) * 1.7,
        swingTime: 1.8,
        xp: zoneXp(zone) * 40,
      };
    }
    const [name, color] = BOSS_NAMES[(Math.floor(zone / 5) - 1) % BOSS_NAMES.length];
    return {
      name, color, boss: true, zone,
      maxHp: bossHp(zone), hp: bossHp(zone),
      ap: mobAp(zone) * 0.6,
      armor: mobArmor(zone) * 1.4,
      swingTime: 2.2,
      xp: zoneXp(zone) * 12,
    };
  }

  const [name, color] = theme.mobs[index % theme.mobs.length];
  return {
    name, color, boss: false, zone,
    maxHp: mobHp(zone), hp: mobHp(zone),
    ap: mobAp(zone),
    armor: mobArmor(zone),
    swingTime: 2.6,
    xp: zoneXp(zone),
  };
}

// --- Scaling curves. Progression is meant to be SLOW: clearing a zone should take
// --- real time, and a boss should be a wall you gear up for, not one you walk through.
// Derived, not guessed: tools/curve.mjs measures real player DPS at the level the XP
// economy actually puts you at in zone z, fits it, and multiplies by a target
// time-to-kill of (7 + 1.3z) seconds. Re-run that tool after changing class damage,
// the XP curve, or gear budgets -- an exponential curve here WILL outrun the player.
// Refitted after crit and haste were cut back hard. Player damage fell across the
// board, and a curve fitted to the old percentages left a level-N character at zone N
// unable to clear anything: the worst checkpoint measured 3 kills per five minutes, and
// a character that fell behind could never climb out -- one simulated warlock died 252
// times in six hours without gaining a level, because dying costs the XP that would
// have let it stop dying. Health down 20%, mob damage down 15%, measured at level == zone
// which is the pairing the XP curve actually produces.
/**
 * Early zones are held back so the opening is a fight rather than a blur.
 *
 * The fitted curve had zone 1 dying in 6.9 seconds and zone 3 in 9.5, which meant the
 * first several zones went past before you had talents (level 5), a full rotation, or
 * any gear worth comparing -- the stretch where you are supposed to be learning what
 * your character does was the stretch you could not see. The multiplier is 2.1x at zone
 * 1 and decays to nothing by zone 12, so it slows the opening WITHOUT touching the
 * tuned mid and late game. It scales mob health, not damage, so a lucky early drop
 * still cuts straight through it -- getting handed something good should still feel
 * like getting away with something.
 */
const earlyPad = (z) => 1 + 1.1 * Math.exp(-(z - 1) / 3.5);

/**
 * The march has phases, and until now the difficulty curve did not know about them.
 *
 * Measured over 300 faithful marches, a fight costs a share of the health bar that runs
 * 16% at zone 3, peaks at 33% around zone 38, and falls to 11% by zone 93. Rest between
 * pulls returns a flat 10%, so the twenties and thirties net about -20% of the character
 * per fight -- five fights to a death against ten fights to a zone -- while the eighties
 * net about -1% and cannot threaten anyone. The game was hardest where the player's
 * toolkit was smallest and harmless once it was finished.
 *
 * The cause is not that midgame enemies hit hard; incoming is 9-37 per second there
 * against 341 at the end. A fight's cost is its RATE multiplied by its LENGTH, and
 * length peaked at 20.5 seconds exactly where the health pool was still small.
 *
 * Bending the depth exponent instead of shaping it was tried first and rejected: at
 * 1.78 it cut enemy health to 0.58x by zone 100 as well, which was never wanted, and
 * the whole game finished at 100% in three hours on three deaths. This leaves the curve
 * alone and multiplies it by the phase structure:
 *
 *   1-10    Establishment   1.00  unchanged; the player is learning
 *   11-20   ramp            ->0.66
 *   21-60   Development     0.66  this was the wall, and is now the flattest stretch
 *   61-80   Power           ->1.00 the character comes together and pulls ahead
 *   81-100  Final Test      ->1.55 the last stretch examines what was built
 *
 * Net cost per fight goes from -20% / -1% to roughly -10% throughout, and fight length
 * from 20.5s-down-to-4s to a band of 8-15s. Tuned against cost per fight rather than
 * duration, because duration is unreachable as an objective -- player damage grows 645x
 * across a march, so a fifteen-second midgame and a sixteen-second endgame together
 * would need 192,000-health trash. See tools/p5-curve.mjs.
 */
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
export const phaseShape = (z) => (
  z <= 10 ? 1.0
    : z <= 20 ? lerp(1.0, 0.66, (z - 10) / 10)
      : z <= 60 ? 0.66
        : z <= 80 ? lerp(0.66, 1.0, (z - 60) / 20)
          : lerp(1.0, 1.55, (z - 80) / 20));

export const mobHp    = (z) =>
  Math.round((37.6 * Math.pow(z, 0.907) + 6.99 * Math.pow(z, 1.907)) * earlyPad(z) * phaseShape(z));
export const bossHp   = (z) => Math.round(mobHp(z) * 4);
// Linear mob damage could not keep up with what a capped character actually becomes.
// Player health and armour both grow with item level AND with rarity, and rarity
// improves with depth, so they compound -- a level 60 character reaches ~15,000 health
// and ~3,900 armour while a linear curve put zone 100 at 276 attack power. The Hollow
// King landed 71 damage a swing, 0.47% of your health, and passive regeneration
// replaced 96% of its entire output. 114 of 120 endgame builds beat it at 97-100%
// health, including deliberately terrible ones.
//
// The extra term is zero below zone 20 so the tuned mid-game is untouched, and takes
// over past it: zone 40 is 1.4x the old damage, zone 60 is 2.2x, zone 100 is 4.3x.
// Deliberately MILD, because the real fix was armour: mitigation sat at 73% and rising
// at depth, and correcting that alone already took the Hollow King from 114 wins in 120
// down to 41. A steep curve here stacked on top and made zones 40+ both lethal and
// unplayably slow -- 0 to 1 kills in five minutes. Zone 40 is now barely changed from
// the old curve; zone 100 is about 2x. Re-measure with tools/threat.mjs.
// Base damage is close to where it started. It was raised 2.4x when a mob hit measured
// only 1.7-5.5% of a current character's health -- but the item budget curve was reshaped
// afterwards, which cut how much gear a character carries, and the two stacked: 106 of 120
// sweep runs ran out of lives, most of them by zone 10. What survives from that pass is the
// DEPTH term below, which was the part that actually needed fixing. Original curve with gear
// that matched the walk in: one mob hit was 1.7-5.5% of a current character's health
// and deaths were essentially zero at EVERY zone. A zone is meant to be ten mobs on one
// health bar with only a sip of healing between them; at 3% a hit that is not attrition,
// it is a formality. Difficulty had collapsed into a single question -- is your gear
// current or not -- with nothing in between.
export const mobAp    = (z) => 8.6 + 3.05 * (z - 1) + 0.16 * Math.pow(Math.max(0, z - 20), 2.05);
export const mobArmor = (z) => 6 + 3.2 * (z - 1);
export const zoneXp   = (z) => Math.round(12 * Math.pow(1.18, z - 1));

/** XP needed to go from `level` to `level + 1`. */
/**
 * Level cap. Past 60 there are no more levels to chase, which is the point: the last
 * stretch of the game is gear, set pieces and embers, all of which are things you go
 * and get rather than things that arrive on a timer.
 */
export const MAX_LEVEL = 60;
export const atMaxLevel = (level) => level >= MAX_LEVEL;

export const xpToNext = (level) =>
  level >= MAX_LEVEL ? Infinity : Math.round(55 * Math.pow(1.33, level - 1));
