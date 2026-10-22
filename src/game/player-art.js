// Pre-rendered pixel art for the player ship, its shots, shield, items and the
// Abyss Burst. Everything is rasterised once per pixel (ImageData) so it stays
// crisp under the nearest-neighbour upscale; draw code only blits these.
// Owned by the player agent.
import { makeSprite, TAU } from '../core/util.js';

// ---------------------------------------------------------------- helpers
const hexCache = new Map();
export function rgb(hex) {
  let c = hexCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexCache.set(hex, c);
  }
  return c;
}

// Per-pixel sprite: fn(x, y) → null | [r,g,b,a(0..255)] | '#hex'
export function pixSprite(w, h, fn, post) {
  return makeSprite(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = fn(x, y);
        if (!c) continue;
        if (typeof c === 'string') c = [...rgb(c), 255];
        const i = (y * w + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] === undefined ? 255 : c[3];
      }
    }
    if (post) post(d, w, h);
    ctx.putImageData(img, 0, 0);
  });
}

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const withA = (hex, a) => [...rgb(hex), a];

// 4x4 Bayer for stepped/dithered gradients.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
// pick from ramp: hard steps with a narrow dithered seam, t in 0..1 (0 = first entry)
function ramp(r, t, x, y) {
  const f = Math.max(0, Math.min(r.length - 1, t * (r.length - 1)));
  const i = Math.floor(f);
  const fr = f - i;
  const up = fr > 0.68 ? true : fr < 0.32 ? false : (fr - 0.32) / 0.36 > bayer(x, y);
  return r[Math.min(r.length - 1, up ? i + 1 : i)];
}

// mask + 1px dark outline (8-way)
function outlinedSprite(w, h, cells, line) {
  return pixSprite(w, h, (x, y) => {
    const c = cells[y * w + x];
    if (c) return c;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && cells[ny * w + nx]) return line;
    }
    return null;
  });
}

// ---------------------------------------------------------------- palette
export const PAL = {
  white: ['#ffffff', '#eef1f7', '#cfd5e2', '#a0a8bc', '#6c7390', '#40455e'],
  red: ['#ffb0a8', '#ff4a3c', '#d61a26', '#8a0c1c', '#4a0612'],
  blue: ['#c4f6ff', '#62ccff', '#2c7ef0', '#1c48b0', '#10286c'],
  glass: ['#f0ffff', '#86f2ff', '#26aee6', '#0e5e96', '#06305c'],
  gun: ['#a0aabd', '#6e768c', '#4a5066', '#2e3246'],
  line: '#0a0c1e',
};

// ---------------------------------------------------------------- ship
// White fighter with red markings, top-down, nose right. Local (u, v): u
// forward, v down. Canvas 34x20, pivot (17,10). bank -2..2 (negative = climbing).
export const SHIP_W = 34, SHIP_H = 20, SHIP_CX = 17, SHIP_CY = 10;

function shipSprite(bank) {
  const sU = 4.6 - bank * 1.15; // upper wing span (foreshortens when rolling)
  const sL = 4.6 + bank * 1.15;
  const cv = -bank * 0.45; // canopy/spine shift with roll
  const fus = [[-11, -2.5], [-3, -3], [5, -2.4], [11, -1.1], [15, 0.2 * cv], [11, 1.1], [5, 2.4], [-3, 3], [-11, 2.5]];
  const wingU = [[4, -2.1], [-7, -2.1], [-12, -2.1 - sU], [-8, -2.1 - sU]];
  const wingL = [[4, 2.1], [-7, 2.1], [-12, 2.1 + sL], [-8, 2.1 + sL]];
  // red chevron panel on each wing
  const inU = [[2.2, -2.5], [-2.2, -2.5], [-8.6, -1.8 - sU * 0.9], [-6.2, -1.8 - sU * 0.9]];
  const inL = [[2.2, 2.5], [-2.2, 2.5], [-8.6, 1.8 + sL * 0.9], [-6.2, 1.8 + sL * 0.9]];
  const canU = [[10, -1.3], [7, -1.3], [6, -3.4 - Math.max(0, -bank) * 0.4], [7.5, -3.4]];
  const canL = [[10, 1.3], [7, 1.3], [6, 3.4 + Math.max(0, bank) * 0.4], [7.5, 3.4]];
  const eng = [[-13.5, -1.9], [-9, -2.3], [-9, 2.3], [-13.5, 1.9]];
  const cells = new Array(SHIP_W * SHIP_H).fill(null);
  for (let y = 0; y < SHIP_H; y++) {
    for (let x = 0; x < SHIP_W; x++) {
      const u = x + 0.5 - SHIP_CX, v = y + 0.5 - SHIP_CY;
      let c = null;
      const cu = (u - 4.2) / 4.0, cvv = (v - cv) / 1.3;
      if (cu * cu + cvv * cvv < 1 && u < 8.4) {
        const t = (v - cv + 1.3) / 2.6;
        c = ramp(PAL.glass, 0.1 + t * 0.85, x, y);
        if (u > 1.5 && u < 4 && v - cv < -0.2) c = PAL.glass[0];
      } else if (inPoly(u, v, fus)) {
        const t = (v - cv * 0.6 + 3) / 6;
        c = ramp(PAL.white, 0.02 + t * 0.85, x, y);
        if (Math.abs(v - cv) < 0.55 && u < 0.2 && u > -10) c = t < 0.5 ? PAL.red[1] : PAL.red[2]; // spine stripe
        if (Math.abs(u + 3.6) < 0.5 && Math.abs(v) < 2.6) c = PAL.white[4]; // panel line
        if (u > 9.5 && u < 11 && Math.abs(v) < 1.4) c = PAL.red[t < 0.5 ? 1 : 2]; // nose band
        if (u > 12.5) c = PAL.white[t < 0.5 ? 1 : 3];
      } else if (inPoly(u, v, canU) || inPoly(u, v, canL)) {
        c = v < 0 ? PAL.red[1] : PAL.red[2];
      } else if (inPoly(u, v, eng)) {
        const ridge = (Math.floor(u + 20) & 1) === 0;
        c = PAL.gun[(v < -0.5 ? 0 : v < 1 ? 1 : 2) + (ridge ? 1 : 0)];
        if (u < -12.6) c = Math.abs(v) < 1 ? PAL.blue[1] : PAL.blue[3];
      } else if (inPoly(u, v, wingU)) {
        c = ramp(PAL.white, 0.08 + (bank < 0 ? 0 : 0.12) + ((-v - 2) / 7) * 0.2, x, y);
        if (inPoly(u, v, inU)) c = sU > 3 ? PAL.red[1] : PAL.red[2];
        if (u < -9 && v < -1.4 - sU) c = PAL.red[2];
      } else if (inPoly(u, v, wingL)) {
        c = ramp(PAL.white, 0.4 + (bank > 0 ? -0.12 : 0.1) + ((v - 2) / 7) * 0.25, x, y);
        if (inPoly(u, v, inL)) c = sL > 3 ? PAL.red[2] : PAL.red[3];
        if (u < -9 && v > 1.4 + sL) c = PAL.red[3];
      }
      if (c) cells[y * SHIP_W + x] = c;
    }
  }
  return outlinedSprite(SHIP_W, SHIP_H, cells, PAL.line);
}

// Engine flame: frame f 0..3, length class L 0..2. Canvas 18x9, anchor right-mid.
function flameSprite(f, L) {
  const len = [6, 9, 13][L] + [0, 2, -1, 1][f];
  const w = 18, h = 9;
  return pixSprite(w, h, (x, y) => {
    const u = (w - 1 - x) / len;
    const v = Math.abs(y - 4) / (2.6 * (1 - u * 0.75) + 0.2);
    if (u > 1 || v > 1) return null;
    const flick = ((x * 7 + y * 3 + f * 5) % 5) / 10;
    const k = v * 0.7 + u * 0.6 + flick * 0.25;
    if (k < 0.32) return '#ffffff';
    if (k < 0.55) return '#a8f4ff';
    if (k < 0.78) return [60, 170, 255, 235];
    if (k < 1.0) return [40, 80, 230, 170];
    return [40, 40, 200, 80];
  });
}

function muzzleSprite(f) {
  const s = [1, 0.75, 0.45][f];
  return pixSprite(10, 10, (x, y) => {
    const dx = x - 4.5, dy = y - 4.5;
    const d = Math.sqrt(dx * dx + dy * dy) / (4.5 * s);
    const cross = Math.min(Math.abs(dx), Math.abs(dy)) < 0.8 && d < 1;
    if (d < 0.35) return '#ffffff';
    if (cross) return d < 0.7 ? '#d8faff' : [120, 220, 255, 200];
    if (d < 0.6) return [150, 230, 255, 220];
    return null;
  });
}

// ---------------------------------------------------------------- shots
// Blue twin bolt. heavy: thicker/longer. Anchor: head at right-mid.
function boltSprite(heavy) {
  const w = heavy ? 20 : 15, h = heavy ? 7 : 5;
  const cy = (h - 1) / 2;
  return pixSprite(w, h, (x, y) => {
    const u = x / (w - 1);
    const v = Math.abs(y - cy) / (h / 2);
    const thick = u > 0.85 ? Math.sqrt(Math.max(0, 1 - ((u - 0.85) / 0.17) ** 2)) : 0.25 + u * 0.75;
    if (v > thick) return null;
    const core = v < thick * (heavy ? 0.42 : 0.36);
    if (u > 0.45 && core) return '#ffffff';
    if (u > 0.3 && v < thick * 0.7) return '#aaf0ff';
    if (u > 0.3) return [40, 150, 255, 210];
    return [40, 110, 255, Math.round(60 + u * 450)];
  });
}

// Laser beam segment, length L, thickness class k (0 thin,1 wide). Head at right.
function laserSprite(L, k) {
  const h = k ? 9 : 7, cy = (h - 1) / 2;
  return pixSprite(L, h, (x, y) => {
    const v = Math.abs(y - cy);
    const head = L - 1 - x; // distance from head
    const taper = head < 3 ? (3 - head) * 0.7 : 0;
    const edge = (k ? 4 : 3) - taper;
    if (v > edge) return null;
    const flick = (x & 3) === 0 ? 0.6 : 0;
    if (v < (k ? 1.6 : 1.0)) return '#ffffff';
    if (v < (k ? 2.6 : 2.0)) return '#a6eeff';
    if (v < edge - 0.5 + flick * 0) return [70, 170, 255, 230];
    return [40, 100, 255, 150];
  });
}

// Green crescent wave of height hgt rotated by ang. Square canvas centred on
// the crescent's front midpoint. Includes a soft afterglow behind.
export function waveSprite(hgt, ang) {
  const tail = 10, half = hgt / 2, bend = 4;
  const S = Math.ceil(Math.max(hgt + 4, (tail + 8) * 2)) | 1, c = (S - 1) / 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return pixSprite(S, S, (x, y) => {
    const dx0 = x - c, dy0 = y - c;
    const u = dx0 * ca + dy0 * sa, v = -dx0 * sa + dy0 * ca;
    const vn = v / half;
    if (Math.abs(vn) > 1) return null;
    const front = 1 - bend * vn * vn;
    const thick = 4.2 * (1 - 0.55 * vn * vn);
    const d = front - u;
    if (d >= -0.5 && d < thick) {
      const t = d / thick;
      if (t < 0.3) return '#f4fff0';
      if (t < 0.65) return '#8cff9a';
      return [30, 200, 120, 230];
    }
    if (d >= thick && d < thick + tail && Math.abs(vn) < 0.95) {
      const k = (d - thick) / tail;
      const a = Math.round(140 * (1 - k) * (1 - vn * vn * 0.6));
      return (Math.round(v) & 1) || k < 0.3 ? [40, 210, 140, a] : null;
    }
    return null;
  });
}

// Homing missile: 16 directions, 11x11, white body, blue nose, red fin.
function homingSprite(dir) {
  const S = 13, c = 6;
  const a = (dir / 16) * TAU, ca = Math.cos(a), sa = Math.sin(a);
  const cells = new Array(S * S).fill(null);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - c, dy = y - c;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    if (u > -4.6 && u < 4.8 && Math.abs(v) < 1.3 - Math.max(0, u - 3) * 0.5) cells[y * S + x] = u > 2.6 ? PAL.blue[1] : v < 0 ? PAL.white[1] : PAL.white[3];
    else if (u > -5 && u < -2.2 && Math.abs(v) < 2.7 + (u + 2.2) * 0.3) cells[y * S + x] = v < 0 ? PAL.red[1] : PAL.red[2];
  }
  return outlinedSprite(S, S, cells, PAL.line);
}

// ---------------------------------------------------------------- shield
export const SHIELD_W = 42, SHIELD_H = 30;
const SH_RIM = ['#f0feff', '#8ff2ff', '#36c0e8', '#16608c'];
const SH_TINT = [90, 220, 255];
const CRACKS = [
  [[0.62, -0.75], [0.42, -0.5], [0.5, -0.3], [0.3, -0.12], [0.36, 0.05]],
  [[-0.7, 0.7], [-0.45, 0.48], [-0.52, 0.25], [-0.3, 0.12]],
  [[0.85, 0.45], [0.62, 0.36], [0.55, 0.6], [0.35, 0.55]],
  [[-0.55, -0.78], [-0.38, -0.55], [-0.15, -0.6], [0.0, -0.4]],
  [[0.2, 0.92], [0.12, 0.66], [-0.05, 0.6]],
];
function shieldSprite(crack, flash) {
  const rx = 19.5, ry = 13.5, cx = (SHIELD_W - 1) / 2, cy = (SHIELD_H - 1) / 2;
  return pixSprite(SHIELD_W, SHIELD_H, (x, y) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    const d = Math.sqrt(nx * nx + ny * ny);
    if (d > 1.06) return null;
    if (flash) return d > 0.84 ? [255, 255, 255, 240] : [220, 245, 255, 110];
    if (d > 0.995) return withA(SH_RIM[3], 200);
    if (d > 0.9) {
      const lit = -(nx * 0.6 + ny * 0.8);
      return withA(lit > 0.35 ? SH_RIM[0] : lit > -0.2 ? SH_RIM[1] : SH_RIM[2], 230);
    }
    const a = Math.atan2(ny, nx);
    if (d > 0.68 && d < 0.8 && a > -2.6 && a < -1.75) return [255, 255, 255, 200];
    if (d > 0.5 && d < 0.6 && a > 0.6 && a < 1.3) return withA(SH_RIM[1], 110);
    // hex-cell shimmer inside (faint)
    const hx = Math.round(x / 4), hy = Math.round(y / 4 + (hx & 1) * 0.5);
    const grid = (Math.abs(x / 4 - hx) > 0.4 || Math.abs(y / 4 + (hx & 1) * 0.5 - hy) > 0.4) && d > 0.55;
    const al = Math.round(16 + Math.pow(d, 4) * 80 + (grid ? 26 : 0));
    return [...SH_TINT, al];
  }, (data, w, h) => {
    if (!crack || flash) return;
    const n = crack === 1 ? 2 : CRACKS.length;
    for (let k = 0; k < n; k++) {
      const pl = CRACKS[k];
      for (let i = 0; i < pl.length - 1; i++) {
        let x0 = Math.round(cx + pl[i][0] * rx), y0 = Math.round(cy + pl[i][1] * ry);
        const x1 = Math.round(cx + pl[i + 1][0] * rx), y1 = Math.round(cy + pl[i + 1][1] * ry);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          const p = (y0 * w + x0) * 4;
          if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) { data[p] = 255; data[p + 1] = 255; data[p + 2] = 255; data[p + 3] = 235; }
          const q = ((y0 + 1) * w + x0) * 4;
          if (y0 + 1 < h && data[q + 3] < 200) { data[q] = 20; data[q + 1] = 30; data[q + 2] = 60; data[q + 3] = 150; }
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      }
    }
  });
}
export const SHIELD_COLOR = SH_RIM[1];

// ---------------------------------------------------------------- items
export const ITEM_COL = {
  laser: ['#ffffff', '#ffb0a0', '#ff4a3a', '#c41828', '#5c0814'],
  wave: ['#ffffff', '#c4ffa0', '#48e040', '#14902c', '#06401a'],
  homing: ['#ffffff', '#b0d0ff', '#3a78ff', '#1a3cc0', '#0a1660'],
  shield: ['#ffffff', '#c0fbff', '#3ad8f0', '#1288b0', '#063a50'],
  bomb: ['#ffffff', '#f0b0ff', '#a040e8', '#4a1490', '#14042c'],
};
// 5x7 glyphs drawn in the middle of each orb
const GLYPH = {
  laser: ['.#...', '.#...', '.#...', '.#...', '.#...', '.#...', '.####'],
  wave: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  homing: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  shield: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  bomb: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
};
export const ORB_S = 19;
function orbSprite(kind, f) {
  const r = ITEM_COL[kind];
  const c = 9;
  const g = GLYPH[kind];
  return pixSprite(ORB_S, ORB_S, (x, y) => {
    const dx = (x - c) / 7.4, dy = (y - c) / 7.4;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1.18) return null;
    if (d > 1.0) return PAL.line;
    const gx = x - 7, gy = y - 6;
    if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && g[gy][gx] === '#') return f === 3 ? r[1] : '#ffffff';
    // glyph shadow
    if (gx - 1 >= 0 && gx - 1 < 5 && gy - 1 >= 0 && gy - 1 < 7 && g[gy - 1][gx - 1] === '#') return r[4];
    const nz = Math.sqrt(Math.max(0, 1 - d * d));
    const l = Math.max(0, -dx * 0.5 - dy * 0.6 + nz * 0.62);
    const band = Math.abs(Math.sin((dx / (nz + 0.25)) * 2.2 + f * 0.8)) < 0.16 && Math.abs(dy) < 0.75;
    if ((dx + 0.42) ** 2 + (dy + 0.46) ** 2 < 0.04) return r[0];
    let t = 1 - l;
    if (band) t -= 0.25;
    return ramp(r.slice(1), Math.max(0, Math.min(1, t)), x, y);
  });
}
function haloSprite(kind) {
  const col = rgb(ITEM_COL[kind][2]);
  return pixSprite(33, 33, (x, y) => {
    const d = Math.hypot(x - 16, y - 16) / 16;
    if (d > 1) return null;
    const a = Math.round(Math.pow(1 - d, 1.3) * 200 * (bayer(x, y) < 0.85 ? 1 : 0.6));
    return [...col, a];
  });
}

// ---------------------------------------------------------------- abyss burst
function burstCore() {
  const S = 64, c = 31.5;
  return pixSprite(S, S, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (d < 5) return '#ffffff';
    if (d < 8) return '#c8fcff';
    if (d < 11) return [90, 220, 255, 240];
    if (d < 32) {
      const k = (d - 11) / 21;
      return [40, 140 + 60 * (1 - k), 255, Math.round(190 * Math.pow(1 - k, 2) * (bayer(x, y) < 0.8 ? 1 : 0.5))];
    }
    return null;
  });
}

// ---------------------------------------------------------------- cache
let ART = null;
const waveCache = new Map();
export function waveFor(hgt, ang) {
  const hk = Math.max(8, Math.min(28, Math.round(hgt / 2) * 2));
  const ak = Math.round(ang / 0.05);
  const key = hk * 100 + ak;
  let s = waveCache.get(key);
  if (!s) { s = waveSprite(hk, ak * 0.05); waveCache.set(key, s); }
  return s;
}
export function art() {
  if (ART) return ART;
  ART = {
    ship: [-2, -1, 0, 1, 2].map(shipSprite),
    flame: [0, 1, 2].map((L) => [0, 1, 2, 3].map((f) => flameSprite(f, L))),
    muzzle: [0, 1, 2].map(muzzleSprite),
    bolt: [boltSprite(false), boltSprite(true)],
    laser: [laserSprite(36, 0), laserSprite(40, 1)],
    homing: Array.from({ length: 16 }, (_, d) => homingSprite(d)),
    shield: [0, 1, 2].map((c) => shieldSprite(c, false)),
    shieldFlash: shieldSprite(0, true),
    orb: {},
    halo: {},
    burstCore: burstCore(),
  };
  for (const k of Object.keys(ITEM_COL)) {
    ART.orb[k] = [0, 1, 2, 3].map((f) => orbSprite(k, f));
    ART.halo[k] = haloSprite(k);
  }
  return ART;
}
