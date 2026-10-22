// Pre-rendered FX sprite sheets (bg/fx agent). Built once at boot.
//   fireball sheets (small/medium/large), smoke puff sheet, flash stars,
//   bubbles, tiny pixel digit font, debris chunk generator (per CSS colour).
import { makeSprite } from '../core/util.js';
import { fbm2, ramp, rampPick, pixelSprite, hash, bayer } from './bg-noise.js';
import { makeBubbles } from './bg-art.js';

const easeOut = (t) => 1 - (1 - t) ** 3;

// hot → cold. index 0..2 = underwater smoke, 3.. = fire
const FIRE = ramp('#18202c', '#28303c', '#3a3a46', '#5c2418', '#962c12', '#cf4f14', '#f27d1c', '#ffae2e', '#ffd95a', '#fff2a8', '#ffffff');

// Fireball sheet: `frames` frames of size SW x SH, packed horizontally.
// shape: 'round' | 'lobed' (3-4 merged billows) | 'long' (elongated puff).
function fireSheet(R, frames, seed, shape = 'round') {
  const sx = shape === 'long' ? 1.55 : 1, sy = shape === 'long' ? 0.75 : 1;
  const SW = Math.ceil(R * 2.5 * sx) + 2, SH = Math.ceil(R * 2.5 * sy) + 2;
  const cx = SW / 2, cy = SH / 2;
  // lobe centres (normalised to R)
  const lobes = [[0, 0, 1]];
  if (shape === 'lobed') {
    const n = 3 + (seed % 2);
    for (let i = 0; i < n; i++) {
      const a = hash(i, 1, seed) * Math.PI * 2, d = 0.35 + 0.2 * hash(i, 2, seed);
      lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.55 + 0.2 * hash(i, 3, seed)]);
    }
    lobes[0][2] = 0.75;
  }
  const sheet = makeSprite(SW * frames, SH, () => {});
  const sctx = sheet.getContext('2d');
  for (let f = 0; f < frames; f++) {
    const p = f / (frames - 1);
    const rad = R * (0.32 + 0.78 * easeOut(Math.min(1, p / 0.5)));
    const fr = pixelSprite(SW, SH, (x, y) => {
      const dx = (x + 0.5 - cx) / sx, dy = (y + 0.5 - cy) / sy;
      // distance in "edge units" to the closest lobe
      let dn = 1e9;
      for (const [lx, ly, lr] of lobes) {
        const ex = dx - lx * rad, ey = dy - ly * rad;
        const v = Math.sqrt(ex * ex + ey * ey) / (rad * lr);
        if (v < dn) dn = v;
      }
      const n = fbm2(x / (R * 0.32) + seed, y / (R * 0.32), 0, 0, seed, 3);
      const n2 = fbm2(x / (R * 0.22), y / (R * 0.22) + p * 2.2, 0, 0, seed + 9, 3);
      const e = 0.78 + 0.44 * n;
      if (dn > e) return null;
      if (p > 0.45 && n2 < (p - 0.45) * 1.7) return null;          // break into puffs
      const core = 1 - dn / e;
      let heat = Math.pow(core, 0.65) * 0.55 + (1 - p) * 0.95 - 0.38 + (n2 - 0.5) * 0.55;
      heat += (-dy / R) * 0.06;                                     // hotter on top
      if (dn > e - 1.2 / rad && heat > 0.35) heat -= 0.22;          // dark contour
      if (heat < -0.05) {
        if (p < 0.35) return null;
        return [...rampPick(FIRE, 0.12 + heat * 0.2, x, y), 230];
      }
      return [...rampPick(FIRE, 0.18 + heat * 0.82, x, y), 255];
    });
    sctx.drawImage(fr, f * SW, 0);
  }
  return { sheet, S: SW, SW, SH, frames };
}

// smoke puff: blue-grey, expands and dissolves (drawn behind the player).
function smokeSheet(rpIn) {
  const S = 16, frames = 8, c = S / 2;
  const rp = rpIn || ramp('#122236', '#1a2e44', '#243c54', '#304c66', '#40607a');
  const sheet = makeSprite(S * frames, S, () => {});
  const sctx = sheet.getContext('2d');
  for (let f = 0; f < frames; f++) {
    const p = f / (frames - 1);
    const rad = 3 + 4.5 * easeOut(p);
    const fr = pixelSprite(S, S, (x, y) => {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm2(x / 3, y / 3 + p, 0, 0, 77, 2);
      if (d > rad * (0.75 + 0.5 * n)) return null;
      if (n < p * 0.6 - 0.02) return null;
      const v = 0.25 + (-dy / rad) * 0.35 + (n - 0.5) * 0.6 + (1 - p) * 0.2;
      const edge = d > rad * (0.55 + 0.3 * n);
      return [...rampPick(rp, v, x, y), Math.round((edge ? 90 : 150) * (1 - p * 0.45))];
    });
    sctx.drawImage(fr, f * S, 0);
  }
  return { sheet, S, frames };
}

// impact flash star: white core, yellow cross spikes. 3 sizes x 3 frames.
function flashSprites() {
  return [5, 10, 18].map((r) => {
    const S = r * 2 + 3, c = S / 2;
    const out = [];
    for (let f = 0; f < 3; f++) {
      const k = 1 - f * 0.3;
      out.push(pixelSprite(S, S, (x, y) => {
        const dx = Math.abs(x + 0.5 - c), dy = Math.abs(y + 0.5 - c);
        const d = Math.sqrt(dx * dx + dy * dy);
        const coreR = r * 0.55 * k;
        if (d < coreR * 0.6) return [255, 255, 255, 255];
        if (d < coreR) return [255, 250, 200, 255];
        // 4 main spikes + 4 short diagonals
        const spike = Math.min(dx, dy);
        const diag = Math.abs(dx - dy);
        if (spike < 1.1 && d < r * k) return d < r * 0.7 * k ? [255, 240, 160, 255] : [255, 190, 80, 220];
        if (diag < 1.0 && d < r * 0.6 * k) return [255, 220, 120, 200];
        if (d < coreR + 1.5 && bayer(x, y) < 0.5) return [255, 200, 90, 200];
        return null;
      }));
    }
    return out;
  });
}

// glow disc for additive hot flashes (huge explosions)
function glowSprite(r) {
  const S = r * 2 + 2;
  return pixelSprite(S, S, (x, y) => {
    const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / r;
    if (d >= 1) return null;
    const q = Math.round((1 - d) ** 1.5 * 5) / 5;
    if (q <= 0) return null;
    return [255, 200, 120, Math.round(q * 150)];
  });
}

// --------------------------------------------------------- pixel digits
const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001011001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
};
const DIGIT_SCHEMES = [
  [[255, 255, 255], [255, 232, 120], [40, 16, 0]],    // normal: white→yellow, dark outline
  [[200, 255, 255], [90, 200, 255], [0, 12, 40]],     // bonus: cyan
];
// Render a number string to a sprite with outline. scale 1 or 2.
export function digitSprite(str, scheme = 0, scale = 1) {
  const [c0, c1, ol] = DIGIT_SCHEMES[scheme];
  const n = str.length, gw = 4 * n + 1, gh = 7;
  const on = new Uint8Array(gw * gh);
  for (let i = 0; i < n; i++) {
    const g = GLYPHS[str[i]];
    if (!g) continue;
    for (let k = 0; k < 15; k++) if (g[k] === '1') on[(1 + ((k / 3) | 0)) * gw + 1 + i * 4 + (k % 3)] = 1;
  }
  const base = pixelSprite(gw, gh, (x, y) => {
    if (on[y * gw + x]) return y <= 3 ? c0 : c1;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && on[yy * gw + xx]) return ol;
    }
    return null;
  });
  if (scale === 1) return base;
  return makeSprite(gw * scale, gh * scale, (ctx) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0, gw * scale, gh * scale); });
}

// ---------------------------------------------------------- debris chunks
let colorCtx = null;
function cssToRgb(css) {
  // fast paths (no canvas readback): #rgb, #rrggbb, rgb()/rgba()
  let m = /^#([0-9a-f]{3})$/i.exec(css);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})/i.exec(css);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(css);
  if (m) return [+m[1] | 0, +m[2] | 0, +m[3] | 0];
  if (!colorCtx) colorCtx = makeSprite(1, 1, () => {}).getContext('2d', { willReadFrequently: true });
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const chunkCache = new Map();
// 4 chunk shapes for a colour, shaded (lit top-left), dark outline.
export function chunkSprites(css) {
  let arr = chunkCache.get(css);
  if (arr) return arr;
  const [r, g, b] = cssToRgb(css);
  const shadeC = (k) => [Math.min(255, Math.round(r * k)), Math.min(255, Math.round(g * k)), Math.min(255, Math.round(b * k))];
  arr = [];
  for (let v = 0; v < 4; v++) {
    const S = 6 + v * 2, c = S / 2;
    const nv = 5 + (v % 3);
    const rad = [];
    for (let i = 0; i < nv; i++) rad.push(c * (0.6 + 0.4 * hash(i, v, 333)));
    const inside = (x, y) => {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) * nv;
      const i = Math.floor(a) % nv, f = a - Math.floor(a);
      const rr = rad[i] * (1 - f) + rad[(i + 1) % nv] * f;
      return Math.hypot(dx, dy) <= rr - 0.5;
    };
    arr.push(pixelSprite(S, S, (x, y) => {
      if (!inside(x, y)) {
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(x + ox, y + oy)) return [12, 10, 16];
        return null;
      }
      const lit = !inside(x - 1, y - 1) ? 1.45 : !inside(x + 1, y + 1) ? 0.5 : (x + y) % 5 === 0 ? 0.8 : 1;
      return shadeC(lit);
    }));
  }
  chunkCache.set(css, arr);
  return arr;
}

let ART = null;
export function getFxArt() {
  if (ART) return ART;
  ART = {
    // fire[size] = variants (round, lobed, elongated); size 3 = boss-death scale
    fire: [
      [fireSheet(8, 10, 3), fireSheet(8, 10, 4, 'lobed'), fireSheet(8, 10, 5, 'long')],
      [fireSheet(15, 12, 7), fireSheet(15, 12, 8, 'lobed'), fireSheet(15, 12, 9, 'long')],
      [fireSheet(26, 14, 11), fireSheet(26, 14, 12, 'lobed'), fireSheet(26, 14, 13, 'long')],
      [fireSheet(46, 16, 19), fireSheet(46, 16, 21, 'lobed')],
    ],
    smoke: smokeSheet(),
    mud: smokeSheet(ramp('#1e140e', '#2c1e14', '#3c2a1c', '#4e3826', '#644a32')),
    flash: flashSprites(),
    glow: glowSprite(40),
    bubbles: makeBubbles(),
  };
  chunkSprites('#5a6474'); chunkSprites('#6e7a8c'); chunkSprites('#4e5868'); // pre-warm default debris
  return ART;
}
