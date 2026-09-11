// Generate the app icon and launch image.
//
// Written as a tiny PNG encoder rather than pulled in as a binary asset so the artwork
// is reproducible, reviewable in a diff, and regenerable at any size. The project has no
// build step and no image dependencies, and this keeps it that way -- zlib is in Node.
//
//   node tools/make-assets.mjs
//
// Produces assets/icon.png (1024) and assets/splash.png (2732). `npx @capacitor/assets
// generate` expands those into the full iOS icon and launch-image sets.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'assets');

// --- a minimal RGBA PNG writer -------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  // Each scanline is prefixed with a filter byte; 0 means "none".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- a very small drawing surface ----------------------------------------------------
function surface(w, h) {
  const px = Buffer.alloc(w * h * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  return {
    px,
    /** Vertical gradient across the whole surface. */
    backdrop(top, bottom) {
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        const c = top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
        for (let x = 0; x < w; x++) put(x, y, c);
      }
    },
    rect(x0, y0, rw, rh, c) {
      for (let y = Math.round(y0); y < Math.round(y0 + rh); y++) {
        for (let x = Math.round(x0); x < Math.round(x0 + rw); x++) put(x, y, c);
      }
    },
    /** Isoceles triangle, apex at the top. */
    spire(cx, apexY, halfW, baseY, c) {
      for (let y = Math.round(apexY); y <= Math.round(baseY); y++) {
        const t = (y - apexY) / Math.max(1, baseY - apexY);
        const half = halfW * t;
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) put(x, y, c);
      }
    },
  };
}

const GOLD = [232, 192, 96];
const GOLD_LIT = [240, 212, 136];
const LEATHER = [168, 118, 58];
const TOP = [36, 31, 56];
const BOTTOM = [20, 18, 24];

/**
 * A blade, point up. At 60 pixels on a home screen a mark has to be one silhouette --
 * anything with more parts than this turns to mush.
 */
function drawBlade(s, scale, cx, cy) {
  // Drawn against a nominal 1024 box, then scaled and placed. Passing the surface size
  // in directly meant the launch image put the blade at a quarter of the way across.
  const S = scale / 1024;
  const top = cy - 512 * S;
  const at = (y) => top + y * S;
  s.spire(cx, at(140), 46 * S, at(250), GOLD);              // tip
  s.rect(cx - 46 * S, at(250), 92 * S, 470 * S, GOLD);      // blade
  s.rect(cx - 46 * S, at(250), 30 * S, 470 * S, GOLD_LIT);  // lit edge
  s.rect(cx - 150 * S, at(700), 300 * S, 58 * S, LEATHER);  // crossguard
  s.rect(cx - 34 * S, at(758), 68 * S, 150 * S, LEATHER);   // grip
  s.rect(cx - 56 * S, at(890), 112 * S, 44 * S, GOLD);      // pommel
}

fs.mkdirSync(OUT, { recursive: true });

const ICON = 1024;
const icon = surface(ICON, ICON);
icon.backdrop(TOP, BOTTOM);
drawBlade(icon, ICON, ICON / 2, ICON / 2);
writePng(path.join(OUT, 'icon.png'), ICON, ICON, icon.px);

// The launch image is the same mark on the same ground, centred in a 2732 square so it
// crops correctly on every device aspect without a separate asset per size.
const SPLASH = 2732;
const splash = surface(SPLASH, SPLASH);
splash.backdrop(TOP, BOTTOM);
drawBlade(splash, SPLASH * 0.42, SPLASH / 2, SPLASH / 2);
writePng(path.join(OUT, 'splash.png'), SPLASH, SPLASH, splash.px);

console.log('assets/icon.png (1024) and assets/splash.png (2732) written');
