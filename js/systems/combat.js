// The auto-battler. The player never issues commands mid-fight; they only choose
// which abilities are toggled ON, and the engine fires them whenever they come up.
//
// Every point of damage is reported with a `source` label so the damage meter can
// attribute it, and every ability emits a `cast` event so the renderer can show it.

import { CLASSES, MAX_ACTIVE_ABILITIES } from '../data/classes.js';
import { computeStats, computeCompanion, mitigate, isSolo } from './stats.js';
import { makeMob, isBossZone, MOBS_PER_ZONE, mobAp } from '../data/mobs.js';

// Injectable for the balance tools; see setLootRng in loot.js.
let rng = Math.random;
export function setCombatRng(fn) { rng = fn || Math.random; }

// Fraction of max health recovered per second while fighting.
// Deliberately a trickle. At 0.8%/s regeneration almost exactly cancelled incoming
// damage and nothing could ever kill you, however far behind your gear was.
// Per second, as a share of max health. Kept as a share so it stays meaningful at
// every level, but small: at 0.25% it was 38 health a second on a capped character,
// which cancelled almost exactly what the final boss could deal.
export const PLAYER_REGEN = 0.0012;
export const PET_REGEN = 0.002;
// A downed companion returns after this long. Without it a pet class simply stops
// having a pet part-way through every long fight -- which is exactly the boss fights
// that decide progress -- and its companion contributes nothing when it matters most.
export const COMPANION_REVIVE = 20;
// Share of a swing that reaches the owner while a companion is tanking, at the moment
// the companion is about to drop. Without any cleave at all, pet classes were untouchable
// and only the warrior -- who tanks personally -- was ever in danger.
export const BOSS_CLEAVE = 0.42;
export const MOB_CLEAVE = 0.38;

/**
 * How much of a swing gets past the tank, given how much tank is left.
 *
 * This used to be a FLAT share: 30% of every hit reached you whether your companion was
 * at full health or one swing from dying, which is not what a tank standing in front of
 * you is supposed to mean. Now a healthy companion actually holds the line and the line
 * gives way as it is worn down -- so the damage you take is a readout of how your
 * companion is doing, and keeping it alive is the thing that keeps you alive.
 *
 * CLEAVE_FLOOR is why a healthy companion does not make you immune. Scaling all the way
 * to zero was measured and it broke the game in the other direction: a priest, which can
 * top its mercenary up on demand, took 0.0 deaths at every level and every gear tier --
 * including eight zones behind, which is supposed to be fatal -- while the petless
 * warrior was dying two or three times per five minutes. A companion in front of you
 * should absorb most of a blow, not repeal it.
 *
 * At full companion health a tenth of the swing still finds you, against the flat 30%
 * this replaced. The exponent keeps the rest quiet until the companion is genuinely hurt.
 */
export const CLEAVE_FLOOR = 0.28;

export const cleaveShare = (base, petHpFrac) => {
  const worn = Math.pow(1 - Math.max(0, Math.min(1, petHpFrac)), 1.5);
  return base * (CLEAVE_FLOOR + (1 - CLEAVE_FLOOR) * worn);
};
// Health recovered between pulls, as a fraction of max.
export const REST_HEAL = 0.10;
// Share of a drain's healing that goes to whichever of you and your companion is worse
// off; the rest goes to the other. Weighted rather than "all to the lowest" so the split
// still reads as sharing, and so a nearly-dead companion cannot swallow every drop.
export const DRAIN_MAJOR = 0.60;

/**
 * How many seconds of sustained pressure this build can take, at the zone it is standing
 * in. The survivability counterpart to estimateDps().
 *
 * It lives here rather than in stats.js because it is a model of DAMAGE TAKEN, and every
 * piece of that model -- mitigation, the cleave curve, regeneration, what the companion
 * absorbs -- is defined in this file. Keeping it beside them means it cannot drift out of
 * agreement with the combat it is predicting.
 *
 * Like estimateDps this is an estimate, not a simulation: no ability heals, no boss
 * cleave, and the companion is assumed to be sitting at 60% health, which is roughly
 * where one actually rides once a fight is under way. The shape is what matters --
 * the number is only ever read as a difference between two pieces of gear.
 */
export function estimateSurvival(save) {
  const st = computeStats(save);
  const zone = Math.max(1, save.zone || 1);

  const perHit = mitigate(mobAp(zone), st.armor, zone);
  const companion = computeCompanion(save, st);
  // A companion in front of you absorbs most of a swing; see cleaveShare.
  const share = companion ? cleaveShare(MOB_CLEAVE, 0.6) : 1;

  const incoming = (perHit * share) / 2.6;          // ordinary mobs swing every 2.6s
  const recovery = st.maxHp * PLAYER_REGEN;         // passive trickle only
  const net = incoming - recovery;

  // Out-regenerating the zone outright: report a large but finite number so two such
  // builds can still be compared by health pool.
  if (net <= 0) return 600 + st.maxHp / 100;
  return st.maxHp / net;
}

export class Encounter {
  constructor(save, onEvent) {
    this.save = save;
    this.onEvent = onEvent || (() => {});
    this.stats = computeStats(save);
    this.cls = CLASSES[save.classId];

    this.player = { hp: this.stats.maxHp, maxHp: this.stats.maxHp, swing: this.stats.swingTime };
    this.companion = computeCompanion(save, this.stats);
    this.companionReviveIn = 0;

    this.cooldowns = {};
    // Internal cooldowns for legendary powers that would otherwise fire every hit.
    this.hookReady = {};
    this.dots = [];      // on the enemy
    this.hots = [];      // on the companion
    this.buffs = [];     // { target, stat, amount, remaining }
    // Base pools, so a temporary max-health buff can be applied and removed without
    // compounding on itself every tick.
    this.basePlayerMaxHp = this.player.maxHp;
    this.baseCompanionMaxHp = this.companion ? this.companion.maxHp : 0;
    this.playerSwingTimer = this.stats.swingTime;
    this.petSwingTimer = this.companion ? this.companion.swingTime : 0;
    this.enemySwingTimer = 0;

    this.spawn();
  }

  /** Tier-2 talent effects for one ability, with safe defaults. */
  mods(id) {
    return this.stats.abilityMods[id] || {};
  }

  cooldownOf(a) {
    const cdr = Math.min(0.6, this.mods(a.id).cdr || 0); // never below 40% of base
    // Haste shortens every cooldown as well as speeding swings and DoT ticks. It used
    // to do nothing but the swings, which made it close to a dead stat for anyone whose
    // damage came out of abilities -- a warlock wearing haste was wearing nothing.
    return (a.cd * (1 - cdr)) / (1 + this.stats.haste);
  }

  spawn() {
    const zone = this.save.zone;
    this.enemy = makeMob(zone, this.save.mobsKilledInZone);
    // You arrive at a boss fresh. Trash is the attrition run; a boss is a set-piece,
    // and starting one on the dregs of a health bar made them unwinnable outright.
    if (this.enemy.boss) {
      this.player.hp = this.player.maxHp;
      if (this.companion) this.companion.hp = this.companion.maxHp;
    }
    this.enemySwingTimer = this.enemy.swingTime;
    this.enemyStun = 0;
    this.dots = [];
    this.onEvent({ type: 'spawn', mob: this.enemy });
  }

  /**
   * The ability as this character actually has it. A companion ability is retargeted
   * at the owner for a build that went alone; the id is deliberately unchanged, so
   * talents, cooldowns and the damage meter all keep pointing at the same thing.
   */
  resolve(a) {
    return a.solo && isSolo(this.save) ? { ...a, ...a.solo } : a;
  }

  activeAbilities() {
    // The cap is enforced here as well as in the UI: an older save could carry more
    // toggles than the current limit allows.
    return this.cls.abilities
      .filter((a) => this.save.level >= a.unlock && this.save.abilityToggles[a.id] !== false)
      .slice(0, MAX_ACTIVE_ABILITIES)
      .map((a) => this.resolve(a));
  }

  /**
   * Resize the health pools to match whatever max-health buffs are up. Gaining max
   * health also grants that health, the way it does everywhere else; losing it clamps.
   */
  applyMaxHpBuffs() {
    const pMax = Math.max(1, Math.round(this.basePlayerMaxHp * this.buffMult('player', 'maxHp')));
    if (pMax !== this.player.maxHp) {
      const gain = Math.max(0, pMax - this.player.maxHp);
      this.player.maxHp = pMax;
      this.player.hp = Math.max(1, Math.min(pMax, this.player.hp + gain));
    }
    if (this.companion) {
      const cMax = Math.max(1, Math.round(this.baseCompanionMaxHp * this.buffMult('pet', 'maxHp')));
      if (cMax !== this.companion.maxHp) {
        const gain = Math.max(0, cMax - this.companion.maxHp);
        this.companion.maxHp = cMax;
        // A dead companion stays dead; the revive timer owns bringing it back.
        if (this.companion.hp > 0) this.companion.hp = Math.min(cMax, this.companion.hp + gain);
      }
    }
  }

  buffMult(target, stat) {
    let m = 1;
    for (const b of this.buffs) if (b.target === target && b.stat === stat) m += b.amount;
    return m;
  }

  // --- damage helpers -------------------------------------------------------
  roll(base, { canCrit = true, mult = 1 } = {}) {
    const h = this.stats.hooks || {};
    let dmg = base * mult * this.cls.dmgMult;

    // "Cornered": the fight going badly is what turns it on.
    if (h.lastStand && this.player.hp / this.player.maxHp < 0.35) dmg *= 1 + h.lastStand;

    let crit = false;
    if (canCrit && rng() < this.stats.crit) {
      dmg *= this.stats.critDmg;
      crit = true;
      // "Bloodbound": crits feed you, but on an internal cooldown so it stays a trickle
      // rather than a wall that scales with your crit rate and health pool together.
      if (h.critHeal && (this.hookReady.critHeal || 0) <= 0) {
        this.healPlayer(this.player.maxHp * h.critHeal, 'Bloodbound');
        this.hookReady.critHeal = (this.stats.hookIcd || {}).critHeal || 0;
      }
    }
    return { dmg: mitigate(dmg, this.enemy.armor, this.enemy.zone), crit };
  }

  dealToEnemy(amount, source, crit = false, kind = 'ability', school = 'phys', id = '') {
    this.enemy.hp -= amount;
    this.onEvent({ type: 'dmg', on: 'enemy', amount, source, crit, kind, school, id });

    // "Echoing". Only direct ability hits echo -- letting ticks echo would make it a
    // damage-over-time talent by accident and swamp the log.
    const h = this.stats.hooks || {};
    if (h.echo && kind === 'ability' && rng() < h.echo) {
      const extra = amount * 0.6;
      this.enemy.hp -= extra;
      this.onEvent({
        type: 'dmg', on: 'enemy', amount: extra,
        source: source + ' (echo)', crit: false, kind: 'ability', school, id,
      });
    }
  }

  /**
   * Atonement: a share of any heal is also dealt to whatever you are fighting.
   *
   * Deliberately keyed off the FULL heal rather than the effective one, so topping up a
   * nearly-full companion is not silently worth nothing -- otherwise the talent would
   * punish you for keeping your tank healthy, which is the thing it is meant to reward.
   */
  atone(amount, source) {
    const share = this.stats.atonement || 0;
    if (share <= 0 || amount <= 0) return;
    const { dmg, crit } = this.roll(amount * share, { mult: 1 });
    this.dealToEnemy(dmg, source + ' (Atonement)', crit, 'ability', 'magic', 'atonement');
  }

  healPlayer(amount, source) {
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
    this.onEvent({ type: 'heal', on: 'player', amount: this.player.hp - before, source });
    this.atone(amount, source);
  }

  healCompanion(amount, source) {
    if (!this.companion || this.companion.hp <= 0) return;
    const before = this.companion.hp;
    this.companion.hp = Math.min(this.companion.maxHp, this.companion.hp + amount);
    this.onEvent({ type: 'heal', on: 'pet', amount: this.companion.hp - before, source });
    this.atone(amount, source);
  }

  // --- ability execution ----------------------------------------------------
  fire(a) {
    const m = this.mods(a.id);
    const potency = 1 + (m.potency || 0);
    const p = this.stats.power * this.buffMult('player', 'ap');
    const typeMult = this.stats.typeDmg[a.type] || 1;
    const aMult = this.stats.abilityDmg * potency * typeMult;

    // Tell the UI something is being cast before the numbers land.
    this.onEvent({
      type: 'cast',
      id: a.id,
      name: a.name,
      school: a.school || 'magic',
      kind: a.kind,
      target: a.kind === 'healpet' || a.kind === 'hot' || a.kind === 'buffpet' ? 'pet'
            : a.kind === 'buff' || a.kind === 'healself' || a.kind === 'hotself' ? 'player'
            : 'enemy',
    });

    switch (a.kind) {
      case 'nuke': {
        const { dmg, crit } = this.roll(p * a.coef, { mult: aMult });
        this.dealToEnemy(dmg, a.name, crit, 'ability', a.school, a.id);
        break;
      }
      case 'dot': {
        if (a.burst) {
          const { dmg, crit } = this.roll(p * a.burst, { mult: aMult });
          this.dealToEnemy(dmg, a.name, crit, 'ability', a.school, a.id);
        }
        this.dots = this.dots.filter((d) => d.id !== a.id); // refresh, don't stack
        // Haste compresses the interval rather than adding ticks, so a hasted DoT
        // delivers the same total damage sooner instead of becoming a bigger DoT.
        const quicken = (this.stats.hooks || {}).quicken || 0;
        const interval = a.tick / (1 + this.stats.haste + quicken);
        this.dots.push({
          id: a.id,
          name: a.name,
          school: a.school || 'magic',
          type: a.type || 'physical',
          remaining: a.ticks + (m.ticks || 0),
          interval,
          timer: interval,
          amount: p * a.coef * this.stats.dotDmg * this.cls.dmgMult * potency * typeMult,
        });
        break;
      }
      case 'stun': {
        const { dmg, crit } = this.roll(p * a.coef, { mult: aMult });
        this.dealToEnemy(dmg, a.name, crit, 'ability', a.school, a.id);
        this.enemyStun = Math.max(this.enemyStun, a.stun + (m.stun || 0));
        this.onEvent({ type: 'apply', label: `${a.name} — stunned`, on: 'enemy' });
        break;
      }
      case 'execute': {
        const threshold = a.threshold + (m.threshold || 0);
        const low = this.enemy.hp / this.enemy.maxHp <= threshold;
        const { dmg, crit } = this.roll(p * (low ? a.executeCoef : a.coef), { mult: aMult });
        this.dealToEnemy(dmg, a.name, crit, 'ability', a.school, a.id);
        break;
      }
      case 'drain': {
        const { dmg, crit } = this.roll(p * a.coef, { mult: aMult });
        this.dealToEnemy(dmg, a.name, crit, 'ability', a.school, a.id);

        // What you drain out is shared with whatever is fighting beside you, and the
        // larger share goes to whoever needs it more. Sending it all to the caster meant
        // a warlock topped itself up while its demon bled out in front of it -- and the
        // demon dying is what puts the warlock in danger in the first place, so the old
        // behaviour actively worked against the class it belonged to.
        const pool = dmg * a.leech;
        const pet = this.companion && this.companion.hp > 0 ? this.companion : null;
        if (!pet) {
          this.healPlayer(pool, a.name);
        } else {
          const playerFrac = this.player.hp / this.player.maxHp;
          const petFrac = pet.hp / pet.maxHp;
          const toPlayer = playerFrac <= petFrac ? DRAIN_MAJOR : 1 - DRAIN_MAJOR;
          this.healPlayer(pool * toPlayer, a.name);
          this.healCompanion(pool * (1 - toPlayer), a.name);
        }
        break;
      }
      case 'healpet': {
        this.healCompanion(p * a.coef * this.stats.healPow * potency, a.name);
        break;
      }
      case 'healself': {
        this.healPlayer(p * a.coef * this.stats.healPow * potency, a.name);
        break;
      }
      case 'hotself':
      case 'hot': {
        const onSelf = a.kind === 'hotself';
        this.hots = this.hots.filter((h) => h.id !== a.id);
        this.hots.push({
          id: a.id,
          name: a.name,
          remaining: a.ticks + (m.ticks || 0),
          interval: a.tick,
          timer: a.tick,
          amount: p * a.coef * this.stats.healPow * potency,
          onSelf,
        });
        break;
      }
      case 'buff':
      case 'buffpet': {
        const target = a.kind === 'buffpet' ? 'pet' : 'player';
        this.buffs = this.buffs.filter((b) => !(b.target === target && b.stat === a.stat));
        this.buffs.push({
          target, stat: a.stat, name: a.name,
          amount: a.amount * potency,
          remaining: a.dur,
        });
        this.onEvent({ type: 'apply', label: a.name, on: target });
        break;
      }
    }
  }

  /**
   * Damage sent back at whatever just hit you. A thorns build wants to be attacked,
   * which is the opposite of every other way of playing, so it needs its own hook
   * rather than being folded into mitigation.
   */
  reflect(label) {
    if (!this.stats.thorns) return;
    const dmg = this.stats.power * this.stats.thorns * this.cls.dmgMult;
    if (dmg <= 0) return;
    this.dealToEnemy(mitigate(dmg, this.enemy.armor, this.enemy.zone), 'Thorns', false, 'thorns', 'phys', 'thorns');
  }

  /** Should this ability fire right now? Keeps the AI legible rather than optimal. */
  shouldFire(a) {
    const m = this.mods(a.id);
    if (a.kind === 'execute') {
      const threshold = a.threshold + (m.threshold || 0);
      // Below the threshold it's a huge hit; above it, hold unless the target is close.
      return this.enemy.hp / this.enemy.maxHp <= threshold || this.enemy.hp / this.enemy.maxHp < 0.6;
    }
    if (a.kind === 'healpet') {
      return this.companion && this.companion.hp > 0 && this.companion.hp / this.companion.maxHp < 0.6;
    }
    if (a.kind === 'hot') {
      return this.companion && this.companion.hp > 0 && this.companion.hp / this.companion.maxHp < 0.9;
    }
    // Going alone means nobody else is holding the line, so hold the emergency heal
    // until it would not be wasted.
    if (a.kind === 'healself') return this.player.hp / this.player.maxHp < 0.6;
    if (a.kind === 'hotself') return this.player.hp / this.player.maxHp < 0.9;
    if (a.kind === 'buffpet' && (!this.companion || this.companion.hp <= 0)) return false;
    return true;
  }

  /** Auras currently up, for the HUD. */
  auras() {
    return {
      enemy: this.dots.map((d) => ({ name: d.name, stacks: d.remaining })),
      pet: [
        ...this.hots.filter((h) => !h.onSelf).map((h) => ({ name: h.name, stacks: h.remaining })),
        ...this.buffs.filter((b) => b.target === 'pet').map((b) => ({ name: b.name, stacks: Math.ceil(b.remaining) })),
      ],
      player: [
        ...this.hots.filter((h) => h.onSelf).map((h) => ({ name: h.name, stacks: h.remaining })),
        ...this.buffs.filter((b) => b.target === 'player').map((b) => ({ name: b.name, stacks: Math.ceil(b.remaining) })),
      ],
      stunned: this.enemyStun > 0,
    };
  }

  // --- main tick ------------------------------------------------------------
  /** @returns 'ongoing' | 'win' | 'lose' */
  tick(dt) {
    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    }
    this.enemyStun = Math.max(0, this.enemyStun - dt);
    for (const b of this.buffs) b.remaining -= dt;
    this.buffs = this.buffs.filter((b) => b.remaining > 0);

    // A downed companion claws its way back rather than being gone for the fight.
    if (this.companion && this.companion.hp <= 0) {
      this.companionReviveIn -= dt;
      if (this.companionReviveIn <= 0) {
        this.companion.hp = this.companion.maxHp * 0.5;
        this.onEvent({ type: 'petup', name: this.companion.name });
      }
    }

    // Passive sustain. Boss fights run several times longer than a trash pull, so
    // without any in-combat recovery they are unwinnable at every gear level rather
    // than merely hard. This makes a boss an attrition check you can gear past.
    if (this.player.hp > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * PLAYER_REGEN * dt);
    }
    if (this.companion && this.companion.hp > 0) {
      this.companion.hp = Math.min(this.companion.maxHp, this.companion.hp + this.companion.maxHp * PET_REGEN * dt);
    }

    // DoTs on the enemy
    for (const d of this.dots) {
      d.timer -= dt;
      while (d.timer <= 0 && d.remaining > 0) {
        // A damage-over-time tick can crit, but only for a build that has taken the
        // talent for it. Without that, crit rating did literally nothing for a DoT
        // build -- which is most of why they measured so far behind.
        const canCrit = this.stats.dotCrit > 0 && rng() < this.stats.crit * this.stats.dotCrit;
        const amount = canCrit ? d.amount * this.stats.critDmg : d.amount;
        this.dealToEnemy(
          mitigate(amount, this.enemy.armor, this.enemy.zone),
          d.name, canCrit, 'dot', d.school, d.id
        );
        d.remaining--;
        d.timer += d.interval;
      }
    }
    this.dots = this.dots.filter((d) => d.remaining > 0);

    for (const k of Object.keys(this.hookReady)) {
      if (this.hookReady[k] > 0) this.hookReady[k] -= dt;
    }

    this.applyMaxHpBuffs();

    // HoTs, on the companion or on you if you went alone.
    for (const h of this.hots) {
      h.timer -= dt;
      while (h.timer <= 0 && h.remaining > 0) {
        if (h.onSelf) this.healPlayer(h.amount, h.name);
        else this.healCompanion(h.amount, h.name);
        h.remaining--;
        h.timer += h.interval;
      }
    }
    this.hots = this.hots.filter((h) => h.remaining > 0);

    // Abilities
    for (const a of this.activeAbilities()) {
      if ((this.cooldowns[a.id] || 0) > 0) continue;
      if (!this.shouldFire(a)) continue;
      this.fire(a);
      this.cooldowns[a.id] = this.cooldownOf(a);
    }

    // Player auto-attack
    this.playerSwingTimer -= dt;
    if (this.playerSwingTimer <= 0) {
      this.playerSwingTimer += this.stats.swingTime;
      const mult = this.buffMult('player', 'ap');
      const { dmg, crit } = this.roll(this.stats.power * this.cls.autoCoef, { mult });
      const label = this.cls.autoName;
      this.onEvent({ type: 'cast', id: 'auto', name: label, school: this.cls.primary === 'sp' ? 'magic' : 'phys', kind: 'auto', target: 'enemy' });
      this.dealToEnemy(dmg, label, crit, 'auto', this.cls.primary === 'sp' ? 'magic' : 'phys', label);
    }

    // Companion auto-attack
    if (this.companion && this.companion.hp > 0) {
      this.petSwingTimer -= dt;
      if (this.petSwingTimer <= 0) {
        this.petSwingTimer += this.companion.swingTime;
        const mult = this.buffMult('pet', 'ap');
        // Companions crit off their owner's crit. Without this, every point of crit a
        // pet build owns is dead weight on a third of its damage, so the build falls
        // behind precisely when crit starts stacking up in the late game.
        const { dmg, crit } = this.roll(this.companion.ap, { mult });
        this.onEvent({ type: 'cast', id: 'pet', name: this.companion.name, school: 'phys', kind: 'pet', target: 'enemy' });
        this.dealToEnemy(dmg, this.companion.name, crit, 'pet', 'phys', 'pet');
      }
    }

    if (this.enemy.hp <= 0) return 'win';

    // Enemy attacks the companion if it's up, otherwise the player.
    if (this.enemyStun <= 0) {
      this.enemySwingTimer -= dt;
      if (this.enemySwingTimer <= 0) {
        this.enemySwingTimer += this.enemy.swingTime;
        const tank = this.companion && this.companion.hp > 0 ? 'pet' : 'player';
        if (tank === 'pet') {
          const dmg = mitigate(this.enemy.ap, this.companion.armor, this.enemy.zone);
          this.companion.hp -= dmg;
          this.onEvent({ type: 'dmg', on: 'pet', amount: dmg });
          if (this.companion.hp <= 0) {
            this.companionReviveIn = COMPANION_REVIVE;
            this.onEvent({ type: 'petdown', name: this.companion.name });
          }

          // What gets past the tank depends on how much tank is left. A companion at
          // full health takes the hit for you outright; a failing one stops covering you.
          const base = this.enemy.boss ? BOSS_CLEAVE : MOB_CLEAVE;
          const share = cleaveShare(base, this.companion.hp / this.companion.maxHp);
          const splash = mitigate(this.enemy.ap * share, this.stats.armor, this.enemy.zone);
          this.player.hp -= splash;
          this.onEvent({ type: 'dmg', on: 'player', amount: splash });
          this.reflect();
        } else {
          const dmg = mitigate(this.enemy.ap, this.stats.armor, this.enemy.zone);
          this.player.hp -= dmg;
          this.onEvent({ type: 'dmg', on: 'player', amount: dmg });
          this.reflect();
        }
      }
    }

    if (this.player.hp <= 0) return 'lose';
    return 'ongoing';
  }

  /** Called after a win, before the next spawn. Companions get back up between pulls. */
  /**
   * Between pulls. Cooldowns deliberately DO NOT reset.
   *
   * They used to, and since reset() runs after every kill and on every revive, that meant
   * every ability came off cooldown at the same instant and fired together -- a visible
   * burst of damage at the start of each fight and, most obviously, the moment you
   * respawned. It also made cooldown length nearly meaningless: a 16-second ability was
   * available every pull just like a 6-second one, so the long, heavy abilities were
   * strictly better and haste's cooldown reduction did far less than it should.
   *
   * The fight is continuous. Your rotation should be too.
   */
  reset() {
    this.hots = [];
    this.buffs = [];
    if (this.companion) this.companion.hp = this.companion.maxHp;
    this.companionReviveIn = 0;
    // Only a sip between pulls. Restoring 35% after every kill meant damage never
    // accumulated and a zone could not wear you down, so nothing was ever dangerous.
    // A zone is meant to be an attrition run: ten mobs on one health bar.
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * REST_HEAL);
  }

  /** Full reset after a wipe. */
  revive() {
    this.player.hp = this.player.maxHp;
    if (this.companion) this.companion.hp = this.companion.maxHp;
    this.reset();
  }
}

export { isBossZone, MOBS_PER_ZONE };
