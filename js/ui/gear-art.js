// Visual definitions for equipped gear, drawn over the 24x32 humanoid in bodies.js.
//
// Looks are keyed by the item's NOUN, so the sprite always matches the name the loot
// table generated. Nouns are per armour type, which is what actually sells the class
// fantasy at a glance:
//
//   plate    bulky and angular, overhanging the body, full helms and heavy boots
//   leather  trimmer, hooded, belted at the waist
//   cloth    robes that fall past the knees, circlets, soft slippers
//
// Rects are [x, y, w, h] in grid cells of the 48x72 body. Landmarks:
//   head rows 1-14 (cols 14-33)   shoulders row 18 (cols 14-33)
//   arms cols 10-13 / 34-37       torso rows 18-39    hips rows 40-41
//   legs rows 42-68               boots rows 69-71
//
// Headgear MUST span cols 14-33: anything narrower leaves hair sticking out and reads
// as a hat perched on the skull rather than a helmet enclosing it.

import { CLASSES } from '../data/classes.js';

export const GEAR_LOOKS = {
  // ---- plate ----
  Helm:        { slot: 'head', rects: [[14, 1, 20, 8], [14, 9, 3, 6], [31, 9, 3, 6]], detail: [[14, 7, 20, 2, -45], [14, 1, 20, 1, 32], [16, 4, 2, 2, 'trim'], [30, 4, 2, 2, 'trim']], ornate: [[11, 1, 3, 6, 'trim'], [34, 1, 3, 6, 'trim']] },
  Barbute:     { slot: 'head', rects: [[14, 1, 20, 13], [15, 14, 5, 3], [28, 14, 5, 3]], detail: [[17, 8, 6, 2, -70], [25, 8, 6, 2, -70], [23, 6, 2, 8, -70], [14, 1, 20, 1, 32]], ornate: [[22, -3, 4, 6, 'trim']] },
  Greathelm:   { slot: 'head', rects: [[14, 0, 20, 16]], detail: [[23, 3, 2, 9, -70], [16, 8, 16, 2, -70], [14, 0, 20, 1, 32], [14, 14, 20, 1, -45]], ornate: [[16, -3, 2, 5, 'trim'], [23, -5, 2, 7, 'trim'], [30, -3, 2, 5, 'trim']] },
  Pauldrons:   { slot: 'shoulders', rects: [[8, 18, 9, 10], [31, 18, 9, 10]], detail: [[8, 22, 9, 2, -45], [31, 22, 9, 2, -45], [10, 20, 2, 2, 'trim'], [14, 20, 2, 2, 'trim'], [33, 20, 2, 2, 'trim'], [37, 20, 2, 2, 'trim']], ornate: [[9, 13, 3, 6, 'trim'], [36, 13, 3, 6, 'trim']] },
  Spaulders:   { slot: 'shoulders', rects: [[8, 18, 9, 9], [31, 18, 9, 9], [6, 21, 4, 9], [38, 21, 4, 9]], detail: [[8, 22, 9, 2, -45], [31, 22, 9, 2, -45], [6, 23, 4, 2, 'trim'], [38, 23, 4, 2, 'trim']], ornate: [[4, 16, 3, 7, 'trim'], [41, 16, 3, 7, 'trim'], [10, 14, 2, 5, 'trim'], [36, 14, 2, 5, 'trim']] },
  Breastplate: { slot: 'chest', rects: [[14, 18, 20, 23], [10, 20, 4, 15], [34, 20, 4, 15]], detail: [[22, 18, 4, 18, 34], [14, 36, 20, 3, -55], [22, 36, 4, 3, 'trim'], [15, 20, 2, 2, 'trim'], [31, 20, 2, 2, 'trim']], ornate: [[19, 15, 10, 4, 'trim'], [22, 24, 4, 4, 'trim']] },
  Cuirass:     { slot: 'chest', rects: [[14, 18, 20, 21], [10, 20, 4, 14], [34, 20, 4, 14], [16, 39, 16, 3]], detail: [[14, 23, 20, 2, -45], [14, 28, 20, 2, -45], [14, 33, 20, 2, -45], [22, 18, 4, 5, 34]], ornate: [[19, 15, 10, 4, 'trim']] },
  Hauberk:     { slot: 'chest', rects: [[14, 18, 20, 24], [10, 19, 4, 16], [34, 19, 4, 16]], detail: [[14, 22, 20, 2, -40], [14, 27, 20, 2, -40], [14, 32, 20, 2, -40], [14, 37, 20, 2, -40]], ornate: [[19, 15, 10, 4, 'trim']] },
  Gauntlets:   { slot: 'hands', rects: [[9, 30, 6, 10], [33, 30, 6, 10]], detail: [[9, 32, 6, 2, -45], [33, 32, 6, 2, -45], [10, 30, 2, 2, 'trim'], [35, 30, 2, 2, 'trim']] },
  Handguards:  { slot: 'hands', rects: [[9, 27, 6, 13], [33, 27, 6, 13]], detail: [[9, 29, 6, 2, -45], [33, 29, 6, 2, -45], [9, 36, 6, 2, -45], [33, 36, 6, 2, -45]] },
  Greaves:     { slot: 'legs', rects: [[15, 41, 18, 7], [14, 48, 9, 20], [25, 48, 9, 20]], detail: [[14, 50, 9, 3, 34], [25, 50, 9, 3, 34], [18, 55, 2, 12, -45], [29, 55, 2, 12, -45]] },
  Platelegs:   { slot: 'legs', rects: [[14, 41, 20, 10], [14, 51, 9, 18], [25, 51, 9, 18]], detail: [[14, 43, 20, 2, -55], [22, 43, 4, 2, 'trim'], [14, 59, 9, 2, -45], [25, 59, 9, 2, -45]] },
  Sabatons:    { slot: 'feet', rects: [[13, 64, 11, 8], [24, 64, 11, 8]], detail: [[13, 64, 11, 2, 34], [24, 64, 11, 2, 34], [13, 69, 11, 2, -55], [24, 69, 11, 2, -55]] },
  Warboots:    { slot: 'feet', rects: [[13, 60, 11, 12], [24, 60, 11, 12]], detail: [[13, 60, 11, 2, 34], [24, 60, 11, 2, 34], [13, 64, 11, 2, -55], [24, 64, 11, 2, -55], [13, 68, 11, 2, -55], [24, 68, 11, 2, -55]] },

  // ---- leather ----
  Cowl:         { slot: 'head', rects: [[14, 1, 20, 9], [12, 6, 3, 10], [33, 6, 3, 10]], detail: [[14, 9, 20, 1, -40], [12, 15, 3, 1, -40], [33, 15, 3, 1, -40], [16, 3, 2, 1, 'trim']], ornate: [[35, -1, 2, 8, 'trim']] },
  Coif:         { slot: 'head', rects: [[14, 1, 20, 7], [13, 5, 2, 10], [33, 5, 2, 10]], detail: [[14, 6, 20, 2, -40], [14, 1, 20, 1, 28]], ornate: [[12, 3, 2, 3, 'trim'], [34, 3, 2, 3, 'trim']] },
  Hood:         { slot: 'head', rects: [[14, 0, 20, 10], [11, 5, 4, 12], [33, 5, 4, 12]], detail: [[14, 9, 20, 1, -40], [11, 16, 4, 1, -40], [33, 16, 4, 1, -40]], ornate: [[13, 11, 4, 3, 'trim']] },
  Shoulderpads: { slot: 'shoulders', rects: [[10, 18, 7, 9], [31, 18, 7, 9]], detail: [[10, 22, 7, 2, -40], [31, 22, 7, 2, -40], [12, 20, 2, 2, 'trim'], [34, 20, 2, 2, 'trim']], ornate: [[11, 16, 2, 3, 'trim'], [36, 16, 2, 3, 'trim']] },
  Mantle:       { slot: 'shoulders', rects: [[8, 18, 11, 9], [29, 18, 11, 9], [14, 18, 20, 5]], detail: [[8, 18, 11, 2, 30], [29, 18, 11, 2, 30], [14, 22, 20, 2, -40]], ornate: [[8, 15, 4, 4, 'trim'], [36, 15, 4, 4, 'trim']] },
  Jerkin:       { slot: 'chest', rects: [[14, 18, 20, 22], [10, 20, 4, 14], [34, 20, 4, 14], [14, 40, 20, 3]], detail: [[14, 34, 20, 3, -55], [22, 34, 4, 3, 'trim'], [22, 20, 4, 12, -45]], ornate: [[19, 16, 10, 3, 'trim']] },
  Vest:         { slot: 'chest', rects: [[14, 18, 20, 23], [10, 21, 4, 12], [34, 21, 4, 12]], detail: [[14, 18, 20, 2, 30], [22, 21, 4, 17, -45], [18, 24, 2, 12, -35], [28, 24, 2, 12, -35]], ornate: [[19, 16, 10, 3, 'trim']] },
  Tunic:        { slot: 'chest', rects: [[14, 18, 20, 23], [10, 20, 4, 15], [34, 20, 4, 15], [12, 41, 24, 6]], detail: [[14, 36, 20, 3, -55], [22, 36, 4, 3, 'trim'], [12, 45, 24, 2, -40]], ornate: [[19, 16, 10, 3, 'trim']] },
  Gloves:       { slot: 'hands', rects: [[9, 32, 6, 9], [33, 32, 6, 9]], detail: [[9, 32, 6, 2, -45], [33, 32, 6, 2, -45]] },
  Grips:        { slot: 'hands', rects: [[9, 34, 6, 7], [33, 34, 6, 7]], detail: [[9, 36, 6, 2, -45], [33, 36, 6, 2, -45]] },
  Leggings:     { slot: 'legs', rects: [[14, 41, 20, 9], [15, 50, 8, 19], [25, 50, 8, 19]], detail: [[14, 43, 20, 2, -50], [22, 43, 4, 2, 'trim'], [15, 56, 8, 3, -40], [25, 56, 8, 3, -40]] },
  Chaps:        { slot: 'legs', rects: [[14, 41, 20, 7], [14, 48, 9, 21], [25, 48, 9, 21]], detail: [[14, 53, 9, 2, -50], [25, 53, 9, 2, -50], [14, 61, 9, 2, -50], [25, 61, 9, 2, -50]] },
  Boots:        { slot: 'feet', rects: [[13, 62, 11, 10], [24, 62, 11, 10]], detail: [[13, 62, 11, 2, 30], [24, 62, 11, 2, 30], [16, 66, 2, 6, -45], [27, 66, 2, 6, -45]] },
  Treads:       { slot: 'feet', rects: [[13, 66, 11, 6], [24, 66, 11, 6]], detail: [[13, 66, 11, 2, 30], [24, 66, 11, 2, 30], [13, 70, 11, 2, -50], [24, 70, 11, 2, -50]] },

  // ---- cloth ----
  Circlet:   { slot: 'head', rects: [[14, 4, 20, 2]], detail: [[22, 3, 4, 3, 'trim'], [14, 4, 20, 1, 30]], ornate: [[12, 3, 2, 3, 'trim'], [34, 3, 2, 3, 'trim']] },
  Cap:       { slot: 'head', rects: [[14, 1, 20, 5], [14, 6, 2, 4], [32, 6, 2, 4]], detail: [[14, 5, 20, 1, 'trim'], [14, 1, 20, 1, 28]], ornate: [[31, -3, 3, 7, 'trim']] },
  Crown:     { slot: 'head', rects: [[14, 3, 20, 3], [15, 0, 2, 3], [20, 0, 2, 3], [26, 0, 2, 3], [31, 0, 2, 3]], detail: [[15, 0, 2, 1, 'trim'], [20, 0, 2, 1, 'trim'], [26, 0, 2, 1, 'trim'], [31, 0, 2, 1, 'trim'], [14, 4, 20, 1, 'trim']], ornate: [[15, -3, 2, 4, 'trim'], [20, -5, 2, 6, 'trim'], [26, -5, 2, 6, 'trim'], [31, -3, 2, 4, 'trim']] },
  Amice:     { slot: 'shoulders', rects: [[10, 18, 12, 6], [26, 18, 12, 6]], detail: [[10, 22, 12, 2, 'trim'], [26, 22, 12, 2, 'trim']], ornate: [[10, 24, 2, 5, 'trim'], [36, 24, 2, 5, 'trim']] },
  Shawl:     { slot: 'shoulders', rects: [[8, 18, 12, 10], [28, 18, 12, 10], [14, 18, 20, 5]], detail: [[8, 26, 12, 2, 'trim'], [28, 26, 12, 2, 'trim'], [14, 22, 20, 2, 'trim']], ornate: [[8, 28, 2, 6, 'trim'], [38, 28, 2, 6, 'trim']] },
  Robe:      { slot: 'chest', rects: [[14, 18, 20, 23], [10, 20, 4, 16], [34, 20, 4, 16], [12, 41, 24, 16], [11, 57, 26, 15]], detail: [[20, 18, 8, 3, 'trim'], [12, 39, 24, 3, 'trim'], [11, 68, 26, 3, 'trim'], [23, 43, 2, 25, -35]], ornate: [[13, 19, 3, 4, 'trim'], [32, 19, 3, 4, 'trim']] },
  Vestments: { slot: 'chest', rects: [[14, 18, 20, 22], [10, 20, 4, 16], [34, 20, 4, 16], [12, 40, 24, 17], [12, 57, 24, 15]], detail: [[19, 18, 3, 36, 'trim'], [27, 18, 3, 36, 'trim'], [12, 68, 24, 3, 'trim']], ornate: [[13, 19, 3, 4, 'trim'], [32, 19, 3, 4, 'trim']] },
  Mitts:     { slot: 'hands', rects: [[9, 32, 6, 9], [33, 32, 6, 9]], detail: [[9, 32, 6, 2, 'trim'], [33, 32, 6, 2, 'trim']] },
  Handwraps: { slot: 'hands', rects: [[9, 34, 6, 7], [33, 34, 6, 7]], detail: [[9, 34, 6, 2, -40], [33, 34, 6, 2, -40], [9, 38, 6, 2, -40], [33, 38, 6, 2, -40]] },
  Trousers:  { slot: 'legs', rects: [[14, 41, 20, 8], [15, 49, 8, 20], [25, 49, 8, 20]], detail: [[14, 41, 20, 2, 'trim'], [15, 65, 8, 2, -45], [25, 65, 8, 2, -45]] },
  Skirt:     { slot: 'legs', rects: [[12, 41, 24, 21]], detail: [[19, 45, 2, 14, -35], [24, 45, 2, 14, -35], [29, 45, 2, 14, -35], [12, 59, 24, 3, 'trim']] },
  Slippers:  { slot: 'feet', rects: [[14, 68, 9, 4], [25, 68, 9, 4]], detail: [[14, 69, 9, 2, 'trim'], [25, 69, 9, 2, 'trim']] },
  Sandals:   { slot: 'feet', rects: [[14, 68, 9, 4], [25, 68, 9, 4], [16, 65, 6, 3], [27, 65, 6, 3]], detail: [[14, 69, 9, 2, 'trim'], [25, 69, 9, 2, 'trim'], [16, 65, 6, 2, 'trim'], [27, 65, 6, 2, 'trim']] },

  // ---- weapons, by class ----
  Blade:        { slot: 'weapon', rects: [[41, 18, 5, 30], [36, 45, 12, 5], [41, 50, 5, 8]], detail: [[42, 18, 2, 27,, 40], [36, 45, 12, 2,, 'trim'], [41, 50, 5, 8,, -55], [42, 56, 2, 2,, 'trim']], ornate: [[36, 45, 12, 2, 'trim'], [42, 55, 3, 3, 'trim']] },
  Maul:         { slot: 'weapon', rects: [[36, 17, 12, 12], [41, 27, 5, 30]], detail: [[36, 17, 12, 2,, 40], [36, 27, 12, 2,, -50], [41, 30, 5, 27,, -55]], ornate: [[36, 17, 12, 3, 'trim'], [42, 54, 3, 3, 'trim']] },
  Greatsword:   { slot: 'weapon', rects: [[41, 9, 5, 39], [36, 48, 12, 5], [41, 53, 5, 5]], detail: [[42, 9, 2, 36,, 40], [36, 48, 12, 2,, 'trim'], [41, 53, 5, 5,, -55]], ornate: [[36, 48, 12, 2, 'trim'], [42, 6, 3, 4, 'trim']] },
  Axe:          { slot: 'weapon', rects: [[41, 18, 5, 30], [42, 17, 6, 14]], detail: [[42, 17, 6, 2,, 40], [47, 17, 2, 14,, 40], [41, 36, 5, 12,, -55]], ornate: [[42, 17, 6, 3, 'trim'], [42, 45, 3, 3, 'trim']] },
  Longbow:      { slot: 'weapon', rects: [[42, 12, 5, 5], [47, 17, 2, 27], [42, 44, 5, 5], [41, 17, 2, 27]], detail: [[47, 17, 2, 27,, 34], [42, 27, 5, 6,, -55]], ornate: [[42, 12, 5, 2, 'trim'], [42, 46, 5, 2, 'trim']] },
  Shortbow:     { slot: 'weapon', rects: [[42, 21, 5, 5], [47, 26, 2, 17], [42, 41, 5, 5], [41, 26, 2, 17]], detail: [[47, 26, 2, 17,, 34], [42, 30, 5, 6,, -55]], ornate: [[42, 21, 5, 2, 'trim'], [42, 43, 5, 2, 'trim']] },
  Crossbow:     { slot: 'weapon', rects: [[36, 35, 12, 5], [42, 26, 5, 21]], detail: [[36, 35, 12, 2,, 34], [42, 39, 5, 8,, -55]], ornate: [[36, 35, 12, 2, 'trim']] },
  Recurve:      { slot: 'weapon', rects: [[42, 12, 5, 8], [47, 18, 2, 23], [42, 41, 5, 8]], detail: [[47, 18, 2, 23,, 34]] },
  Scepter:      { slot: 'weapon', rects: [[41, 12, 8, 9], [42, 21, 5, 36]], detail: [[42, 14, 5, 5,, 'trim'], [42, 45, 5, 12,, -55]], ornate: [[41, 12, 8, 3, 'trim'], [42, 54, 3, 3, 'trim']] },
  'Prayer Rod': { slot: 'weapon', rects: [[42, 17, 5, 41], [38, 17, 12, 5]], detail: [[38, 17, 12, 2,, 'trim'], [42, 45, 5, 12,, -55]], ornate: [[38, 17, 12, 2, 'trim']] },
  Censer:       { slot: 'weapon', rects: [[41, 17, 8, 9], [42, 26, 5, 12], [41, 36, 8, 9]], detail: [[42, 18, 5, 5,, 'trim'], [42, 38, 5, 5,, 'trim']], ornate: [[41, 17, 8, 2, 'trim'], [41, 36, 8, 2, 'trim']] },
  Staff:        { slot: 'weapon', rects: [[42, 8, 5, 50], [38, 8, 12, 5]], detail: [[39, 8, 9, 2,, 'trim'], [42, 42, 5, 15,, -55]], ornate: [[38, 8, 12, 3, 'trim'], [42, 54, 3, 3, 'trim']] },
  Wand:         { slot: 'weapon', rects: [[42, 27, 5, 5], [42, 32, 5, 26]], detail: [[42, 27, 5, 5,, 'trim'], [42, 45, 5, 12,, -55]], ornate: [[42, 27, 5, 5, 'trim']] },
  Grimoire:     { slot: 'weapon', rects: [[38, 32, 11, 18]], detail: [[38, 32, 3, 18,, -55], [42, 36, 5, 2,, 'trim'], [42, 42, 5, 2,, 'trim']], ornate: [[38, 32, 11, 2, 'trim'], [38, 48, 11, 2, 'trim']] },
  'Bone Staff': { slot: 'weapon', rects: [[42, 8, 5, 50], [38, 8, 5, 5], [47, 8, 2, 5]], detail: [[38, 8, 5, 2,, 'trim'], [42, 42, 5, 15,, -55]], ornate: [[38, 8, 5, 3, 'trim'], [42, 54, 3, 3, 'trim']] },
  Focus:        { slot: 'weapon', rects: [[41, 27, 8, 9], [42, 36, 5, 18]], detail: [[42, 29, 5, 5,, 'trim'], [42, 45, 5, 9,, -55]], ornate: [[41, 27, 8, 3, 'trim']] },
};

// Armour is drawn in real materials, not a rarity colour wash. Rarity moves you along
// a MATERIAL ramp instead — plain iron and undyed wool at the bottom, blackened steel
// with gold filigree at the top — which is how ARPGs signal power without turning the
// character into a colour swatch. `trim` is the accent used by the detail layer.
const MATERIALS = {
  plate: {
    common:    { base: '#6b7079', trim: '#565b63' },
    uncommon:  { base: '#828a94', trim: '#6a7079' },
    rare:      { base: '#9aa4b0', trim: '#ccd6e2' },
    epic:      { base: '#5a6070', trim: '#b08a3a' },
    legendary: { base: '#3c4050', trim: '#e8c060' },
  },
  leather: {
    common:    { base: '#6a5238', trim: '#54402c' },
    uncommon:  { base: '#7c6142', trim: '#5f4a32' },
    rare:      { base: '#8b6d49', trim: '#c9a45a' },
    epic:      { base: '#5a4530', trim: '#b08a3a' },
    legendary: { base: '#3e2f21', trim: '#e8c060' },
  },
  cloth: {
    common:    { base: '#77767e', trim: '#5f5e66' },
    uncommon:  { base: '#6e7086', trim: '#585a70' },
    rare:      { base: '#5c6088', trim: '#9aa6d8' },
    epic:      { base: '#4b4070', trim: '#b08a3a' },
    legendary: { base: '#312a48', trim: '#e8c060' },
  },
  weapon: {
    common:    { base: '#8d939c', trim: '#6a7079' },
    uncommon:  { base: '#9aa2ac', trim: '#7a828c' },
    rare:      { base: '#b3bcc8', trim: '#d4dde8' },
    epic:      { base: '#7d8494', trim: '#b08a3a' },
    legendary: { base: '#5c6172', trim: '#e8c060' },
  },
};

// Slots shift slightly off their material so pieces read as separate items rather than
// one moulded suit: boots and legs darker, shoulders catching more light.
const SLOT_SHIFT = { head: 6, shoulders: 10, chest: 0, hands: -4, legs: -10, feet: -16, weapon: 0 };

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Blend two hex colours. t=0 is all `a`, t=1 is all `b`. */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function shiftRgb(rgb, amt) {
  const m = rgb.match(/\d+/g).map(Number);
  const c = m.map((v) => Math.max(0, Math.min(255, v + amt)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const hexShift = (hex, amt) => shiftRgb(`rgb(${hexToRgb(hex).join(',')})`, amt);

/** Ornaments — spikes, crests, gems — appear from rare upward. */
export const ORNATE_FROM = 'rare';
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const isOrnate = (rarityId) => RARITY_ORDER.indexOf(rarityId) >= RARITY_ORDER.indexOf(ORNATE_FROM);


// --- legendary set pieces ----------------------------------------------------------
//
// A legendary is not just the top rung of its armour type's material ramp. Each class's
// SET has its own palette and its own silhouette additions, so four pieces of it read as
// an outfit rather than four separately-blackened items. Keyed by the set id from
// data/sets.js.
const SET_MATERIALS = {
  gorewrought: { base: '#2e2a2c', trim: '#a81f28' },   // warrior: cold iron, blood
  venomweave:  { base: '#23301f', trim: '#66d04a' },   // hunter: dark hide, venom
  vesperlight: { base: '#d8d2c0', trim: '#f0c040' },   // priest: bleached bone, gold
  cindersoul:  { base: '#241c22', trim: '#ef7a22' },   // warlock: char, ember
};

// Geometry that ONLY a legendary gets, on top of the ordinary rare-and-up ornaments.
// This is the part that makes a set piece recognisable across the room: horns off the
// helm, real spikes on the pauldrons, a burning core in the chest and the weapon.
// [x, y, w, h, 'trim'] on the 48x72 humanoid grid; negative y is fine, the sprite
// canvas carries a margin.
const LEGENDARY_EXTRA = {
  head: [[12, -6, 3, 9, 'trim'], [33, -6, 3, 9, 'trim'], [23, -8, 2, 6, 'trim'],
         [11, -2, 2, 4, 'trim'], [35, -2, 2, 4, 'trim']],
  shoulders: [[5, 10, 3, 9, 'trim'], [40, 10, 3, 9, 'trim'],
              [9, 8, 3, 7, 'trim'], [36, 8, 3, 7, 'trim'],
              [2, 15, 3, 6, 'trim'], [43, 15, 3, 6, 'trim']],
  chest: [[22, 22, 4, 4, 'trim'], [20, 26, 8, 2, 'trim'], [23, 17, 2, 5, 'trim'],
          [17, 20, 2, 8, 'trim'], [29, 20, 2, 8, 'trim']],
  hands: [[9, 44, 5, 2, 'trim'], [34, 44, 5, 2, 'trim']],
  legs: [[18, 50, 2, 10, 'trim'], [28, 50, 2, 10, 'trim']],
  feet: [[14, 68, 7, 2, 'trim'], [27, 68, 7, 2, 'trim']],
  weapon: [[41, 2, 6, 3, 'trim'], [42, 8, 4, 26, 'trim'], [40, 36, 8, 3, 'trim'],
           [43, 52, 3, 6, 'trim']],
};

/** True for a legendary that belongs to a class set. */
export const isSetPiece = (item) => Boolean(item && item.setId && SET_MATERIALS[item.setId]);
/** Resolve an equipped item to the rects and colour the compositor should draw. */
export function lookFor(slotBase, item, classId) {
  if (!item) return null;
  const entry = GEAR_LOOKS[item.art];
  if (!entry) return null;
  const armorType = slotBase === 'weapon'
    ? 'weapon'
    : (CLASSES[classId] ? CLASSES[classId].armorType : 'plate');
  const ramp = MATERIALS[armorType] || MATERIALS.plate;
  // A set piece is painted in its SET's colours, not its armour type's, so a full set
  // reads as one outfit instead of four separately-blackened items.
  const setPiece = isSetPiece(item);
  const mat = setPiece ? SET_MATERIALS[item.setId] : (ramp[item.rarity] || ramp.common);

  // Ornaments show from rare up, so a legendary reads as *made* better rather than
  // merely painted a different colour -- and a set piece gets its own geometry on top.
  const ornate = isOrnate(item.rarity) ? [...(entry.ornate || [])] : [];
  if (setPiece) ornate.push(...(LEGENDARY_EXTRA[slotBase] || []));

  return {
    rects: entry.rects,
    detail: entry.detail || [],
    ornate,
    color: hexShift(mat.base, SLOT_SHIFT[slotBase] || 0),
    trim: mat.trim,
  };
}

// Draw order: legs and feet first, torso over them, then arms, head and weapon on top.
export const DRAW_ORDER = ['legs', 'feet', 'chest', 'shoulders', 'hands', 'head', 'weapon'];
