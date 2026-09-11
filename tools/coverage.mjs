// Which parts of the body does a full set of armour actually cover?
//
// The garment cells (torso, sleeves, trousers, boots) are drawn in the CLASS colour.
// Anything a full set leaves uncovered shows through as bare tunic, which reads as the
// character not really wearing the armour they just equipped.
import { HUMANOID } from '../js/ui/bodies.js';
import { GEAR_LOOKS } from '../js/ui/gear-art.js';

const GARMENT = new Set(['b', 'a', 'l', 'M', 's', 'S', 'L', 'B']);

const SETS = {
  plate:   ['Helm', 'Pauldrons', 'Breastplate', 'Gauntlets', 'Greaves', 'Sabatons'],
  plate2:  ['Greathelm', 'Spaulders', 'Hauberk', 'Handguards', 'Platelegs', 'Warboots'],
  leather: ['Cowl', 'Shoulderpads', 'Jerkin', 'Gloves', 'Leggings', 'Boots'],
  leather2:['Hood', 'Mantle', 'Tunic', 'Grips', 'Chaps', 'Treads'],
  cloth:   ['Circlet', 'Amice', 'Robe', 'Mitts', 'Trousers', 'Slippers'],
  cloth2:  ['Crown', 'Shawl', 'Vestments', 'Handwraps', 'Skirt', 'Sandals'],
};

for (const [name, pieces] of Object.entries(SETS)) {
  const covered = new Set();
  for (const noun of pieces) {
    const entry = GEAR_LOOKS[noun];
    if (!entry) { console.log('  MISSING', noun); continue; }
    for (const [x, y, w, h] of entry.rects) {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) covered.add(`${x + dx},${y + dy}`);
    }
  }

  let total = 0, bare = 0;
  const rows = [];
  for (let r = 0; r < HUMANOID.length; r++) {
    let line = '';
    for (let c = 0; c < HUMANOID[r].length; c++) {
      const ch = HUMANOID[r][c];
      if (!GARMENT.has(ch)) { line += ch === '.' ? ' ' : '·'; continue; }
      total++;
      if (covered.has(`${c},${r}`)) line += '#';
      else { line += 'X'; bare++; }
    }
    rows.push(line);
  }
  console.log(`\n${name}: ${bare}/${total} garment cells bare (${((bare / total) * 100).toFixed(1)}%)`);
  if (bare > 0) {
    const shown = rows.filter((l) => l.includes('X'));
    console.log(shown.slice(0, 8).map((l) => '   ' + l.replace(/\s+$/, '')).join('\n'));
  }
}
