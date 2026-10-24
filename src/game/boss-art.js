
import { makeSprite } from '../core/util.js';

const hex = (s) => {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const ramp = (a) => a.map(hex);

// ---- palette -------------------------------------------------------------
const NORMAL = {
  skin: ramp(['#2c0a24', '#5a173f', '#8e2758', '#c1406f', '#e4688e', '#f797b1', '#ffc4d2', '#fff0f4']),
  belly: ramp(['#3c1232', '#6e2550', '#a8466f', '#d87493', '#f4a6bb', '#ffd2dc', '#fff5f7']),
  throat: ramp(['#3a0d38', '#6a1d5e', '#a2348a', '#d45cb2', '#f494d4', '#ffd0ee']),
  armor: ramp(['#0a0f1a', '#151e2e', '#22304a', '#34465f', '#4c6079', '#6c8199', '#97aabe', '#cfdbe8', '#ffffff']),
  iron: ramp(['#08090f', '#12141e', '#1f2230', '#30344a', '#474d66', '#6a7290', '#a0a8c4']),
  gill: ramp(['#2a0420', '#520c3c', '#86145c', '#b8207a', '#e23f98', '#ff78b8', '#ffb4d8']),
  fil: ramp(['#46082c', '#84165a', '#c42882', '#ee4ea2', '#ff86c2', '#ffbcdc', '#fff0f8']),
  fin: ramp(['#2c0420', '#5c0c40', '#901864', '#c42a86', '#e64ea4', '#ff86c4', '#ffc4e2']),
  maw: ramp(['#120106', '#2a040e', '#4c0818', '#781226', '#a8213a', '#d84458']),
  lens: ramp(['#040208', '#0c0616', '#1a0e28', '#2e1a44', '#4c3068']),
  raw: ramp(['#1c0206', '#3e0610', '#6c0e1c', '#a01e2a', '#d24a4a', '#f2847a']),
  brass: ramp(['#1e1206', '#3e2a0c', '#6a4a16', '#a07a28', '#d4ae48', '#ffe28e']),
  hull: ramp(['#120e16', '#28222c', '#433b46', '#625864', '#857a86', '#a99ea8', '#cbc2ca', '#e7e0e5', '#fbf8fa']),
  red: ramp(['#24030a', '#4c0812', '#7c0e1c', '#b01a28', '#de2c36', '#ff5a52', '#ff9c88']),
  redglow: ramp(['#7c0e1c', '#c41a28', '#ff3a3a', '#ff7a62', '#ffc0a8', '#ffffff']),
  vane: ramp(['#2a0418', '#520a2e', '#7e0e44', '#a8145a', '#cc1e6a', '#e8407e', '#fa7aa2', '#ffc2d4']),
  spine: ramp(['#14020c', '#2c0620', '#480c34', '#681448', '#8a1e5c', '#b03474']),
  membrane: ramp(['#1e0414', '#360828', '#520e3a', '#6e164c', '#8c225e']),
  glowpink: ramp(['#5a0a3a', '#a01868', '#e2409a', '#ff86c6', '#ffd0ea', '#ffffff']),
};
const RED = {
  ...NORMAL,
  skin: ramp(['#2a040c', '#5a0a18', '#901626', '#c42a36', '#e8504c', '#fa8370', '#ffb8a0', '#ffe8de']),
  belly: ramp(['#380a14', '#6c1622', '#a62c36', '#d8564e', '#f48c78', '#ffc4b0', '#fff0ea']),
  throat: ramp(['#3a060e', '#701020', '#ac2034', '#e04850', '#ff8a7c', '#ffc8b8']),
  fin: ramp(['#380810', '#6a1420', '#a42838', '#d65050', '#f4887a', '#ffbcac', '#ffece4']),
  gill: ramp(['#300408', '#5e0a12', '#94141c', '#c82628', '#f04a3a', '#ff8a64', '#ffc4a0']),
  fil: ramp(['#4a0810', '#8c141c', '#ca2a2a', '#f45640', '#ff9068', '#ffc8a4', '#fff0e4']),
  vane: ramp(['#2a0408', '#540a12', '#82101c', '#ae1826', '#d22a30', '#ee4a40', '#fe8064', '#ffc0a4']),
  membrane: ramp(['#200406', '#3a0810', '#56101a', '#721a22', '#90262a']),
};
// FINAL FORM: gill-fins burn like flame fronds
const FLAME = {
  ...NORMAL,
  vane: ramp(['#3a0804', '#6e1406', '#a8280a', '#e04a10', '#ff7a1c', '#ffae3a', '#ffd870', '#fff4c0']),
  spine: ramp(['#1c0402', '#3c0a04', '#661408', '#94240c', '#c03c14', '#ff6a20']),
  membrane: ramp(['#2a0604', '#4c0e06', '#74180a', '#a0280e', '#d04014']),
  fil: ramp(['#5a1006', '#a0280a', '#e04a10', '#ff7a1c', '#ffae3a', '#ffd870', '#fff4c0']),
  gill: ramp(['#3a0804', '#6e1406', '#a8280a', '#e04a10', '#ff7a1c', '#ffae3a', '#ffd870']),
};
export const OUTLINE = hex('#100614');

// shading parameters per material
const MAT = {
  skin: { amb: 0.2, dither: 0.75, rim: 0.28, sss: 0.1 },
  belly: { amb: 0.28, dither: 0.75, rim: 0.2, sss: 0.08 },
  throat: { amb: 0.3, dither: 0.8, rim: 0.2, sss: 0.15 },
  armor: { amb: 0.12, dither: 0.2, rim: 0.32, spec: 1, specPow: 22 },
  iron: { amb: 0.12, dither: 0.25, rim: 0.2, spec: 0.7, specPow: 14 },
  gill: { amb: 0.25, dither: 0.6, rim: 0.3, sss: 0.15 },
  fil: { amb: 0.35, dither: 0.6, rim: 0.3, sss: 0.2 },
  fin: { amb: 0.3, dither: 0.7, rim: 0.3, sss: 0.15 },
  maw: { amb: 0.15, dither: 0.6, rim: 0 },
  lens: { amb: 0.2, dither: 0.2, rim: 0, spec: 1, specPow: 30 },
  raw: { amb: 0.2, dither: 0.6, rim: 0.2 },
  brass: { amb: 0.15, dither: 0.2, rim: 0.3, spec: 1, specPow: 16 },
  glowpink: { amb: 0.7, dither: 0.4, rim: 0 },
  vane: { amb: 0.32, dither: 0.1, rim: 0.22 },
  spine: { amb: 0.25, dither: 0.1, rim: 0.2, spec: 0.5, specPow: 12 },
  membrane: { amb: 0.3, dither: 0.1, rim: 0.1, alpha: 225 },
  hull: { amb: 0.13, dither: 0.3, rim: 0.32, spec: 0.85, specPow: 34 },
  red: { amb: 0.22, dither: 0.3, rim: 0.25, spec: 0.6, specPow: 16 },
  redglow: { amb: 0.75, dither: 0.3, rim: 0 },
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const LIGHT = norm3(-0.38, -0.8, 0.52);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);

// ---- primitive tests: return [nx, ny, nz] or null -------------------------
function testPrim(p, x, y) {
  if (p.k === 'e') {
    const dx = x - p.x, dy = y - p.y;
    const c = p.cos, s = p.sin;
    const u = (dx * c + dy * s) / p.rx, v = (-dx * s + dy * c) / p.ry;
    const d = u * u + v * v;
    if (d > 1) return null;
    const nz = Math.sqrt(1 - d) * (p.f || 1);
    return norm3(u * c - v * s, u * s + v * c, nz);
  }
  if (p.k === 'c') {
    const ex = p.x2 - p.x1, ey = p.y2 - p.y1;
    const l2 = ex * ex + ey * ey || 1;
    let t = ((x - p.x1) * ex + (y - p.y1) * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = p.x1 + ex * t, cy = p.y1 + ey * t;
    const r = p.r1 + (p.r2 - p.r1) * t;
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    const q = d / r;
    return norm3(dx / r, dy / r, Math.sqrt(1 - q * q) * (p.f || 1));
  }
  if (p.k === 'p') {
    const pts = p.pts;
    let inside = false, best = 1e9, ox = 0, oy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const ex = xi - xj, ey = yi - yj;
      const l2 = ex * ex + ey * ey || 1;
      let t = ((x - xj) * ex + (y - yj) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = xj + ex * t, cy = yj + ey * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) { best = d; ox = cx - x; oy = cy - y; }
    }
    if (!inside) return null;
    const bev = p.bev ?? 2.2;
    let nx, ny;
    if (p.cyl) {
      ny = Math.max(-0.97, Math.min(0.97, (y - p.cyl.cy) / p.cyl.ry));
      nx = ((x - p.cyl.cx) / p.cyl.rx) * 0.45;
      const nz0 = Math.sqrt(1 - ny * ny);
      nx /= nz0; ny /= nz0;
    } else { nx = (x - p.cx) / p.R * (p.bulge ?? 0.5); ny = (y - p.cy) / p.R * (p.bulge ?? 0.5); }
    if (best < bev) {
      const k = (1 - best / bev) * 0.95;
      const ol = Math.hypot(ox, oy) || 1;
      nx += (ox / ol) * k * 1.6; ny += (oy / ol) * k * 1.6;
    }
    return norm3(nx, ny, 1);
  }
  return null;
}

function prepPrim(p) {
  if (p.k === 'e') {
    const a = p.a || 0;
    p.cos = Math.cos(a); p.sin = Math.sin(a);
    const m = Math.max(p.rx, p.ry);
    p.bb = [p.x - m, p.y - m, p.x + m, p.y + m];
  } else if (p.k === 'c') {
    const m = Math.max(p.r1, p.r2);
    p.bb = [Math.min(p.x1, p.x2) - m, Math.min(p.y1, p.y2) - m, Math.max(p.x1, p.x2) + m, Math.max(p.y1, p.y2) + m];
  } else if (p.k === 'p') {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, sx = 0, sy = 0;
    for (const [x, y] of p.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); sx += x; sy += y; }
    p.cx = p.cx ?? sx / p.pts.length; p.cy = p.cy ?? sy / p.pts.length;
    p.R = Math.max(x1 - x0, y1 - y0) / 2;
    p.bb = [x0, y0, x1, y1];
  }
}

// ---- rasterizer ----------------------------------------------------------
// def: { w, h, px, py, prims: [...], decals: [...] }
// opts: { pal: NORMAL|RED, far: bool }
function rasterize(def, opts) {
  const { w, h, px, py } = def;
  const N = w * h;
  const id = new Int16Array(N).fill(-1);
  const nb = new Float32Array(N * 3);
  const prims = def.prims;
  for (let k = 0; k < prims.length; k++) {
    const p = prims[k];
    if (!p.bb) prepPrim(p);
    const i0 = Math.max(0, Math.floor(p.bb[0] + px)), i1 = Math.min(w - 1, Math.ceil(p.bb[2] + px));
    const j0 = Math.max(0, Math.floor(p.bb[1] + py)), j1 = Math.min(h - 1, Math.ceil(p.bb[3] + py));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const n = testPrim(p, i + 0.5 - px, j + 0.5 - py);
        if (!n) continue;
        const o = j * w + i;
        if (p.paint && id[o] >= 0) { id[o] = k; continue; } // material only, keep normal
        if (p.paint) continue;
        id[o] = k;
        nb[o * 3] = n[0]; nb[o * 3 + 1] = n[1]; nb[o * 3 + 2] = n[2];
      }
    }
  }
  // shade to ramp indices
  const idx = new Int8Array(N);
  const mat = new Array(N);
  for (let o = 0; o < N; o++) {
    const k = id[o];
    if (k < 0) continue;
    const p = prims[k];
    const m = p.m;
    const M = MAT[m];
    const R = opts.pal[m];
    const nx = nb[o * 3], ny = nb[o * 3 + 1], nz = nb[o * 3 + 2];
    const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
    let lum = M.amb + (1 - M.amb) * Math.max(0, d);
    if (M.sss) lum += M.sss * (1 - Math.abs(d)) * 0.6;
    if (ny < -0.5) lum += M.rim * ((-ny - 0.5) / 0.5);
    if (ny > 0.7) lum -= 0.06; // dark underside
    lum += p.lum || 0;
    if (opts.far) lum = lum * 0.62 - 0.06;
    const x = o % w, y = (o / w) | 0;
    const dth = (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * M.dither;
    let ix = Math.floor(lum * (R.length - 1) + 0.5 + dth);
    if (M.spec && !opts.far) {
      const s = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), M.specPow) * M.spec;
      if (s > 0.55) ix = R.length - 1;
      else if (s > 0.3) ix = Math.max(ix, R.length - 2);
    }
    idx[o] = ix < 0 ? 0 : ix >= R.length ? R.length - 1 : ix;
    mat[o] = m;
  }
  // seams: a pixel under the edge of a higher primitive gets darkened
  const out = new Uint8ClampedArray(N * 4);
  const dk = new Int8Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * w + x, k = id[o];
      if (k < 0) continue;
      const nbr = [x > 0 ? o - 1 : -1, x < w - 1 ? o + 1 : -1, y > 0 ? o - w : -1, y < h - 1 ? o + w : -1];
      for (const q of nbr) {
        if (q < 0) continue;
        const kq = id[q];
        if (kq > k && !prims[kq].paint && (prims[kq].seam || (prims[kq].m !== prims[k].m && prims[kq].seam !== false))) { dk[o] = prims[kq].seamDepth || 2; break; }
      }
    }
  }
  for (let o = 0; o < N; o++) if (dk[o]) idx[o] = Math.max(0, idx[o] - dk[o]);
  // decals operate on ramp indices or explicit colours
  const col = new Array(N);
  const put = (x, y, op) => {
    const bx = Math.floor(x + px), by = Math.floor(y + py);
    if (bx < 0 || by < 0 || bx >= w || by >= h) return;
    const o = by * w + bx;
    if (id[o] < 0) return;
    if (op.c) col[o] = hex(op.c);
    else if (op.dk) idx[o] = Math.max(0, idx[o] - op.dk);
    else if (op.lt) idx[o] = Math.min(opts.pal[mat[o]].length - 1, idx[o] + op.lt);
    else if (op.m) { mat[o] = op.m; idx[o] = Math.min(opts.pal[op.m].length - 1, op.i ?? idx[o]); }
  };
  const line = (x0, y0, x1, y1, op) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, op);
  };
  for (const d of def.decals || []) {
    if (d.k === 'line') for (let i = 0; i + 1 < d.pts.length; i++) line(d.pts[i][0], d.pts[i][1], d.pts[i + 1][0], d.pts[i + 1][1], d.op);
    else if (d.k === 'dot') put(d.x, d.y, d.op);
    else if (d.k === 'rivet') { put(d.x, d.y, { lt: 3 }); put(d.x, d.y + 1, { dk: 2 }); put(d.x + 1, d.y + 1, { dk: 1 }); }
    else if (d.k === 'ring') {
      const n = Math.ceil(d.r * 7);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; put(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * (d.ry ?? d.r), d.op); }
    } else if (d.k === 'fill') {
      for (let y = -d.ry; y <= d.ry; y++) for (let x = -d.rx; x <= d.rx; x++) if ((x * x) / (d.rx * d.rx) + (y * y) / (d.ry * d.ry) <= 1) put(d.x + x, d.y + y, d.op);
    }
  }
  // compose RGBA + outline
  for (let o = 0; o < N; o++) {
    if (id[o] < 0) continue;
    const m = mat[o];
    const c = col[o] || opts.pal[m][idx[o]];
    out[o * 4] = c[0]; out[o * 4 + 1] = c[1]; out[o * 4 + 2] = c[2];
    out[o * 4 + 3] = MAT[m].alpha || 255;
  }
  if (!def.noOutline) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        if (id[o] < 0) continue;
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || id[o - 1] < 0 || id[o + 1] < 0 || id[o - w] < 0 || id[o + w] < 0;
        if (edge && !prims[id[o]].noOutline) {
          out[o * 4] = OUTLINE[0]; out[o * 4 + 1] = OUTLINE[1]; out[o * 4 + 2] = OUTLINE[2]; out[o * 4 + 3] = 255;
        }
      }
    }
  }
  return out;
}

function toCanvas(w, h, rgba) {
  return makeSprite(w, h, (ctx) => {
    const im = ctx.createImageData(w, h);
    im.data.set(rgba);
    ctx.putImageData(im, 0, 0);
  });
}

function tinted(w, h, rgba, rgb) {
  const t = new Uint8ClampedArray(rgba);
  for (let o = 0; o < t.length; o += 4) if (t[o + 3]) { t[o] = rgb[0]; t[o + 1] = rgb[1]; t[o + 2] = rgb[2]; t[o + 3] = 255; }
  return toCanvas(w, h, t);
}

// 1px rim just outside the silhouette (hittable-part pulse highlight)
function edgeOf(w, h, rgba, rgb) {
  const t = new Uint8ClampedArray(rgba.length);
  const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (op(x, y)) continue;
    if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) { const o = (y * w + x) * 4; t[o] = rgb[0]; t[o + 1] = rgb[1]; t[o + 2] = rgb[2]; t[o + 3] = 255; }
  }
  return toCanvas(w, h, t);
}

// Build a sprite with variants. Returns { img, white, dark, red, far, px, py, w, h }.
export function buildPart(def, { red = false, far = false, flame = false } = {}) {
  const base = rasterize(def, { pal: NORMAL, far: false });
  const s = { w: def.w, h: def.h, px: def.px, py: def.py };
  s.img = toCanvas(def.w, def.h, base);
  s.white = tinted(def.w, def.h, base, [255, 255, 255]);
  s.dark = tinted(def.w, def.h, base, [4, 8, 22]);
  s.edge = edgeOf(def.w, def.h, base, [255, 200, 236]);
  if (red) s.red = toCanvas(def.w, def.h, rasterize(def, { pal: RED, far: false }));
  if (flame) { s.flame = toCanvas(def.w, def.h, rasterize(def, { pal: FLAME, far: false })); if (far) s.farFlame = toCanvas(def.w, def.h, rasterize(def, { pal: FLAME, far: true })); }
  if (far) {
    const fb = rasterize(def, { pal: NORMAL, far: true });
    s.farImg = toCanvas(def.w, def.h, fb);
    if (red) s.farRed = toCanvas(def.w, def.h, rasterize(def, { pal: RED, far: true }));
  }
  return s;
}

// Stepped radial glow (pixel-art friendly bloom), drawn with 'lighter'.
export function buildGlow(r, rgb, steps = 4) {
  const d = r * 2 + 1;
  return makeSprite(d, d, (ctx) => {
    const im = ctx.createImageData(d, d);
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        const q = Math.hypot(x - r, y - r) / r;
        if (q > 1) continue;
        const lvl = Math.ceil((1 - q) * steps) / steps;
        const o = (y * d + x) * 4;
        const core = lvl >= 1 ? 1 : 0;
        im.data[o] = Math.min(255, rgb[0] + core * 120);
        im.data[o + 1] = Math.min(255, rgb[1] + core * 120);
        im.data[o + 2] = Math.min(255, rgb[2] + core * 120);
        im.data[o + 3] = Math.round(255 * lvl * lvl);
      }
    }
    ctx.putImageData(im, 0, 0);
  });
}

// Laser beam cross-section strip (1px wide, stretched along the beam).
export function buildBeamStrip(hw, cols) {
  const h = hw * 2 + 1;
  return makeSprite(1, h, (ctx) => {
    for (let y = 0; y < h; y++) {
      const q = Math.abs(y - hw) / hw;
      const i = Math.min(cols.length - 1, Math.floor(q * cols.length));
      ctx.fillStyle = cols[i];
      ctx.fillRect(0, y, 1, 1);
    }
  });
}

export const PAL = NORMAL;
