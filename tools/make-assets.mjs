// Generate the app icon and launch image.
//
// Written as a tiny PNG encoder rather than pulled in as a binary asset so the artwork is
// reproducible, reviewable in a diff, and regenerable at any size. The project has no
// build step and no image dependencies, and this keeps it that way -- zlib is in Node.
//
//   node tools/make-assets.mjs
//
// Produces assets/icon.png (1024) and assets/splash.png (2732). `npx @capacitor/assets
// generate` expands those into the full iOS icon and launch-image sets.
//
// The mark is the hollow crown: the circlet of the Hollow King with its centre stone gone
// and an ember burning down in the empty setting. A crown is one of the few shapes that
// still reads at 60 pixels on a home screen, and it says which game this is in a way a
// sword does not -- every second fantasy title on the store is a sword. The missing stone
// is the premise of the game in one shape.
//
// Shapes are drawn into a 2x supersampled buffer and box-filtered down, which is where
// the antialiasing comes from; there is no per-edge coverage maths anywhere below.

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

// --- palette -------------------------------------------------------------------------
// Tarnished rather than bright. Old gold with a lot of shadow in it, on a cold ground,
// with the only warm light in the picture coming out of the empty setting.
const GOLD_HI  = [228, 190, 116];
const GOLD     = [174, 124, 46];
const GOLD_LO  = [82, 52, 21];
const RIM      = [26, 17, 15];
const VOID_C   = [9, 7, 12];
const EMBER    = [255, 132, 40];
const EMBER_HI = [255, 226, 182];
const GEM      = [66, 16, 22];
const GEM_HI   = [122, 38, 40];
const SKY_TOP  = [40, 34, 64];
const SKY_BOT  = [9, 8, 14];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// --- geometry ------------------------------------------------------------------------
// A nominal 1000x1000 box. Five points on a flared band, the outer pair swept outward
// past the band like horns, every edge bowed so the points read as blades rather than as
// the triangles on a birthday hat. One continuous outline covering band and points
// together, so the dark keyline never runs through the middle of the shape.
const BAND_TOP = 640;
const BAND_BOT = 868;
const CROWN_TOP = 86;
const CROWN_BOT = BAND_BOT;
const BOW = 0.26;

// Base, then tip / valley alternating across the top, then base.
const ANCHORS = [
  [205, 640], [108, 188], [300, 540], [330, 330], [412, 556],
  [500, 86], [588, 556], [670, 330], [700, 540], [892, 188], [795, 640],
];

/** A bowed line. The bow always pulls toward the higher end, so points stay sharp. */
function edge(x0, y0, x1, y1, bow, seg = 7) {
  const tipX = y0 < y1 ? x0 : x1;
  const out = [];
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const y = y0 + (y1 - y0) * t;
    let x = x0 + (x1 - x0) * t;
    x += (tipX - x) * Math.sin(Math.PI * t) * bow;
    out.push([x, y]);
  }
  return out;
}

const CROWN = (() => {
  const pts = [[146, BAND_TOP], [ANCHORS[0][0], ANCHORS[0][1]]];
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1], b = ANCHORS[i];
    pts.push(...edge(a[0], a[1], b[0], b[1], BOW));
  }
  pts.push([854, BAND_TOP], [834, BAND_BOT], [166, BAND_BOT]);
  return pts;
})();

const SOCKET = { x: 500, y: 754, rim: 78, hole: 66 };
const GEMS = [[322, 754], [678, 754]];
const BLOOM = 205;

/** Gold with a vertical gradient and a soft light from the upper left. */
function goldAt(nx, ny) {
  const t = clamp01((ny - CROWN_TOP) / (CROWN_BOT - CROWN_TOP));
  const base = t < 0.55 ? mix(GOLD_HI, GOLD, t / 0.55) : mix(GOLD, GOLD_LO, (t - 0.55) / 0.45);
  const sheen = clamp01(1 - (nx + ny) / 1300);
  return mix(base, GOLD_HI, sheen * 0.2);
}

// --- the mark, drawn on transparency -------------------------------------------------
const SS = 2;

function drawMark(size) {
  const w = size * SS, h = size * SS;
  const S = w / 1000;
  const px = new Float32Array(w * h * 4);

  const blend = (x, y, c, a) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    const ia = px[i + 3];
    const na = a + ia * (1 - a);
    if (na <= 0) return;
    const k = ia * (1 - a);
    px[i]     = (c[0] * a + px[i] * k) / na;
    px[i + 1] = (c[1] * a + px[i + 1] * k) / na;
    px[i + 2] = (c[2] * a + px[i + 2] * k) / na;
    px[i + 3] = na;
  };

  /** Even-odd scanline fill. `colorAt` takes nominal coordinates. */
  const poly = (pts, colorAt, dx = 0, dy = 0) => {
    const ys = pts.map((p) => p[1] * S + dy);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const ay = a[1] * S + dy, by = b[1] * S + dy;
        if ((ay <= yc) === (by <= yc)) continue;
        const ax = a[0] * S + dx, bx = b[0] * S + dx;
        xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) blend(x, y, colorAt((x + 0.5) / S, (y + 0.5) / S), 1);
      }
    }
  };

  const disc = (ncx, ncy, nr, colorAt) => {
    const cx = ncx * S, cy = ncy * S, r = nr * S;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / S;
        if (d <= nr) blend(x, y, colorAt(d, (x + 0.5) / S, (y + 0.5) / S), 1);
      }
    }
  };

  // Keyline first: the same silhouette stamped around in eight directions. Cheaper than
  // offsetting the polygon, and uniform in every direction, which an outset is not.
  const o = Math.max(1, Math.round(9 * S));
  const keyline = () => RIM;
  for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) {
    poly(CROWN, keyline, dx, dy);
  }
  poly(CROWN, goldAt);

  // Shading passes over the band only: a raised lip along its top edge, the groove
  // beneath it, and a darker rim at the bottom. Applied where the mark is already
  // opaque, so the taper of the band edges is followed for free.
  const band = (ny0, ny1, c, peak) => {
    for (let y = Math.floor(ny0 * S); y <= Math.ceil(ny1 * S); y++) {
      if (y < 0 || y >= h) continue;
      const t = ((y + 0.5) / S - ny0) / (ny1 - ny0);
      const a = peak * Math.sin(Math.PI * clamp01(t));
      for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 0.5) blend(x, y, c, a);
    }
  };
  band(BAND_TOP, BAND_TOP + 26, GOLD_HI, 0.42);
  band(BAND_TOP + 26, BAND_TOP + 52, RIM, 0.38);
  band(BAND_BOT - 30, BAND_BOT, RIM, 0.34);

  // Two stones still in their settings, so the missing one reads as missing.
  for (const [gx, gy] of GEMS) {
    disc(gx, gy, 26, () => RIM);
    disc(gx, gy, 20, (d, nx, ny) => mix(GEM_HI, GEM, clamp01((d / 20) * 0.5 + (ny - gy + 18) / 74)));
  }

  // The empty setting: dark ring, void, and an ember burning at the bottom of it.
  disc(SOCKET.x, SOCKET.y, SOCKET.rim, (d) => (d > SOCKET.hole ? RIM : VOID_C));
  disc(SOCKET.x, SOCKET.y, SOCKET.hole, (d) => {
    const g = clamp01(1 - d / SOCKET.hole);
    const heat = mix(EMBER, EMBER_HI, clamp01((g - 0.66) / 0.34));
    return mix(VOID_C, heat, Math.pow(g, 1.75));
  });

  // Bloom: the ember throws light back onto the gold around it. Without this the socket
  // looks like a sticker on the band rather than a hole with something alight inside.
  const bx = SOCKET.x * S, by = SOCKET.y * S, br = BLOOM * S;
  for (let y = Math.max(0, Math.floor(by - br)); y <= Math.min(h - 1, Math.ceil(by + br)); y++) {
    for (let x = Math.max(0, Math.floor(bx - br)); x <= Math.min(w - 1, Math.ceil(bx + br)); x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] <= 0) continue;
      const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by) / S;
      if (d > BLOOM || d < SOCKET.rim) continue;
      const k = Math.pow(1 - d / BLOOM, 2.2) * 0.46;
      px[i]     = Math.min(255, px[i] + EMBER[0] * k);
      px[i + 1] = Math.min(255, px[i + 1] + EMBER[1] * k * 0.55);
      px[i + 2] = Math.min(255, px[i + 2] + EMBER[2] * k * 0.2);
    }
  }

  // Box-filter down. Premultiplied, or the transparent margin bleeds black into the edge.
  const out = new Float32Array(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * w + (x * SS + sx)) * 4;
          const pa = px[i + 3];
          r += px[i] * pa; g += px[i + 1] * pa; b += px[i + 2] * pa; a += pa;
        }
      }
      const j = (y * size + x) * 4;
      out[j + 3] = a / n;
      if (a > 0) { out[j] = r / a; out[j + 1] = g / a; out[j + 2] = b / a; }
    }
  }
  return out;
}

// --- backdrop, glow and composite ----------------------------------------------------
function compose(size, markFrac) {
  const markPx = Math.round(size * markFrac);
  const mark = drawMark(markPx);
  const px = new Float32Array(size * size * 3);

  // Vertical gradient, then an ember glow sitting where the socket will land, then a
  // vignette. The glow is placed rather than centred, so the empty setting looks lit from
  // inside rather than pasted onto a backdrop.
  const ox = Math.round((size - markPx) / 2);
  const oy = Math.round((size - markPx) / 2);
  const glowX = ox + (SOCKET.x / 1000) * markPx;
  const glowY = oy + (SOCKET.y / 1000) * markPx;
  const glowR = markPx * 0.55;
  const vignR = size * 0.7;

  for (let y = 0; y < size; y++) {
    const sky = mix(SKY_TOP, SKY_BOT, Math.pow(y / (size - 1), 0.8));
    for (let x = 0; x < size; x++) {
      const gd = clamp01(1 - Math.hypot(x - glowX, y - glowY) / glowR);
      const glow = Math.pow(gd, 2.4) * 0.34;
      const vd = clamp01(Math.hypot(x - size / 2, y - size / 2) / vignR);
      const dark = 1 - Math.pow(vd, 2) * 0.5;
      const i = (y * size + x) * 3;
      px[i]     = (sky[0] + EMBER[0] * glow) * dark;
      px[i + 1] = (sky[1] + EMBER[1] * glow * 0.5) * dark;
      px[i + 2] = (sky[2] + EMBER[2] * glow * 0.25) * dark;
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      let r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = x - ox, my = y - oy;
      if (mx >= 0 && my >= 0 && mx < markPx && my < markPx) {
        const j = (my * markPx + mx) * 4;
        const a = mark[j + 3];
        if (a > 0) {
          r = mark[j] * a + r * (1 - a);
          g = mark[j + 1] * a + g * (1 - a);
          b = mark[j + 2] * a + b * (1 - a);
        }
      }
      const o = (y * size + x) * 4;
      rgba[o] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

fs.mkdirSync(OUT, { recursive: true });

// The crown spans 78% of the mark box, so 0.95 puts it at roughly three quarters of the
// icon -- large enough to hold a home screen without touching the squircle mask.
const ICON = 1024;
writePng(path.join(OUT, 'icon.png'), ICON, ICON, compose(ICON, 1.0));

// The launch image is the same mark on the same ground, centred in a 2732 square so it
// crops correctly on every device aspect without a separate asset per size.
const SPLASH = 2732;
writePng(path.join(OUT, 'splash.png'), SPLASH, SPLASH, compose(SPLASH, 0.34));

if (process.argv[2]) {
  const preview = process.argv[2];
  writePng(preview, 120, 120, compose(120, 1.0));
  console.log('preview written to ' + preview);
}

console.log('assets/icon.png (1024) and assets/splash.png (2732) written');
