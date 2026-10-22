// Pre-rendered UI art: HUD icons, hazard stripes, alarm bands, vignette and
// the boss schematic used in the WARNING sequence. Everything is drawn once
// into offscreen canvases (lazy, first use) and composed per frame.
import { W, H } from '../config.js';
import { makeSprite } from '../core/util.js';

const cache = new Map();
const lazy = (key, fn) => {
  let s = cache.get(key);
  if (!s) { s = fn(); cache.set(key, s); }
  return s;
};
const px = (ctx, c, x, y, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
// Draw a tiny pixel map: rows of chars, palette maps char -> colour.
function pixmap(rows, pal) {
  return makeSprite(rows[0].length, rows.length, (ctx) => {
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) px(ctx, pal[ch], x, y); }));
  });
}

// Player stock icon (9x5) — silhouette of the original fighter.
export const shipIcon = () => lazy('ship', () => pixmap([
  '.oo......',
  'owwwcc...',
  'owwwwwwwo',
  'obbbbbo..',
  '.oo......',
], { o: '#101828', w: '#e8f0ff', c: '#58c8ff', b: '#6878a8' }));

// Weapon orbs 7x7 for red (missile) / green (bomb) / blue (arm).
export function orbIcon(kind) {
  return lazy('orb' + kind, () => {
    const col = { red: ['#ff6048', '#ffc0a0', '#a01010'], green: ['#50e050', '#c8ffb0', '#106818'], blue: ['#4898ff', '#c0e8ff', '#103890'] }[kind];
    return pixmap([
      '..ooo..',
      '.ohhmo.',
      'ohhmmmo',
      'ommmmmo',
      'ommmmdo',
      '.omddo.',
      '..ooo..',
    ], { o: '#080810', h: col[1], m: col[0], d: col[2] });
  });
}

// Black-hole bomb stock icon 7x7 (swirl).
export const holeIcon = () => lazy('hole', () => pixmap([
  '..ooo..',
  '.ommmo.',
  'om.vvmo',
  'omvkvmo',
  'omvv.mo',
  '.ommmo.',
  '..ooo..',
], { o: '#080810', m: '#b070ff', v: '#5020a0', k: '#000000' }));

// Top HUD strip backing: dark band fading out downwards.
export const topStrip = () => lazy('top', () => makeSprite(W, 12, (ctx) => {
  for (let y = 0; y < 12; y++) {
    const a = y < 9 ? 0.62 : 0.62 * (1 - (y - 8) / 4);
    px(ctx, `rgba(2,6,20,${a.toFixed(3)})`, 0, y, W, 1);
  }
  px(ctx, 'rgba(120,170,255,0.22)', 0, 9, W, 1);
}));
export const bottomStrip = () => lazy('bottom', () => makeSprite(W, 12, (ctx) => {
  for (let y = 0; y < 12; y++) {
    const a = y > 2 ? 0.62 : 0.62 * (y / 3);
    px(ctx, `rgba(2,6,20,${a.toFixed(3)})`, 0, y, W, 1);
  }
  px(ctx, 'rgba(255,120,170,0.22)', 0, 2, W, 1);
}));

// Radial-ish vignette made of stepped rectangles (pixel friendly).
export const vignette = () => lazy('vig', () => makeSprite(W, H, (ctx) => {
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const d = Math.min(1, Math.max(0, Math.sqrt(dx * dx * 0.8 + dy * dy) - 0.55) / 0.6);
    const i = (y * W + x) * 4;
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
    const a = Math.floor((d * d * 0.85) * 6 + bayer) / 6; // stepped + ordered dither
    img.data[i + 2] = 8;
    img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
}));

// Hazard stripe strip (yellow/black 45deg), width = W + period for scrolling.
export const HAZ_P = 12;
export const hazard = (h = 5) => lazy('haz' + h, () => makeSprite(W + HAZ_P * 2, h, (ctx) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < W + HAZ_P * 2; x++) {
    const on = ((x + y) % HAZ_P) < HAZ_P / 2;
    px(ctx, on ? (y === 0 ? '#fff070' : '#ffc818') : '#140a04', x, y);
  }
}));

// Alarm band body (red with bright core lines), height h, wide enough to scroll.
export const alarmBand = (h) => lazy('band' + h, () => makeSprite(W, h, (ctx) => {
  for (let y = 0; y < h; y++) {
    const t = Math.abs(y - (h - 1) / 2) / (h / 2);
    const r = Math.round(200 - t * 130), g = Math.round(14 + (1 - t) * 18), b = Math.round(24 + (1 - t) * 12);
    px(ctx, `rgb(${r},${g},${b})`, 0, y, W, 1);
  }
  // fine scanlines
  for (let y = 1; y < h; y += 2) px(ctx, 'rgba(0,0,0,0.18)', 0, y, W, 1);
}));

// ---- Mecha-axolotl silhouette (our own art; matches the boss's outline:
// armoured shark-like head facing left, gill-fin fans, legs, segmented tail).
// Unit space: x 0..300 (nose at 0), y -16..100.
const HULL_TOP = [[0, 47], [10, 41], [24, 34], [45, 28], [80, 23], [110, 22], [140, 18], [175, 18], [215, 22], [250, 30], [280, 38], [300, 42]];
const HULL_BOT = [[300, 46], [280, 50], [250, 58], [215, 68], [175, 74], [140, 74], [110, 68], [80, 66], [45, 61], [20, 57], [6, 53], [2, 50]];
const FINS = [
  // upper gill fan (base -> tip pairs, drawn as blades)
  [[100, 30], [84, -10], [96, -12]], [[106, 28], [104, -16], [116, -14]], [[112, 28], [126, -10], [136, -4]], [[118, 30], [146, 4], [150, 12]],
  // lower gill fan
  [[100, 60], [86, 92], [96, 96]], [[108, 62], [110, 100], [120, 98]], [[116, 62], [132, 92], [140, 86]],
  // dorsal / ventral blades along the tail
  [[150, 19], [158, 4], [166, 18]], [[185, 19], [194, 6], [200, 20]], [[222, 24], [232, 12], [238, 27]], [[256, 32], [266, 22], [270, 36]],
  [[200, 71], [208, 86], [214, 69]], [[240, 61], [250, 76], [254, 58]], [[284, 46], [300, 30], [300, 52]],
];
const LEGS = [[[126, 72], [120, 88], [108, 94], [122, 95], [134, 86], [138, 73]], [[188, 72], [186, 88], [174, 95], [190, 96], [200, 86], [200, 71]]];
const SEGS = [110, 140, 175, 215, 250];

function hullPath(k, ox, oy) {
  const P = new Path2D();
  const pt = ([x, y]) => [ox + x * k, oy + y * k];
  [...HULL_TOP, ...HULL_BOT].forEach((q, i) => { const [x, y] = pt(q); if (i) P.lineTo(x, y); else P.moveTo(x, y); });
  P.closePath();
  for (const f of [...FINS, ...LEGS]) {
    f.forEach((q, i) => { const [x, y] = pt(q); if (i) P.lineTo(x, y); else P.moveTo(x, y); });
    P.closePath();
  }
  return P;
}
// Threshold alpha so canvas antialiasing becomes crisp pixels.
function crisp(ctx, w, h, cut = 110) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= cut ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

// Title hero: large dark silhouette with a cold rim light and dim magenta fins.
export const TITLE_SIL_K = 1.25;
export const titleSilhouette = () => lazy('tsil', () => {
  const k = TITLE_SIL_K, w = Math.ceil(300 * k) + 4, h = Math.ceil(118 * k) + 4, ox = 2, oy = 18 * k + 2;
  return makeSprite(w, h, (ctx) => {
    const P = hullPath(k, ox, oy);
    ctx.fillStyle = '#6aa0c8';
    ctx.save(); ctx.translate(0, -1); ctx.fill(P); ctx.restore(); // rim light from above
    ctx.fillStyle = '#1c3448';
    ctx.save(); ctx.translate(1, 0); ctx.fill(P); ctx.restore(); // faint back-edge
    ctx.fillStyle = '#081420';
    ctx.fill(P);
    crisp(ctx, w, h);
    // dim magenta on the gill fans, red slit lights along the hull
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(110,24,72,0.6)';
    for (const f of FINS.slice(0, 7)) {
      ctx.beginPath();
      f.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * k, oy + y * k) : ctx.moveTo(ox + x * k, oy + y * k)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1a3048';
    for (const x of SEGS) ctx.fillRect(Math.round(ox + x * k), Math.round(oy + 24 * k), 1, Math.round(40 * k));
    ctx.fillStyle = '#ff2a3a';
    for (const [x, y] of [[150, 46], [196, 46], [232, 48]]) ctx.fillRect(Math.round(ox + x * k), Math.round(oy + y * k), 3, 1);
    ctx.fillStyle = '#3a0a12';
    ctx.fillRect(Math.round(ox + 6 * k), Math.round(oy + 52 * k), Math.round(62 * k), 1); // mouth line
  });
});
export const TITLE_SIL_EYE = [52 * TITLE_SIL_K + 2, (38 + 18) * TITLE_SIL_K + 2];

// WARNING schematic: cyan wireframe of the same silhouette on a radar grid.
export const SCHEM_W = 116, SCHEM_H = 46;
export const schematic = () => lazy('schem', () => makeSprite(SCHEM_W, SCHEM_H, (ctx) => {
  px(ctx, 'rgba(0,18,24,0.88)', 0, 0, SCHEM_W, SCHEM_H);
  for (let x = 4; x < SCHEM_W; x += 8) px(ctx, 'rgba(60,200,220,0.16)', x, 1, 1, SCHEM_H - 2);
  for (let y = 4; y < SCHEM_H; y += 8) px(ctx, 'rgba(60,200,220,0.16)', 1, y, SCHEM_W - 2, 1);
  const k = 0.35, ox = 5, oy = 16 * k + 4;
  const P = hullPath(k, ox, oy);
  ctx.fillStyle = 'rgba(40,170,190,0.35)';
  ctx.fill(P);
  ctx.strokeStyle = '#7ff4ff';
  ctx.lineWidth = 1;
  ctx.stroke(P);
  ctx.strokeStyle = 'rgba(127,244,255,0.5)';
  ctx.beginPath();
  for (const x of SEGS) { ctx.moveTo(ox + x * k, oy + 22 * k); ctx.lineTo(ox + x * k, oy + 70 * k); }
  ctx.moveTo(ox + 4 * k, oy + 51 * k); ctx.lineTo(ox + 68 * k, oy + 54 * k);
  ctx.stroke();
  px(ctx, '#ff5a8a', Math.round(ox + 52 * k), Math.round(oy + 37 * k), 2, 2);
  px(ctx, '#ff5a8a', Math.round(ox + 160 * k), Math.round(oy + 46 * k), 2, 2);
  ctx.strokeStyle = '#4ad8f0';
  ctx.strokeRect(0.5, 0.5, SCHEM_W - 1, SCHEM_H - 1);
  for (const [x, y] of [[0, 0], [SCHEM_W - 4, 0], [0, SCHEM_H - 4], [SCHEM_W - 4, SCHEM_H - 4]]) px(ctx, '#c8ffff', x, y, 4, 4);
}));

// Key-cap icon for the controls panel: label drawn later with the pixel font.
export const keyCap = (w) => lazy('key' + w, () => makeSprite(w, 11, (ctx) => {
  px(ctx, '#0a0c16', 0, 0, w, 11);
  px(ctx, '#c8d0e4', 1, 0, w - 2, 1);
  px(ctx, '#8890a8', 0, 1, 1, 9);
  px(ctx, '#3a4058', w - 1, 1, 1, 9);
  px(ctx, '#2a3046', 1, 10, w - 2, 1);
  px(ctx, '#5a6280', 1, 9, w - 2, 1);
  px(ctx, '#363c56', 1, 1, w - 2, 8);
  px(ctx, '#4a5272', 1, 1, w - 2, 1);
}));


// Horizontal gradient bar fills used by the boss gauge (stepped colours).
export const gaugeFill = (w, h) => lazy(`gauge${w}x${h}`, () => makeSprite(w, h, (ctx) => {
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    // left (empty side) deep red -> right orange -> yellow-white core row
    const r = 255, g = Math.round(40 + t * 150), b = Math.round(40 + t * 40);
    for (let y = 0; y < h; y++) {
      const k = y === 0 ? 1.25 : y === h - 1 ? 0.6 : 1;
      px(ctx, `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`, x, y);
    }
  }
  for (let x = 3; x < w; x += 4) px(ctx, 'rgba(0,0,0,0.28)', x, 0, 1, h);
}));

// HUD weapon icon boxes (11x11): framed pictograms for LASER / W WAVE / HOMING / SHIELD.
const ICON_PAL = {
  laser: { f: '#ff5040', a: '#ffffff', b: '#ff3828', c: '#7a1010' },
  wave: { f: '#40d860', a: '#d8ffd0', b: '#38c050', c: '#0e5018' },
  homing: { f: '#4890ff', a: '#ffffff', b: '#3a78f0', c: '#102c70' },
  shield: { f: '#48c8ff', a: '#e0faff', b: '#30a0e8', c: '#0c3c64' },
};
const ICON_ROWS = {
  laser: ['.........', '.........', 'bb.......', '.bbbaaa..', 'cbaaaaaaa', '.bbbaaa..', 'bb.......', '.........', '.........'],
  wave: ['....a....', '.a..a..a.', '.b..a..b.', '..b.b.b..', 'bb.bab.bb', '..b.b.b..', '.b..b..b.', '.c..c..c.', '....c....'],
  homing: ['.........', '....a....', '.....a...', 'bbbbbaa..', 'aaaaaaaa.', 'bbbbbaa..', '.....a...', '....a....', '.........'],
  shield: ['..bbbbb..', '.b.....b.', 'b..aaa..b', 'b.a...a.b', 'b.a.c.a.b', 'b.a...a.b', 'b..aaa..b', '.b.....b.', '..bbbbb..'],
};
export function weaponIcon(kind) {
  return lazy('wicon' + kind, () => {
    const P = ICON_PAL[kind];
    return makeSprite(11, 11, (ctx) => {
      px(ctx, P.f, 0, 0, 11, 11);
      px(ctx, '#05060c', 1, 1, 9, 9);
      px(ctx, 'rgba(255,255,255,0.35)', 1, 1, 9, 1);
      ICON_ROWS[kind].forEach((r, y) => [...r].forEach((ch, x) => { if (P[ch]) px(ctx, P[ch], x + 1, y + 1); }));
    });
  });
}
