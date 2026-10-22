// Original bitmap fonts (no system fonts anywhere).
//   Small font: 5x7 glyphs, 6px advance, rendered per colour style into cached
//   sprite sheets (one row-palette per style + a shadow sheet).
//   Big font: the same glyph data emboldened (horizontal dilation), upscaled by
//   an integer factor with diagonal smoothing, optionally italic, then shaded
//   per pixel row with a stepped "chrome" palette + dark outline, top bevel
//   highlight and drop shadow. Glyph sprites are cached per (char,style,scale).
//
// API:
//   drawText(ctx, str, x, y, {style='white', align='left', scale=1, shadow=true, alpha})
//   textWidth(str, scale=1)
//   bigText(str, {style='steel', scale=3, italic=false, gap}) -> cached canvas
//   drawBig(ctx, str, cx, y, opts) draws a bigText sprite centred at cx

import { makeSprite } from '../core/util.js';

const G = {
  A: '..#...#.#.#...##...#######...##...#',
  B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####',
  F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####',
  H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#.#..#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#',
  L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#',
  N: '#...###..##.#.##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#',
  R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.###.#...##.....###.....##...#.###.',
  T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...#.#.#..#.#...#..',
  W: '#...##...##...##.#.##.#.###.###...#',
  X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..',
  Z: '#####....#...#...#...#...#....#####',
  0: '.###.#...##..###.#.###..##...#.###.',
  1: '..#...##....#....#....#....#...###.',
  2: '.###.#...#....#...#...#...#...#####',
  3: '#####...#...#.....#.....##...#.###.',
  4: '...#...##..#.#.#..#.#####...#....#.',
  5: '######....####.....#....##...#.###.',
  6: '..##..#...#....####.#...##...#.###.',
  7: '#####....#...#...#...#....#....#...',
  8: '.###.#...##...#.###.#...##...#.###.',
  9: '.###.#...##...#.####....#...#..##..',
  ' ': '...................................',
  '!': '..#....#....#....#....#.........#..',
  '"': '.#.#..#.#..#.#.....................',
  "'": '..#....#...#.......................',
  '-': '................###................',
  '..........................##...##..': '.........................##...##..',
  ',': '.....................##....#...#...',
  ':': '......##...##........##...##.......',
  ';': '......##...##........##....#...#...',
  '/': '....#....#...#...#...#...#....#....',
  '?': '.###.#...#....#...#...#.........#..',
  '(': '...#...#...#....#....#.....#.....#.',
  ')': '.#.....#.....#....#....#...#...#...',
  '+': '.......#....#..#####..#....#.......',
  '=': '..........#####.....#####..........',
  '*': '.....#...#.#.#...#...#.#.#...#.....',
  '%': '##..###..#...#...#...#...#..###..##',
  '_': '..............................#####',
  '>': '.#.....#.....#.....#...#...#...#...',
  '<': '...#...#...#...#.....#.....#.....#.',
  '#': '.#.#..#.#.#####.#.#.#####.#.#..#.#.',
  '[': '.###..#....#....#....#....#....###.',
  ']': '.###....#....#....#....#....#..###.',
  'α': '...........##.##..#.#..#.#..#..##.#',
  '©': '.###.#...##.#.##.#.##...#.###......',
  '~': '.......#.....#.#####...#...#.......', // right arrow
  '^': '..#...###.#.#.#..#....#....#.......', // up arrow
  '|': '..#....#....#....#....#....#....#..',
  '←': '.......#...#...#####.#.....#.......',
  '→': '.......#.....#.#####...#...#.......',
  '↑': '..#...###.#.#.#..#....#....#.......',
  '↓': '.......#....#....#..#.#.#.###...#..',
};

// Normalise all glyphs to exactly 35 cells (some strings above are hand-typed
// one short; pad on the right so data errors never crash).
const GLYPH = {};
for (const [k, s] of Object.entries(G)) GLYPH[k] = (s + '.'.repeat(35)).slice(0, 35);
const CHARS = Object.keys(GLYPH);
const INDEX = new Map(CHARS.map((c, i) => [c, i]));
const gIdx = (ch) => {
  if (INDEX.has(ch)) return INDEX.get(ch);
  const u = ch.toUpperCase();
  if (INDEX.has(u)) return INDEX.get(u);
  if (ch === '—' || ch === '–') return INDEX.get('-');
  if (ch === '“' || ch === '”') return INDEX.get('"');
  return INDEX.get('?');
};
const bit = (ch, x, y) => x >= 0 && x < 5 && y >= 0 && y < 7 && GLYPH[CHARS[gIdx(ch)]][y * 5 + x] === '#';

// ---------- small font ----------
const STYLES = {
  white: ['#ffffff', '#ffffff', '#f4f6ff', '#e8ecff', '#dde2f6', '#cfd6ee', '#bfc8e4'],
  gold: ['#fffbd0', '#fff07a', '#ffe050', '#ffc830', '#ffa820', '#f08818', '#d86810'],
  cyan: ['#e8ffff', '#b8f8ff', '#80e8ff', '#58d0ff', '#40b0f0', '#3090e0', '#2878c8'],
  red: ['#ffe0d0', '#ffa088', '#ff6050', '#ff3838', '#e82028', '#c81020', '#a00818'],
  pink: ['#fff0f8', '#ffd0e8', '#ffb0d8', '#ff90c8', '#f878b8', '#e060a0', '#c84888'],
  grey: ['#c8d0e0', '#b8c0d4', '#a8b0c8', '#98a0bc', '#8890b0', '#7880a4', '#687098'],
  green: ['#e8ffe0', '#b8ffa8', '#88f080', '#60e060', '#40c848', '#30a838', '#208828'],
  dim: ['#6878a0', '#6070a0', '#586898', '#506090', '#485888', '#405080', '#384878'],
  dark: ['#100818', '#100818', '#100818', '#100818', '#100818', '#100818', '#100818'],
};
const sheets = new Map();
function sheet(style) {
  let s = sheets.get(style);
  if (s) return s;
  const rows = STYLES[style] || STYLES.white;
  s = makeSprite(CHARS.length * 6, 7, (ctx) => {
    for (let i = 0; i < CHARS.length; i++) {
      const g = GLYPH[CHARS[i]];
      for (let y = 0; y < 7; y++) {
        ctx.fillStyle = rows[y];
        for (let x = 0; x < 5; x++) if (g[y * 5 + x] === '#') ctx.fillRect(i * 6 + x, y, 1, 1);
      }
    }
  });
  sheets.set(style, s);
  return s;
}

export function textWidth(str, scale = 1) {
  return str.length ? (str.length * 6 - 1) * scale : 0;
}

export function drawText(ctx, str, x, y, opts = {}) {
  const { style = 'white', align = 'left', scale = 1, shadow = true, alpha = 1, shadowStyle = 'dark' } = opts;
  str = String(str);
  if (!str.length || alpha <= 0) return;
  const w = textWidth(str, scale);
  let x0 = align === 'center' ? x - (w >> 1) : align === 'right' ? x - w : x;
  x0 = Math.round(x0);
  y = Math.round(y);
  const prevS = ctx.imageSmoothingEnabled;
  const prevA = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = prevA * alpha;
  const passes = shadow ? [[sheet(shadowStyle), scale], [sheet(style), 0]] : [[sheet(style), 0]];
  for (const [sh, off] of passes) {
    for (let i = 0; i < str.length; i++) {
      const gi = gIdx(str[i]);
      if (CHARS[gi] === ' ') continue;
      ctx.drawImage(sh, gi * 6, 0, 5, 7, x0 + i * 6 * scale + off, y + off, 5 * scale, 7 * scale);
    }
  }
  ctx.globalAlpha = prevA;
  ctx.imageSmoothingEnabled = prevS;
}

// ---------- big chrome font ----------
// Palettes: [t, '#rrggbb'] stops over glyph height; a hard "horizon" makes it chrome.
export const CHROME = {
  steel: [[0, '#ffffff'], [0.18, '#e4f2ff'], [0.42, '#86b4ec'], [0.49, '#4a6cb8'], [0.5, '#141a40'], [0.58, '#2c2c5c'], [0.74, '#a46a98'], [0.9, '#ffc4e0'], [1, '#fff0f8']],
  red: [[0, '#fff6ea'], [0.2, '#ffc4a8'], [0.44, '#ff4a3a'], [0.49, '#c81424'], [0.5, '#3a0008'], [0.6, '#7a0c18'], [0.78, '#ff4a20'], [0.92, '#ffb040'], [1, '#fff0a0']],
  hot: [[0, '#ffffff'], [0.45, '#fff4e8'], [0.5, '#ffb0a0'], [0.7, '#ffe0c0'], [1, '#ffffff']],
  gold: [[0, '#fffff4'], [0.22, '#fff09a'], [0.44, '#e8b030'], [0.49, '#a06810'], [0.5, '#381800'], [0.6, '#704010'], [0.78, '#e8a030'], [0.92, '#ffe890'], [1, '#fffbe0']],
  pink: [[0, '#ffffff'], [0.2, '#ffe0f0'], [0.44, '#ff8cc8'], [0.49, '#d0508c'], [0.5, '#3c0c2c'], [0.6, '#6c1c4c'], [0.78, '#e070a8'], [0.92, '#ffc4e4'], [1, '#fff4fa']],
  cyan: [[0, '#ffffff'], [0.2, '#d8fbff'], [0.44, '#5ad4ff'], [0.49, '#2a8ad0'], [0.5, '#0a1c3a'], [0.6, '#123a60'], [0.78, '#3aa0d8'], [0.92, '#b0f0ff'], [1, '#f0ffff']],
};
const OUTLINE = { steel: [8, 6, 24], red: [24, 0, 4], hot: [80, 0, 8], gold: [24, 10, 0], pink: [24, 4, 18], cyan: [4, 10, 24] };

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function paletteAt(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const a = hex(c0), b = hex(c1);
      return [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k));
    }
  }
  return hex(stops[stops.length - 1][1]);
}

// Bold glyph cell (6x7): OR of the glyph with itself shifted right by 1.
const bold = (ch, x, y) => bit(ch, x, y) || bit(ch, x - 1, y);

function inkCols(ch) {
  let lo = 6, hi = -1;
  for (let x = 0; x < 6; x++) for (let y = 0; y < 7; y++) if (bold(ch, x, y)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return hi < 0 ? [0, 2] : [lo, hi];
}

function glyphMask(ch, S, italic) {
  const [c0, c1] = inkCols(ch);
  const gw = (c1 - c0 + 1) * S, gh = 7 * S;
  const slant = italic ? Math.ceil(gh * 0.22) : 0;
  const w = gw + slant, h = gh;
  const m = new Uint8Array(w * h);
  for (let py = 0; py < gh; py++) {
    const sh = italic ? Math.floor((gh - 1 - py) * 0.22) : 0;
    for (let px = 0; px < gw; px++) {
      const cx = c0 + Math.floor(px / S), cy = Math.floor(py / S);
      let on = bold(ch, cx, cy);
      if (!on && S > 1) {
        // Diagonal smoothing: fill the corner triangle of an empty cell whose
        // two orthogonal neighbours toward that corner are both set.
        const lx = px - (cx - c0) * S, ly = py - cy * S;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (bold(ch, cx + dx, cy) && bold(ch, cx, cy + dy)) {
            const ax = dx < 0 ? lx : S - 1 - lx, ay = dy < 0 ? ly : S - 1 - ly;
            if (ax + ay < S - 1) { on = true; break; }
          }
        }
      }
      if (on) m[py * w + px + sh] = 1;
    }
  }
  return { m, w, h, ink: gw };
}

const bigCache = new Map();
function bigGlyph(ch, style, S, italic) {
  const key = `${ch}|${style}|${S}|${italic ? 1 : 0}`;
  let g = bigCache.get(key);
  if (g) return g;
  const { m, w, h, ink } = glyphMask(ch, S, italic);
  const stops = CHROME[style] || CHROME.steel;
  const ol = OUTLINE[style] || OUTLINE.steel;
  const pad = 2, sh = Math.max(1, S >> 1);
  const cw = w + pad * 2 + sh, chh = h + pad * 2 + sh;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  g = makeSprite(cw, chh, (ctx) => {
    const img = ctx.createImageData(cw, chh);
    const d = img.data;
    const put = (x, y, r, gg, b, a) => {
      const i = (y * cw + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = a;
    };
    // solid extrusion (depth sh) — gives the big font a heavy, embossed look
    const ex = [Math.min(255, ol[0] + 30), Math.min(255, ol[1] + 24), Math.min(255, ol[2] + 40)];
    for (let dd = sh; dd >= 1; dd--) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) put(x + pad + dd, y + pad + dd, ex[0], ex[1], ex[2], dd === sh ? 200 : 255);
    // outline (8-neighbour dilation)
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (at(x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n |= at(x + dx, y + dy);
      if (n) put(x + pad, y + pad, ol[0], ol[1], ol[2], 255);
    }
    // body
    for (let y = 0; y < h; y++) {
      const c = paletteAt(stops, (y + 0.5) / h);
      for (let x = 0; x < w; x++) {
        if (!at(x, y)) continue;
        let [r, gg, b] = c;
        if (!at(x, y - 1)) { r = Math.min(255, r + 70); gg = Math.min(255, gg + 70); b = Math.min(255, b + 70); } // top bevel
        else if (!at(x - 1, y)) { r = Math.min(255, r + 30); gg = Math.min(255, gg + 30); b = Math.min(255, b + 30); } // left bevel
        else if (!at(x + 1, y) || !at(x, y + 1)) { r = r * 0.62; gg = gg * 0.62; b = b * 0.7; } // bottom/right shade
        put(x + pad, y + pad, r | 0, gg | 0, b | 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  g.adv = ink;
  g.pad = pad;
  bigCache.set(key, g);
  return g;
}

// x offsets of each character for a big string (matches bigText layout)
export function bigLayout(str, opts = {}) {
  const { style = 'steel', scale = 3, italic = false, gap = Math.max(1, scale - 1) } = opts;
  const pos = [];
  let x = 0;
  for (const ch of str) {
    pos.push(x);
    x += ch === ' ' ? 3 * scale + gap : bigGlyph(ch, style, scale, italic).adv + gap;
  }
  return pos;
}

const bigTextCache = new Map();
// Compose a whole string into one cached canvas.
export function bigText(str, opts = {}) {
  const { style = 'steel', scale = 3, italic = false, gap = Math.max(1, scale - 1) } = opts;
  const key = `${str}|${style}|${scale}|${italic ? 1 : 0}|${gap}`;
  let c = bigTextCache.get(key);
  if (c) return c;
  const glyphs = [...str].map((ch) => (ch === ' ' ? null : bigGlyph(ch, style, scale, italic)));
  const sp = 3 * scale;
  let w = 0, x = 0;
  const pos = [];
  for (let i = 0; i < glyphs.length; i++) {
    pos.push(x);
    const adv = glyphs[i] ? glyphs[i].adv + gap : sp + gap;
    x += adv;
  }
  const any = glyphs.find(Boolean) || bigGlyph('A', style, scale, italic);
  const last = glyphs[glyphs.length - 1];
  w = Math.max(1, x - gap + (last ? last.width - last.adv : any.width - any.adv));
  const h = any.height;
  c = makeSprite(w, h, (ctx) => {
    // draw in two passes so outlines/shadows never overlap a neighbour's face
    for (let i = 0; i < glyphs.length; i++) if (glyphs[i]) ctx.drawImage(glyphs[i], pos[i], 0);
  });
  c.pad = any.pad;
  bigTextCache.set(key, c);
  return c;
}

// Draw a big text centred on cx with its glyph top at y. opts.sx scales X (for
// expand-in effects), opts.alpha fades.
export function drawBig(ctx, str, cx, y, opts = {}) {
  const c = bigText(str, opts);
  const sx = opts.sx === undefined ? 1 : opts.sx;
  const sy = opts.sy === undefined ? 1 : opts.sy;
  if (sx <= 0 || sy <= 0) return c;
  const w = Math.max(1, Math.round(c.width * sx)), h = Math.max(1, Math.round(c.height * sy));
  const prevS = ctx.imageSmoothingEnabled, prevA = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) ctx.globalAlpha = prevA * opts.alpha;
  ctx.drawImage(c, Math.round(cx - w / 2), Math.round(y - c.pad * sy + (c.height - h) / 2 * 0), w, h);
  ctx.globalAlpha = prevA;
  ctx.imageSmoothingEnabled = prevS;
  return c;
}
