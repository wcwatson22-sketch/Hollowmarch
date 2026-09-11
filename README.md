# Hollowmarch

A 2D side-on pixel auto-battler. Pick a class, and your character fights on its own
through zones of mobs; you shape the run by choosing which abilities are in the
rotation, which gear you equip, and where your talent points go.

## Shipping to iOS

```bash
npm install
npm run build          # regenerates assets/ and assembles www/
npx cap add ios        # first time only; ios/ is generated, not committed
npm run cap:ios        # sync + generate icons + open Xcode
```

`codemagic.yaml` does all of that on a build machine and uploads to TestFlight. Before the
first run, in the Codemagic UI: add an App Store Connect API key named `codemagic`, and
set `APP_STORE_APPLE_ID` in the workflow to the numeric Apple ID of the app record. The
bundle id is `com.clearpathdigital.hollowmarch`.

`ios/` and `www/` are both generated and both gitignored, so the native project can never
drift out of step with `capacitor.config.json`, and the shipped web root can never go
stale relative to the source.

The icon and launch image are **generated from code** (`tools/make-assets.mjs`, a small
PNG encoder over `zlib`) rather than checked in as binaries — reproducible, diffable, and
regenerable at any size, which keeps the project's no-build-step, no-dependencies shape.

## On a phone

The desktop build is a page you scroll. That is the wrong shape for a phone: at 375x812
the document came out **1296px tall**, so the moment you opened your bags the fight
scrolled off the top and you were making gear decisions blind — in a game whose whole
premise is that you are watching. `css/mobile.css` is a single `max-width: 760px` block
that rebuilds the layout without touching the desktop one.

- **Nothing scrolls but the panel.** The screen is a fixed column: fight, health, stats,
  meter, then a panel that takes what is left and scrolls inside itself, then a
  thumb-reachable bottom bar. Safe-area insets throughout for the notch and home
  indicator; no zoom, no selection, no rubber-banding.
- **The fight is the screen.** The renderer **cover-fills** its canvas rather than
  scaling by width alone (see `resize()` in `js/ui/render.js`), so the scene grows into
  whatever height the layout gives it instead of being locked to a 720x380 strip. The
  overflow is trimmed off the sides, which is empty scenery — the player stands at x=132,
  the companion at 300 and the enemy at 578, all well inside the crop.
- **The scene stands down when you are not watching it.** Opening the Character sheet
  hides the canvas and hands the panel its height — worth about 200px, the difference
  between a panel you scroll constantly and one you can read.
- **Play is the fight; Character is everything about the character.** Bags, equipped,
  companion, talents and the run controls all live on the sheet, beside the gear they
  are decisions about. A drop is a one-line nudge over the sky that fades in three
  seconds and opens the sheet if you tap it — it used to be a card with Equip / Sell /
  Keep on it, occupying a third of the screen and putting a three-way decision in front
  of the fight.
- **Tap to read.** Every stat, affix and talent grant carries an explanation in a
  `title`, which a touch device never shows — so on a phone all of that writing was
  invisible. Tapping anything explanatory opens it in a panel instead.

## Run it

```bash
node Hollowmarch/server.js
```

Then open <http://localhost:5173>. No build step, no dependencies — plain ES modules.

## Design rules currently implemented

**Zones.** A "level" is a zone, not a character level. Zones 1–9 hold 10 mobs each;
every 10th zone is a single boss.

**There is a front door.** The game opens on a menu: Continue (with a card showing the
character, level, zone, checkpoint, gold and companion form), New Character, and Delete.
Resuming used to happen automatically on load, which meant the only route to a new
character was to destroy the old one first. In-fight there is **Save** and **Save &
Quit**; leaving stops the simulation and the render loop rather than leaving them running
behind the menu.

**A companion in front of you actually holds the line.** What gets past your tank
depends on how much tank is left: at full companion health roughly a tenth of a swing
finds you, climbing as it is worn down and reaching the full cleave as it drops. It used
to be a FLAT 30% of every hit regardless — a companion at full health and one a swing from
dying protected you identically, which is not what standing in front of someone means.
The damage you take is now a readout of how your companion is doing.

`CLEAVE_FLOOR` is why a healthy companion does not make you immune, and it is not
arbitrary: scaling all the way to zero was measured and broke the game the other way. A
priest, which can top its mercenary up on demand, took **0.0 deaths at every level and
every gear tier including eight zones behind** — which is meant to be fatal — while the
petless warrior died two or three times per five minutes.

**Healing is also damage.** The Atonement talent sends 12% of every heal per rank at the
enemy as holy damage. It exists because a healer that only heals is a class you leave
running rather than one you play, and because it makes heal throughput a damage stat —
which is what allowed the priest's raw healing to be cut by a third without making the
fantasy of healing feel worthless. At 5/5 it converts 60% of healing into damage, worth
about 6% of a priest's total output on a default build and more on one built for it.

**Five lives, then the character is gone.** Dying costs a life; killing a boss gives one
back, capped at five — the same beat that banks your checkpoint. Run out and the save is
deleted. Strictly finite lives do not survive contact with the measured death rate, which
would end a run inside ten minutes, so tying them to progress makes them a resource you
spend pushing and refill by actually getting somewhere. It is the only thing in the game
that deletes progress, which is what makes the other four deaths mean something.

**You can fall below your checkpoint.** A checkpoint used to be a hard floor, and that
made a stuck run permanently stuck: die in the zone you respawn into, respawn into it
again, never gain the XP or gear that would let you stop. One sweep run spent 115
simulated minutes with zero kills and 77 deaths. After three deaths with nothing killed
in between, the floor gives way and you drop back toward content you can farm.

**Death is real.** A zone is an attrition run: ten mobs on one health bar, with only a
sip of healing between pulls and a slow trickle of regeneration. Fall behind on gear and
you will die.

Dying costs three things: you go back to your checkpoint and lose the zones in between,
every equipped piece takes a point of **wear** (each point is −8% to that item, up to
−40%), and repairing costs gold. Nothing you earned is deleted — the penalty drains the
same gold economy that buys your upgrades, so a death chain forces you to stop and pay
instead of quietly ending your run. Your checkpoint only moves when you kill a boss.

**No affix rolls zero.** Every affix has a `min` — the point below which it stops being
worth an item slot. An affix reading "+0 Armor" is worse than no affix at all: it occupies
a slot, looks like a stat and does nothing. Two things produce them, so both are handled:
the budget is clamped up to the floor, AND the item rolls *fewer, bigger* affixes when the
budget cannot fill the number its rarity wants. A rare at item level 2 shows one real
affix rather than three empty ones.

**The opening is padded.**  Mob health is multiplied by 2.1x at zone 1, decaying to
nothing by zone 12. The fitted curve had zone 1 dying in **6.9 seconds** and zone 3 in
9.5, which meant the stretch where you are meant to be learning what your character does
went past before you had talents (level 5), a full rotation, or any gear worth comparing.
It scales health and not damage, so a lucky early drop still cuts straight through — being
handed something good should still feel like getting away with something. `targetTtk()` in
`tools/curve.mjs` carries the same term; change one and you must change the other or the
next refit silently undoes it.

**The opening.** You start with a class weapon and your first ability already active,
the first kill always drops, and drops stay generous for the first dozen kills before
tapering to the normal rate. Level 2 lands around 40 seconds and talents around six
minutes. This is deliberate: tools/opening.mjs measures it, because an auto-battler
where nothing is unlocked yet is a spectator sport.

**Combat.** Fully automatic. The player's only combat input is choosing which abilities
they take in; the engine fires whatever is slotted and off cooldown.

**Ten abilities, three slots.** Each class has ten, unlocking at levels 1, 2, 3, 5, 7,
9, 11, 14, 17 and 20, and you may take three. Three of ten is 120 loadouts; three of
four was four. A cap is what turns a kit into a *build*: with everything checked, every
character of a class plays identically and the talent tree only ever adds numbers.

The late unlocks are deliberately *not* upgrades. Every offensive ability in a class sits
within about 1.3x of every other on throughput-per-second-of-cooldown, so what you gain
at level 20 is a different shape — spikier, slower, an execute, a cooldown to line up —
rather than a bigger number that obsoletes level 2. An ability nobody would ever take is
dead content.

**Going alone does not empty your bar.** Companion abilities are dead weight for a build
that sent its pet away at level 5, and with only three slots that was fatal: a solo
hunter had 2 of 4 abilities worth taking and a solo priest had **1 of 4**. Every
pet-targeted ability now carries a `solo` variant that retargets it at you — Mend Pet
becomes Field Dressing, Demonic Empowerment becomes Dark Pact, Renew heals you — with
its own numbers, because buffing your whole output is worth more than buffing a
companion that is a third of it. Both builds choose from a full kit, which is the entire
point of capping the slots.

**Spells look like themselves.** Each ability carries its own colour and delivery —
fire is an orange orb, shadow a violet one, a hunter's shot is an arrow with a bright
head, Drain Life is a sustained beam that jitters along its length. Impacts flash an
expanding ring in the school's colour. Active DoTs, HoTs and buffs show as chips under
the health bars.

**Damage meter.** A continuous, cross-encounter breakdown of what is actually carrying
the build: per-ability damage, share of total, live 15-second DPS, crit rate and best
hit, with healing tracked separately.

There is exactly **one** of them, and it is always on screen, under the fight rather
than behind a tab. It used to be two — a strip below the fight and a fuller panel one tab
click away showing the same numbers — which is one meter too many; the strip absorbed
what the panel had.

Rows are vertical and share a left baseline. Laying sources out as side-by-side columns
fits more on a line, but two bars that do not start from the same edge cannot be
compared, and every name past about eight characters was truncated. Each bar's width is
its **share of total damage**, the same fact as the number printed beside it — scaling to
the top source instead meant the leader always drew a full-width bar labelled "49%".

Each row is tinted with the **same colour that ability draws in on the canvas**, so the
biggest source is identifiable without reading anything. Healing rows appear only for a
build that does any.

**Classes.**

| Class   | Companion  | Identity |
|---------|-----------|----------|
| Warrior | —         | Stuns, bleeds, execute below 25% |
| Hunter  | Wolf      | Ranged physical; the wolf is a partner you can build around |
| Priest  | Mercenary | Heals and buffs a frail tank that fights beside you |
| Warlock | Imp       | Stacked DoTs, with a demon that scales hard if you invest in it |

**Companion ascension.** The pet build's long chase, and the one reward only a pet
build can receive — which is what makes keeping the companion at level 5 a bet rather
than a tax. It cannot be bought or crafted. It drops.

| Class   | Form 1 | Form 2 (Zone 8+) | Form 3 (Zone 25+) |
|---------|--------|------------------|-------------------|
| Hunter  | Wolf | Dire Wolf | Ashfang |
| Warlock | Imp | Voidfiend | Dreadlord |
| Priest  | Mercenary | Vanguard | Champion |

Relative to the starting companion, form 2 is **+22% damage / +40% health / +35%
armour** and form 3 is **+45% / +85% / +70%**. They multiply into the class's base
companion, so every pet talent and Bond affix you already own scales up with the new
form rather than being replaced by it.

The ramp leans deliberately toward *surviving* rather than killing. Damage gains are
what warp the clear-speed curve the mob-HP fit is built on, and an earlier +45%/+95%
damage ramp measured out at **+59% total DPS** with a pet-spec priest taking **68%** of
its own damage — a character watching itself play. At the shipped numbers a fully
ascended pet build gains **+23% to +28% total DPS**, and the companion's share of it
goes from 17–49% to 35–60% depending on class. Re-measure with
`node tools/sources.mjs --form=2`.

What sells it is the **silhouette**: the wolf becomes a bigger animal with a spiked mane
and a heavier jaw, the imp becomes a horned thing with a wingspan, and the priest's
sellsword finally buys plate (re-using the gear art, so no second body grid). A recolour
would not read from across the viewport.

Bosses carry most of the chance and trash carries a sliver of it, because an ascension
that lands out of nowhere mid-pull is the moment people tell each other about. The boss
chance **climbs with every boss that comes up empty**, so it still feels lucky but a run
cannot dead-end on it forever. `tools/ascend.mjs` walks the real kill stream through the
real roll: the first ascension lands at a **median of zone 20** (0.8% of runs miss it
inside 60 zones), the apex at a **median of zone 43** with **42% never seeing it** —
a trophy, not a milestone. **38%** arrive off a trash mob.

Two zone gates keep luck from arriving before it means anything: form 2 cannot drop
before zone 8, form 3 before zone 25. The gate reads your *deepest* zone rather than
your current one, so being knocked back to a checkpoint does not revoke a chance you
had already earned.

**The level cap is 60, and the march ends at zone 100.** Levelling stops at 60, which
the XP curve reaches around zone 94 — so the last stretch is gear, set pieces and embers
rather than a number going up on a timer. Zone 100 holds **The Hollow King**: 3.4x a
normal boss's health, hitting nearly twice as hard and swinging faster. Beating it is
meant to require a build that was actually constructed, not a character that merely
arrived.

**Three branches per class, and they are playstyles.** Warrior: Bleed / Thorns / Shouts.
Hunter: Ranger / Assassin / Pack. Priest: Holy / Shadow / Faith. Warlock: Fire / Shadow /
Demonology. Four talents each plus a Mastery tier. The old trees were six stat talents and
some ability potency, which meant every character of a class was the same character with
slightly different percentages — so **per-damage-type bonuses** now exist (fire, shadow,
bleed, poison, holy, arcane, physical) and every ability carries a type. A Fire warlock
and a Shadow warlock spend their points on genuinely different multipliers. Thorns needed
its own mechanic: damage reflected at whatever hits you, which is the one build that wants
to be attacked.

**Set pieces look like a set.** A legendary is painted in its SET's palette rather than
its armour type's — Gorewrought is cold iron and blood, Venomweave dark hide and venom,
Vesperlight bleached bone and gold, Cindersoul char and ember — and carries geometry no
other rarity gets: horns off the helm, real spikes on the pauldrons, a burning core in the
chest and down the weapon. Four pieces read as an outfit instead of four separately
blackened items.

**Legendaries are set pieces with powers.** A legendary is not "a rare with more affixes".
Each is a piece of its class's set and carries a named power — Echoing (ability hits have
a 16% chance to strike again), Bloodbound (crits heal you), Cornered (+35% damage below
35% health), Unravelling (DoTs tick 25% faster), Savage, Unyielding. Two pieces turn on a
2-piece bonus and four turn on a 4-piece, both aimed at one specific branch. Their drop
rate **scales with depth** — roughly 0.04% off trash at zone 5 and 0.5% at zone 100, with
bosses at 0.7% and 6.2% — because at a flat rate a four-piece set was not a hard chase, it
was arithmetically out of reach.

**An amulet slot** carries *Potency*, which raises ability damage and rolls nowhere else,
so there is a piece you chase to make the three things you cast hit harder rather than to
make your character bigger.

**Drain Life feeds both of you.** The healing is split between caster and companion,
with the larger share (60%) going to whichever is worse off and the rest to the other. It
used to send all of it to the caster, which meant a warlock topped itself up while its
demon bled out in front of it — and the demon dying is precisely what puts the warlock in
danger, since what gets past a companion scales with how hurt it is. The old behaviour
worked against the class it belonged to. Going alone sends the whole amount to you.

**Your rotation is continuous.** Cooldowns do not reset between pulls. They used to, and
since that reset ran after every kill AND on every revive, every ability came off cooldown
at the same instant and fired together — a burst of damage at the start of each fight and,
most visibly, the moment you respawned. It also made cooldown length nearly meaningless: a
16-second ability was available every pull just like a 6-second one, so the long heavy
abilities were strictly better and haste's cooldown reduction did far less than it should.
The same carry-over applies on level-up and on a companion ascension — your character
changing is not a reason to be handed a free rotation.

**Gear is judged on damage AND survival.** Every drop shows two deltas: what it does to
your damage per second, and what it does to how long you last under sustained pressure in
the zone you are standing in. Damage alone is half an answer — a piece can be a clear
damage upgrade and still get you killed, and before this the stat that saves you was
invisible next to a confident "+12% dps". `estimateSurvival()` lives in `combat.js`
rather than `stats.js` because it models damage TAKEN, and every piece of that model —
mitigation, the cleave curve, regeneration, what the companion absorbs — is defined there;
keeping it beside them means it cannot drift out of agreement with the combat it predicts.

The damage verdict is the estimated change to **your**
damage per second — `estimateDps()` re-derives the whole stat block with the piece swapped
in and asks what this build's damage does, accounting for the three abilities you have
slotted, your crit and haste, your damage-type bonuses and your companion. It used to
compare a flat item score, which cheerfully told a damage-over-time build that a crit
amulet was a sidegrade. The bag is sorted by it too.

**Ratings on gear, percentages on the dashboard.** Crit and Haste roll on items as
flat *ratings* and convert to a percentage against your level. A percentage printed on an
item is a lie the moment you gain a level; a rating is honest that the same number is
worth less as content scales, and it makes two pieces directly comparable.

The conversion is `pct = CAP * (1 - exp(-R / K))` — near-linear while your rating is
small, flattening hard near the cap, so the first 10% is cheap and the last 10% is a build
you had to construct. Caps are 85% crit and 62% haste.

The first attempt used a hyperbolic `R / (R + K(level))` and `tools/ratings.mjs` caught it
immediately: it **saturated at low rating**, so a level 5 character already sat at 32.8%
crit and 26.7% haste, and the entire run from level 5 to 60 moved crit only from 33% to
47%. Percentages were effectively decided at character creation. Base crit/haste growth
per level was the other half of the problem — at 0.002–0.004 a level it handed a level 60
character 12–24% of each before a single item.

Where it lands now: **level 5 typical gear is 7.6% crit and 3.6% haste**; level 20 is
18.9% / 10.6%; and **75% crit and 50%+ haste only at level 60 in farmed best-in-slot**.
The dashboard tells you what the next 1% would cost. Re-measure with `tools/ratings.mjs`
after touching any of it.

**Haste does three things.** It speeds your auto-attack, shortens **every** ability
cooldown, and makes your damage-over-time effects tick faster (same total damage,
delivered sooner). It does not speed up your companion. Previously it moved auto-attacks
and nothing else, which made it close to a dead stat for any class whose damage came out
of abilities — a warlock wearing haste was wearing nothing.

**Damage-over-time effects can crit, but only if you take the talent.** They could not
crit at all, which meant crit rating did nothing whatsoever for a DoT build and flat
+dotDmg talents were its only scaling — the reason putting points into them felt like
putting points into nothing. Each DoT class now has a talent (Pandemic, Blood Frenzy,
Lethal Doses, Twisted Faith) granting +20% per rank of *your crit chance* to ticks. It
multiplies your crit rather than replacing it, so taking it is what makes crit gear start
mattering to you.

**Damage numbers are colour-coded by type.** Physical white, bleeds dark red, fire
orange, poison green, shadow purple, holy pale gold — and any crit is gold and bold. A
screen of identical white numbers is unreadable at four hits a second and hides the one
thing you want to see: whether the build you are running is the one doing the work. Ticks
are smaller and fade faster so they never queue up in front of the hits that matter.

**Wayside encounters replace the camp.** The camp was a permanent panel holding an
enchanter and a quartermaster — two shop UIs sitting on a tab whether or not you cared.
The same services now *happen* to you: an unclaimed chest, a merchant on the road, or an
enchanter at a crossroads. Off an ordinary kill they are rare (1.8%, with a 12-kill
cooldown so they cannot cluster); **after a boss, one of the three is guaranteed**, so a
set-piece always pays out twice.

**Bosses never drop junk.** Rare is the floor on a boss drop. Handing back a grey after a
zone spent reaching it is an anticlimax the fight cannot pay for.

**The first respec is free.** Talents are the decision you make with the least
information — you choose at level 5, before seeing a single one resolve. Charging for the
correction taxes the player for the game's own opacity, and in practice people stop
experimenting rather than pay. Every respec after the first still escalates.

**Embers matter now.** They were a flat 0.01% each, so 36 of them — most of an hour's
attention — came to +0.36%, which is nothing you could feel. They now follow a
diminishing curve to a +35% asymptote: 36 embers is **+11.5%**, 84 is +21%. Diminishing
rather than flat because at one ember every ~26 seconds a linear rate would run into the
hundreds of percent over a long session.

**Death takes a beat.** Three seconds face-down with the screen dimmed before the march
resumes, instead of a log line and an instantly respawned mob.

**Levelling says what it gave you.** Each level-up logs the actual stat gains rather than
just announcing the number.

Every affix, trinket talent grant, and **dashboard stat** carries a tooltip saying what
it actually does — "+31 Armor" is a number, not information, until you know
armour is worth less the deeper you go. Trinkets are the sharpest case: one grants ranks
in a *named* talent ("+2 Soul Leech"), which may sit in a tree you have never opened, so
the item quotes that talent's own description and notes that these ranks can push it past
its normal 5/5 cap.

**Gear is visible on your character.** Helmet, shoulders, chest, gloves, legs, boots and
weapon all render on the sprite, each keyed to the item's own noun — a Robe looks like a
robe, a Barbute like a barbute, a Longbow like a longbow. 41 armour nouns and 16 weapons
each have their own silhouette.

Rarity is **not** a colour wash. It moves the piece along a *material ramp* — plain iron
and undyed wool at the bottom, blackened steel with gold filigree at the top — and from
rare upward the piece grows **ornaments**: spikes on pauldrons, crests and horns on
helms, gems in pommels. A legendary reads as *made better*, not painted differently,
which is how Diablo signals power without turning the character into a swatch.

**Armour types.** Warriors wear plate, hunters leather, priests and warlocks cloth —
and it is not just a label. Each type has its own noun list (a warrior never loots a
Robe), its own material colour (cold steel, warm leather, soft cloth) and its own
silhouette: plate overhangs the body with heavy pauldrons and full helms, leather is
trim and hooded, cloth falls past the knees. You can tell the classes apart at a glance
without reading a single stat.

**Trinkets** are not stat sticks. One trinket slot; each grants ranks directly to a
*specific* talent ("+2 Deep Wounds") on top of whatever you allocated, and can push a
talent past its normal cap — 5/5 plus a +2 trinket is 7/5, with the effect scaling to
the full number. It also pours its entire stat budget into a single affix. Because the
ranks are granted rather than loaned, unequipping one can never leave you over-spent.

**Gear.** Eight slots, five rarities, random affixes from a class-appropriate pool
(weapon names follow the class, so a warrior never loots a longbow). A drop raises an
alert over the viewport with Equip/Sell on it, so acting on loot never means leaving the
fight.

**One place to look.** Two tabs: *Play* (loot, rotation, damage meter) and *Character*
(equipped, talents). Under the fight sits an always-visible vitals strip — power, health,
armor, crit, haste, plus any build stat that is actually non-zero — which updates in
place and flashes the delta when you equip something. The old Build and Stats panels are
gone; they were a second and third place to look for the same numbers.

**Companions are a choice, not a default.** An untalented pet supports its owner rather
than out-damaging them: on a build that skips companion talents the pet contributes
20–33% of damage and is never the top source. Pour talents and Bond affixes into it and
it climbs to 31–48% and becomes the single biggest source — and the best-performing
build in most brackets. A minion build should be something you commit to, not something
that happens to you.

Companions crit off their owner's crit. Without that, every point of crit a pet build
owned was dead weight on a third of its damage, and the build fell behind precisely
when crit began stacking up in the late game.

**Level 5: keep the companion, or go alone.** Companion classes commit permanently.
Going alone grants +20% power and +25–30% health (you no longer have a tank), and
removes companion talents from the tree and Bond affixes from the drop tables entirely —
no dead stats on your gear. `tools/solo.mjs` solves the bonus against a pet-keeping
build so neither option is a trap.

**Companion revival.** A downed companion returns at half health after 20 seconds rather than
staying dead for the rest of the fight. This was not a nicety: because boss fights run
2-5 minutes, a dead pet meant pet classes lost their companion entirely on exactly the
fights that decide progress. The warlock's imp was contributing **6%** of damage at a
zone-20 boss versus 27% in open zones. With revival plus a companion damage pass, the
companion damage now holds steady into boss fights instead of vanishing.

**Embers.** Every 18-34 seconds a glowing ember drifts into the scene for nine seconds.
Clicking it is worth a permanent +0.01% to every stat, forever. One is negligible on
purpose; catching them all is roughly +1.4% per hour played. They exist to reward being
at the screen, which is the same reason offline progression was removed.

**The Camp.** Unlocks when you bank your first checkpoint (the zone-10 boss), which is
also the point where gold has piled up with nothing to spend it on.

- *Enchanter* — scales every affix on an equipped item by +12% per rank, to +5. It
  sharpens what a piece already is rather than adding unrelated stats, so enchanting
  reinforces a build instead of blurring every item toward the same shape.
- *Quartermaster* — three boss-quality items, restocked at every new checkpoint, for
  the slot the drop tables have refused to fill.

**Talents.** Two tiers sharing one pool of points (one per level from 5).

- *Tier 1* (level 5): broad stats — crit, haste, armor, health, companion power.
- *Tier 2, "Mastery"* (level 15): per-ability specialisation — potency, cooldown
  reduction, extra DoT ticks, wider execute thresholds. This is where builds diverge.

Respec costs gold and the cost multiplies each time.

**No offline progression.** The game runs only while the tab is open and visible.
Hiding the tab halts the simulation outright rather than letting it tick along in the
background, so nothing happens that you weren't there for. Equipping gear and spending
talent points are decisions made in the moment, which is the point of removing idle.

## Balance is measured, not guessed

Four headless tools drive tuning. Re-run them after any change to class damage, the
XP curve, or gear budgets.

```bash
node tools/curve.mjs          # fit the mob HP curve to measured player DPS
node tools/tune.mjs --write   # solve dmgMult + defMult per class, write them back
node tools/balance.mjs        # class parity + time-to-progress report
node tools/boss.mjs           # boss win rates, geared vs under-geared
node tools/opening.mjs 10     # what the first 10 minutes of a new character feel like
node tools/sources.mjs        # damage share by source: default vs pet-spec vs solo
                              #   --form=2 measures a fully ascended companion
node tools/solo.mjs --write   # solve the go-alone bonus against a pet-keeping build
node tools/lethality.mjs      # deaths per 5 min at on-level / 4 behind / 8 behind gear
node tools/coverage.mjs       # how much bare body a full armour set leaves showing
node tools/ascend.mjs         # which zone each companion ascension actually lands on
node tools/ratings.mjs        # where crit and haste actually land, level 5 through 60
node tools/sweep.mjs          # 30 builds per class through real progression; outliers only
node tools/endgame.mjs        # capped characters vs zone-90 trash and the Hollow King
node tools/threat.mjs         # how dangerous each stretch of the game actually is
```

`curve.mjs` exists to prevent a specific failure. Player power grows roughly linearly
with level and item level, so **any exponential mob-HP curve eventually outruns it** and
the game becomes unwinnable — an early version reached 27 minutes per mob by zone 30.
The tool measures real DPS at the level the XP economy actually puts you at, fits it,
and derives mob HP as `fittedDps(z) × targetTtk(z)`, keeping both curves in the same
family by construction.

`tune.mjs` solves two knobs per class at once, because they interact — raising a
class's damage shortens boss fights, which flatters its survival:

- `dmgMult` → clearing-speed parity
- `defMult` → boss parity

Current state: the solver's converged spreads are **clear 1.006**, **boss 1.080**,
**trash 1.214**. Max-health spread across classes is **1.52x** (defMult 0.779–1.187),
down from **3.08x** when the warlock was pinned at the clamp floor. Over a simulated six
hours of play every class now dies between **3 and 11 times**; before these fixes the
warlock died 16 times while stalling 20 zones behind the priest, and a mid-fix run had
the hunter dying 81. Lethality sits at **0.2–1.2 deaths per 5 minutes** on-level and
**0.2–1.8** four zones behind, which is the intended shape.

Two details make this trustworthy rather than merely automated:

- **Seeded measurement.** `setLootRng` / `setCombatRng` let the tools pin both RNGs so
  every class faces identical gear luck and crit rolls. Unseeded, random gear dominated
  the variance and the solver chased it — producing multipliers as extreme as 1.54 and
  0.53 for classes that turned out to be within 6% of each other.
- **Boss parity uses a continuous metric,** not a win rate, and it is measured on the
  REAL fight with nobody made immortal: `won -> 1 + health fraction left`,
  `lost -> fraction of the boss removed`. Monotone across the win/lose boundary, so the
  solver always has a gradient, and it cannot saturate at 0% and 100% the way a win rate
  does.

  It replaces a ratio of two clocks measured with one side made immortal, which had a
  **censoring bug**: time-to-die ran against a boss held at full health, so the fight
  never ends and a class with percentage-based sustain cannot die in it. The warlock's
  Drain Life healed it for **1494% of its own max health** and the clock simply hit the
  600s cap — as it did for hunter and priest at the early checks too. A capped clock is
  not a measurement, and the solver read "did not die" as "too tanky", cutting warlock
  health every pass until it pinned the clamp floor at `defMult` 0.500: **516 max HP at
  zone 30 against the warrior's 2278**. The solver now also warns out loud when any value
  lands on a clamp bound, because that means it ran out of road rather than found an
  answer.

- **`defMult` answers to both halves of the game.** Solving it on boss fights alone
  flatters sustain. The trash term — mean health across an ordinary zone clear, divided
  down by deaths in it — is a guard rail against that, weighted 0.3 to the boss term's
  0.7. Weighting them evenly instead let them *cancel* for the hunter, whose pet tanks
  the trash (so the trash term said "cut health") while its boss score was the weakest of
  the four (so the boss term said "raise it"); it landed in the middle, walled at the
  zone-20 boss, and died **81 times** in a simulated six hours.

- **The tools play the kit a player would.** `newSave` slots the first three abilities,
  which stopped being a loadout the moment anything unlocked above level 3 — a simulated
  level 26 character was still fighting with its level 1–3 kit. Every tool now calls
  `autoSlot()`, which scores throughput per second of cooldown and keeps the best three
  (and always keeps one companion heal for a class whose pet is doing the tanking, or the
  priest drops every heal and watches its mercenary die on every pull).

Both simulation gear models mirror real accumulation (farm the zones behind you, keep
the best roll per slot, take every boss drop). Modelling a single round of on-level
drops instead measures a character nobody actually plays, and pulls the fitted HP curve
far too low.

## Layout

```
index.html            markup + panel shells
css/style.css         all styling
js/main.js            bootstrap, fixed-step game loop, UI wiring
js/data/classes.js    class stats, growth, companions, ability kits, tuning knobs
js/data/mobs.js       zones, mob/boss scaling curves, XP curve
js/data/affixes.js    slots, rarities, affix pool, item naming
js/data/talents.js    both talent tiers + respec cost
js/data/evolution.js  companion ascension ladder, gates, and drop odds
js/data/sets.js       legendary set bonuses and the powers legendaries carry
js/systems/stats.js   derived stats from class + level + gear + talents
js/systems/combat.js  the auto-battler
js/systems/loot.js    drop rolls + injectable RNG for the balance tools
js/systems/meter.js   continuous damage/healing attribution
js/systems/save.js    versioned localStorage save
js/ui/render.js       canvas renderer, cast/projectile/heal effects
tools/                headless balance tooling
```

The simulation runs on a fixed-step `setInterval`, not on animation frames, so a
browser withholding frames can't stall combat. Animation frames only draw.

## Presentation

Bodies are 48×72 drawn at 2px a cell — eighteen times the pixel count of the original
chibi grids — with real proportions, a readable face and three-tone shading. The scene
is 720×380 so three larger combatants have room to stand apart. Sprites are pre-rendered once to offscreen canvases with a **1px outline baked in**, then
blitted. Outlining cell-by-cell every frame would cost thousands of `fillRect` calls;
cached, the whole scene draws in ~0.05ms.

**Impact.** Attacks lunge the attacker forward, hits recoil the target, flash it white,
squash it, throw debris and shake the screen — all scaled to the fraction of max health
the hit removed, so a chip and a crit feel different. Deaths dissolve the sprite into
falling pixels rather than blinking it out. Damage numbers are styled by source: crits
large, gold and popped; damage-over-time ticks small and violet; companion hits smaller
than your own.

**Atmosphere.** Each zone theme carries its own sky gradient, two parallax silhouette
layers (layered sines, quantised to 2px so it stays pixel art), a fast-scrolling
foreground of tufts and rubble, a colour grade and a vignette — plus its own weather:
pollen in Greenwood, drifting ash in the Quarry, rain in the Fen, rising void motes in
Obsidian Reach.

## Art pipeline

Bodies live in `js/ui/bodies.js` as character grids — `HUMANOID` (48×72), `WOLF` (32×24),
`IMP`, `BEAST`, `BLOB` — each carrying its own cell size so they all land at a sensible
height on screen.

Every gear piece carries a `detail` list on top of its base shape: rivets, seams,
lames, belt buckles, chest lacing, hems and stoles. A numeric tone shifts the piece's
own colour (a positive value catches the light, a negative one cuts a seam or a strap),
and `'trim'` paints the armour type's accent — bright steel rivets on plate, brass
buckles on leather, gold thread on cloth. That detail pass is what separates a shaded
rectangle from a recognisable piece of armour. Gear lives in `js/ui/gear-art.js` as rectangle lists keyed by item noun,
which is far quicker to author and adjust than a full grid per piece.

Swapping in real sprite sheets means replacing `buildSprite` in `render.js` and nothing
else: positioning, impact effects, the death dissolve and the sprite cache all work off
whatever canvas it hands back.

Four things worth keeping if you redraw them by hand:

- **Proportion beats resolution.** An early draft had a torso as wide as the arm span,
  and every armoured character came out a barrel.
- **Large shapes need shading on all four edges**, not just a lit top row, or plate
  reads as a flat slab.
- **Headgear must be wider than the skull.** The head spans cols 14-33; a helm drawn
  any narrower leaves hair poking out either side and looks like a hat balanced on top.
- **Chest pieces have to include sleeve rects.** The torso and the arms are separate
  columns of the body grid, so covering only the torso leaves both sleeves showing in
  the class colour and the armour never looks worn. `node tools/coverage.mjs` reports
  the percentage of garment cells a full set leaves bare — it should be 0%.

## Not built yet

Dungeons and set pieces, a rogue class, vendors, inventory caps, and any server-side
save. The save is versioned (`hollowmarch.save.v2`) so those can be migrated in rather
than wiping characters.
