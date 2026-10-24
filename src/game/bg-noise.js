import { makeSprite } from '../core/util.js';

export function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a, n) => ((a % n) + n) % n;
const sm = (t) => t * t * (3 - 2 * t);

// 1D value noise, periodic with `period` lattice cells (0 = not periodic).
export function vnoise1(x, period, seed) {
  const i = Math.floor(x), f = sm(x - i);
  const w = (k) => (period ? mod(k, period) : k);
  const a = hash(w(i), 0, seed), b = hash(w(i + 1), 0, seed);
  return a + (b - a) * f;
}
export function fbm1(x, period, seed, oct = 4) {
  let s = 0, amp = 0.5, n = 0, fr = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise1(x * fr, period * fr, seed + o * 31);
    n += amp; amp *= 0.5; fr *= 2;
  }
  return s / n;
}

// 2D value noise, periodic in x/y by px/py cells (0 = not periodic).
export function vnoise2(x, y, px, py, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = sm(x - ix), fy = sm(y - iy);
  const wx = (k) => (px ? mod(k, px) : k);
  const wy = (k) => (py ? mod(k, py) : k);
  const a = hash(wx(ix), wy(iy), seed), b = hash(wx(ix + 1), wy(iy), seed);
  const c = hash(wx(ix), wy(iy + 1), seed), d = hash(wx(ix + 1), wy(iy + 1), seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
export function fbm2(x, y, px, py, seed, oct = 4) {
  let s = 0, amp = 0.5, n = 0, fr = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise2(x * fr, y * fr, px * fr, py * fr, seed + o * 17);
    n += amp; amp *= 0.5; fr *= 2;
  }
  return s / n;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const ramp = (...hex) => hex.map(hexToRgb);

// Ordered-dither pick from a ramp (array of [r,g,b]) for value v in 0..1.
export function rampPick(rp, v, x, y) {
  const n = rp.length;
  const q = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
  let i = Math.floor(q);
  if (q - i > bayer(x, y)) i++;
  return rp[i < n ? i : n - 1];
}

// Like rampPick, but dithers only in a narrow band around each step boundary
// (band = fraction of a step). Most pixels are flat colour; the checkerboard
// appears only where two tones meet — localised 90s-style dithering.
export function rampBand(rp, v, x, y, band = 0.3) {
  const n = rp.length;
  const q = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
  let i = Math.floor(q);
  const f = q - i, lo = 0.5 - band / 2;
  if (f >= lo + band) i++;
  else if (f > lo && (f - lo) / band > bayer(x, y)) i++;
  return rp[i < n ? i : n - 1];
}

export function blank(w, h) {
  return makeSprite(w, h, () => {});
}

// Build a sprite from a per-pixel function fn(x,y) → [r,g,b,a] | null.
export function pixelSprite(w, h, fn) {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      if (!c) continue;
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  return makeSprite(w, h, (ctx) => ctx.putImageData(img, 0, 0));
}
