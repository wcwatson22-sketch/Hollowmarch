// How rare is an ascension, actually?
//
// "Rare" is a feeling, and feelings are how you end up with a drop nobody ever sees.
// This walks the real kill stream -- 10 trash a zone, a boss every tenth zone -- through
// the real roll and reports the zone each form actually lands on.
//
//   node tools/ascend.mjs [runs]

import { rollAscension, applyAscension, formsFor, FORMS } from '../js/data/evolution.js';
import { MOBS_PER_ZONE, isBossZone } from '../js/data/mobs.js';

const RUNS = Number(process.argv[2] || 20000);
const MAX_ZONE = 60;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(seed) {
  const rng = mulberry32(seed);
  const save = {
    classId: 'hunter', petChoice: 'pet', petForm: 0, petAscendMisses: 0,
    zone: 1, highestZone: 1,
  };
  const at = [];
  for (let zone = 1; zone <= MAX_ZONE; zone++) {
    save.zone = zone;
    save.highestZone = Math.max(save.highestZone, zone);
    const boss = isBossZone(zone);
    const kills = boss ? 1 : MOBS_PER_ZONE;
    for (let k = 0; k < kills; k++) {
      if (rollAscension(save, boss, rng)) { applyAscension(save); at.push(zone); }
    }
  }
  return at;
}

const first = [], second = [];
let neverFirst = 0, neverSecond = 0;
for (let i = 0; i < RUNS; i++) {
  const at = run(i * 7919 + 13);
  if (at[0] != null) first.push(at[0]); else neverFirst++;
  if (at[1] != null) second.push(at[1]); else neverSecond++;
}

const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)] : NaN);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);

const forms = FORMS.hunter;
console.log(`${RUNS} runs, ${MAX_ZONE} zones each\n`);
for (const [label, arr, never, form] of [
  ['form 2 (' + forms[1].name + ')', first, neverFirst, forms[1]],
  ['form 3 (' + forms[2].name + ')', second, neverSecond, forms[2]],
]) {
  console.log(
    label.padEnd(22) +
    `gate z${String(form.minZone).padStart(2)}  ` +
    `median z${String(pct(arr, 0.5)).padStart(2)}  ` +
    `p10 z${String(pct(arr, 0.1)).padStart(2)}  p90 z${String(pct(arr, 0.9)).padStart(2)}  ` +
    `mean z${mean(arr).toFixed(1).padStart(4)}  ` +
    `never (in ${MAX_ZONE}z): ${(never / RUNS * 100).toFixed(1)}%`
  );
}

// What share of ascensions come out of nowhere on a trash mob rather than a boss?
let trash = 0, total = 0;
for (let i = 0; i < RUNS; i++) {
  for (const z of run(i * 104729 + 7)) { total++; if (!isBossZone(z)) trash++; }
}
console.log(`\nfrom trash: ${(trash / total * 100).toFixed(1)}%   from bosses: ${(100 - trash / total * 100).toFixed(1)}%`);
