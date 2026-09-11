// Continuous damage/healing meter, attributed by source.
//
// Runs across encounters rather than per-fight, so it answers "what is actually
// carrying my build" instead of "what happened to that one rat". Lifetime totals are
// aggregated per source; a bounded ring buffer backs the rolling-window DPS readout.

const WINDOW_SECONDS = 15;

export class Meter {
  constructor() {
    this.reset();
  }

  reset() {
    this.sources = new Map();  // name -> { damage, healing, hits, crits, best }
    this.recent = [];          // [{ t, amount }] within WINDOW_SECONDS, damage only
    this.elapsed = 0;
    this.totalDamage = 0;
    this.totalHealing = 0;
  }

  /** Advance the clock. Combat time only -- paused time must not dilute DPS. */
  tick(dt) {
    this.elapsed += dt;
    const cutoff = this.elapsed - WINDOW_SECONDS;
    let drop = 0;
    while (drop < this.recent.length && this.recent[drop].t < cutoff) drop++;
    if (drop) this.recent.splice(0, drop);
  }

  entry(name) {
    let e = this.sources.get(name);
    if (!e) {
      e = { name, damage: 0, healing: 0, hits: 0, crits: 0, best: 0 };
      this.sources.set(name, e);
    }
    return e;
  }

  addDamage(name, amount, crit) {
    if (!name || !(amount > 0)) return;
    const e = this.entry(name);
    e.damage += amount;
    e.hits++;
    if (crit) e.crits++;
    if (amount > e.best) e.best = amount;
    this.totalDamage += amount;
    this.recent.push({ t: this.elapsed, amount });
  }

  addHealing(name, amount) {
    if (!name || !(amount > 0)) return;
    const e = this.entry(name);
    e.healing += amount;
    e.hits++;
    this.totalHealing += amount;
  }

  get dps() {
    return this.elapsed > 0 ? this.totalDamage / this.elapsed : 0;
  }

  /** DPS over the last WINDOW_SECONDS -- what the build is doing *right now*. */
  get liveDps() {
    if (this.recent.length === 0) return 0;
    const span = Math.min(this.elapsed, WINDOW_SECONDS);
    if (span <= 0) return 0;
    return this.recent.reduce((a, r) => a + r.amount, 0) / span;
  }

  /** Rows sorted by damage, with share-of-total for bar widths. */
  breakdown() {
    const rows = [...this.sources.values()]
      .filter((e) => e.damage > 0)
      .sort((a, b) => b.damage - a.damage);
    const top = rows[0]?.damage || 1;
    return rows.map((e) => ({
      ...e,
      share: this.totalDamage > 0 ? e.damage / this.totalDamage : 0,
      barPct: (e.damage / top) * 100,
      dps: this.elapsed > 0 ? e.damage / this.elapsed : 0,
      critPct: e.hits > 0 ? e.crits / e.hits : 0,
    }));
  }

  healingBreakdown() {
    const rows = [...this.sources.values()]
      .filter((e) => e.healing > 0)
      .sort((a, b) => b.healing - a.healing);
    const top = rows[0]?.healing || 1;
    return rows.map((e) => ({
      ...e,
      share: this.totalHealing > 0 ? e.healing / this.totalHealing : 0,
      barPct: (e.healing / top) * 100,
      hps: this.elapsed > 0 ? e.healing / this.elapsed : 0,
    }));
  }
}
