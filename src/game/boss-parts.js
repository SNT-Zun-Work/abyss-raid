import { enhanceAxolotlSprites } from './v-visual-parts.js';
import { buildPart, buildGlow, buildBeamStrip } from './boss-art.js';
import { makeSprite } from '../core/util.js';

const E = (x, y, rx, ry, m, o = {}) => ({ k: 'e', x, y, rx, ry, m, ...o });
const C = (x1, y1, x2, y2, r1, r2, m, o = {}) => ({ k: 'c', x1, y1, x2, y2, r1, r2, m, ...o });
const P = (pts, m, o = {}) => ({ k: 'p', pts, m, ...o });
const LN = (pts, op) => ({ k: 'line', pts, op });
const DOT = (x, y, op) => ({ k: 'dot', x, y, op });
const RIV = (x, y) => ({ k: 'rivet', x, y });

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function rivetRow(pts, step) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k <= n; k++) out.push(RIV(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
  }
  return out;
}

// shift a primitive / decal by (dx, dy)
function shift(q, dx, dy) {
  q = { ...q };
  if (q.k === 'e' || q.k === 'dot' || q.k === 'rivet' || q.k === 'ring' || q.k === 'fill') { q.x += dx; q.y += dy; }
  if (q.k === 'c') { q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; }
  if (q.k === 'p' || q.k === 'line') q.pts = q.pts.map(([x, y]) => [x + dx, y + dy]);
  if (q.cyl) q.cyl = { ...q.cyl, cx: q.cyl.cx + dx, cy: q.cyl.cy + dy };
  return q;
}
function bounds(prims) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const ext = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const p of prims) {
    if (p.k === 'e') ext(p.x, p.y, Math.max(p.rx, p.ry));
    else if (p.k === 'c') { ext(p.x1, p.y1, p.r1); ext(p.x2, p.y2, p.r2); }
    else if (p.k === 'p') for (const [x, y] of p.pts) ext(x, y);
  }
  return [x0, y0, x1, y1];
}
// A detachable piece defined in parent space: re-pivot on its centre.
function pieceDef(prims, decals, center) {
  const [x0, y0, x1, y1] = bounds(prims);
  const cx = center ? center[0] : Math.round((x0 + x1) / 2), cy = center ? center[1] : Math.round((y0 + y1) / 2);
  const pad = 2;
  const def = {
    w: Math.ceil(x1 - x0) + pad * 2 + 1, h: Math.ceil(y1 - y0) + pad * 2 + 1,
    px: Math.ceil(cx - x0) + pad, py: Math.ceil(cy - y0) + pad,
    prims: prims.map((q) => shift(q, -cx, -cy)),
    decals: decals.map((q) => shift(q, -cx, -cy)),
  };
  return { def, ox: cx, oy: cy };
}
// auto-sized sprite def around the pivot (0,0)
function autoDef(prims, decals = [], extra = {}) {
  const [x0, y0, x1, y1] = bounds(prims);
  const pad = 2;
  return { w: Math.ceil(x1 - x0) + pad * 2 + 1, h: Math.ceil(y1 - y0) + pad * 2 + 1, px: Math.ceil(-x0) + pad, py: Math.ceil(-y0) + pad, prims, decals, ...extra };
}

// ---- torso (pivot = root): flesh + machinery under the hull bands --------
export const BODY = { rx: 78, ry: 36 };
export const BANDS = [[-80, -50], [-46, -18], [-14, 16], [20, 48], [52, 80]];
const GAPS = [-48, -16, 18, 50];
function torsoDef() {
  const { rx, ry } = BODY;
  const prims = [
    E(0, 0, rx, ry, 'skin'),
    E(-46, 3, 30, 31, 'skin', { seam: false }),
    E(46, 2, 30, 30, 'skin', { seam: false }),
    E(-70, -2, 20, 27, 'skin', { seam: false }),
    E(-6, 17, 64, 17, 'belly', { paint: true }),
  ];
  for (const gx of GAPS) {
    const h = ry * Math.sqrt(1 - (gx / rx) ** 2);
    prims.push(C(gx, -h + 1, gx, h - 1, 4, 4, 'iron', { f: 1.3, lum: -0.15 }));
    prims.push(C(gx, -h + 4, gx, h - 4, 1.6, 1.6, 'maw', { lum: -0.3, seam: false }));
    for (const py of [-h * 0.62, h * 0.5]) prims.push(C(gx - 7, py, gx + 7, py + 1, 1.4, 1.4, 'iron', { lum: 0.05 }));
    for (const gy of [-h * 0.55, 0, h * 0.55]) prims.push(E(gx, gy, 1.8, 1.8, 'redglow'));
  }
  // spine conduit hugging the back, short exposed pipes between the ribs
  for (let k = 0; k < 10; k++) {
    const xa = -66 + k * 13.5, xb = xa + 13.5;
    const ya = -ry * 0.86 * Math.sqrt(1 - (xa / rx) ** 2), yb = -ry * 0.86 * Math.sqrt(1 - (xb / rx) ** 2);
    prims.push(C(xa, ya, xb, yb, 3.2, 3.2, 'iron', { f: 1.3, seam: k === 0 }));
  }
  for (let k = 0; k < GAPS.length - 1; k++) prims.push(C(GAPS[k] + 4, -10 + k * 2, GAPS[k + 1] - 4, -12 + k * 2, 1.5, 1.5, 'iron'));
  // keel girder along the belly
  for (let k = 0; k < 9; k++) {
    const xa = -60 + k * 14, xb = xa + 14;
    const ya = ry * 0.8 * Math.sqrt(1 - (xa / rx) ** 2), yb = ry * 0.8 * Math.sqrt(1 - (xb / rx) ** 2);
    prims.push(C(xa, ya, xb, yb, 2.6, 2.6, 'iron', { f: 1.3 }));
  }
  // skeletal frame, cables, machinery and torn conduits inside each body section
  const secs = [[-72, GAPS[0]], [GAPS[0], GAPS[1]], [GAPS[1], GAPS[2]], [GAPS[2], GAPS[3]], [GAPS[3], 74]];
  secs.forEach(([sa, sb], k) => {
    const cx = (sa + sb) / 2;
    const h = ry * Math.sqrt(Math.max(0.05, 1 - (cx / rx) ** 2));
    for (const rxo of [-0.22, 0.22]) {
      const x = cx + (sb - sa) * rxo;
      const pts = [[x + 2, -h * 0.82], [x - 3, -h * 0.3], [x - 4, h * 0.25], [x + 1, h * 0.78]];
      for (let q = 0; q < 3; q++) prims.push(C(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], 2.1, 2.1, 'iron', { f: 1.2 }));
    }
    // cable bundle
    for (let q = 0; q < 4; q++) {
      const x0 = sa + 3 + ((sb - sa - 6) * q) / 4, x1 = sa + 3 + ((sb - sa - 6) * (q + 1)) / 4;
      prims.push(C(x0, 8 + Math.sin(q * 1.7 + k) * 3, x1, 8 + Math.sin((q + 1) * 1.7 + k) * 3, 1.1, 1.1, 'spine'));
      prims.push(C(x0, 12 + Math.cos(q * 1.3 + k) * 2, x1, 12 + Math.cos((q + 1) * 1.3 + k) * 2, 0.9, 0.9, 'iron'));
    }
    // machinery block with a status light
    if (k !== 2) {
      prims.push(P([[cx - 5, -h * 0.5], [cx + 4, -h * 0.52], [cx + 5, -h * 0.5 + 8], [cx - 4, -h * 0.5 + 9]], 'iron', { bev: 1.2, seam: true }));
      prims.push(E(cx, -h * 0.5 + 4, 1.3, 1.3, 'redglow'));
    }
    if (k === 1 || k === 3) { // broken conduit with raw end
      prims.push(C(sa + 2, -2, cx + 1, 1, 2.2, 2, 'iron', { f: 1.3 }));
      prims.push(E(cx + 2, 1, 2, 2.6, 'raw'));
    }
  });
  const decals = [];
  // muscle striations on the exposed flesh
  for (let k = 0; k < GAPS.length + 1; k++) {
    const xa = k === 0 ? -70 : GAPS[k - 1] + 6, xb = k === GAPS.length ? 72 : GAPS[k] - 6;
    for (let x = xa + 4; x < xb - 2; x += 6) decals.push(LN([[x, -ry * 0.55], [x + 3, -6], [x + 2, ry * 0.4]], { dk: 1 }));
  }
  const rnd = lcg(7);
  for (let i = 0; i < 30; i++) {
    const x = -64 + rnd() * 128, y = -22 + rnd() * 34;
    decals.push(DOT(x, y, { dk: 2 }));
    if (rnd() < 0.5) decals.push(DOT(x + 1, y, { dk: 1 }));
  }
  return autoDef(prims, decals);
}

// one white hull band (armor) spanning BANDS[i] across the body cylinder
function bandPiece(i) {
  const { rx, ry } = BODY;
  const [xa, xb] = BANDS[i];
  const lean = 0.18; // bands lean back toward the tail at the top (fish scales)
  const yt = (x) => -ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) - 2;
  const pts = [];
  const N = 6;
  for (let k = 0; k <= N; k++) { const x = xa + ((xb - xa) * k) / N; const y = yt(x); pts.push([x - y * lean, y]); }
  for (let k = N; k >= 0; k--) { const x = xa + ((xb - xa) * k) / N; const y = -yt(x); pts.push([x - y * lean, y + (i === 0 ? 0 : 0)]); }
  const cyl = { cx: 0, cy: 0, rx, ry: ry + 2 };
  const prims = [P(pts, 'iron', { bev: 2.4, cyl, lum: -0.08 })];
  // asymmetric raised panels with stepped seams (battleship plating)
  const SPLIT = [-6, 6, -12, 2, -4][i], STEP = [3, -2, 2, -3, 2][i];
  const up = [], lo = [];
  for (let k = 0; k <= N; k++) { const x = xa + 2 + ((xb - xa - 4) * k) / N; const y = yt(x) + 1; up.push([x - y * lean, y]); }
  up.push([xb - 2 - SPLIT * lean, SPLIT], [xa + 2 + STEP - SPLIT * lean, SPLIT]);
  const yb = (x) => -yt(x) - 1;
  lo.push([xa + 1 - (SPLIT + 3) * lean, SPLIT + 3], [xb - 3 - (SPLIT + 3) * lean, SPLIT + 3]);
  for (let k = N; k >= 0; k--) { const x = xa + 1 + ((xb - xa - 4) * k) / N; const y = yb(x); lo.push([x - y * lean, y]); }
  prims.push(P(up, 'hull', { bev: 1.8, cyl, seam: true, seamDepth: 3, lum: -0.03 }));
  prims.push(P(lo, 'hull', { bev: 1.8, cyl, seam: true, seamDepth: 3, lum: -0.2 }));
  // gun ports (large/small) per band
  const PORTS = [[[xa + 9, -16, 3], [xa + 12, 14, 2.4]], [[(xa + xb) / 2 + 2, 18, 4.5], [xa + 8, -20, 2.6], [xb - 12, -6, 2.4]], [[xa + 6, -22, 2.6], [xb - 13, 19, 2.6]], [[(xa + xb) / 2, -14, 4], [xa + 8, 16, 2.6]], [[xa + 10, -12, 3], [xa + 12, 12, 3]]][i];
  for (const [px, py, pr] of PORTS) {
    prims.push(E(px - py * lean, py, pr + 1.2, pr + 1.2, 'iron', { f: 0.5, seam: true }));
    prims.push(E(px - py * lean, py, pr * 0.55, pr * 0.55, 'maw'));
  }
  // red accent stripe near the rear edge of each band
  const sx = xb - 7;
  const sp = [];
  for (let k = 0; k <= N; k++) { const y = -ry + 2 + ((2 * ry - 4) * k) / N; sp.push([sx - y * lean - 0.5 * Math.abs(y) / ry * 3, y * 0.97]); }
  for (let k = N; k >= 0; k--) { const y = -ry + 2 + ((2 * ry - 4) * k) / N; sp.push([sx + 3.5 - y * lean - 0.5 * Math.abs(y) / ry * 3, y * 0.97]); }
  prims.push(P(sp, 'red', { paint: true }));
  // dark keel plating on the underside
  prims.push(P([[xa - 40, 22], [xb + 40, 22], [xb + 40, 60], [xa - 40, 60]], 'iron', { paint: true }));
  const decals = [];
  const mid = (xa + xb) / 2;
  decals.push(LN([[xa + 3, -12], [xb - 9, -12]], { dk: 2 }));
  decals.push(LN([[xa + 3, 10], [xb - 9, 10]], { dk: 2 }));
  decals.push(LN([[mid + 10 * lean, -ry * 0.9], [mid, -12]], { dk: 1 }));
  decals.push(...rivetRow([[xa + 4 + 4, -18], [xb - 12 + 4, -18]], 6));
  decals.push(...rivetRow([[xa + 4 - 3, 16], [xb - 12 - 3, 16]], 6));
  if (i === 1 || i === 3) for (let k = 0; k < 3; k++) decals.push(LN([[mid - 6, -4 + k * 3], [mid + 4, -4 + k * 3]], { dk: 3 })); // vents
  return pieceDef(prims, decals);
}

// flank core turret ("red core eye") — mounted on the torso, always present
function coreDef() {
  const prims = [
    E(0, 0, 13, 13, 'iron', { f: 0.7 }),
    E(0, 0, 10, 10, 'hull', { f: 0.5 }),
    E(0, 0, 7.5, 7.5, 'iron', { f: 0.4 }),
    E(0, 0, 5.5, 5.5, 'red', { f: 1.2, lum: 0.15 }),
    E(-1, -1, 2.5, 2.5, 'redglow', { lum: -0.3 }),
  ];
  const decals = [{ k: 'ring', x: 0, y: 0, r: 11.5, op: { dk: 2 } }, DOT(-2, -2, { c: '#ffffff' }), DOT(-1, -2, { c: '#ffd0c0' })];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; decals.push(RIV(Math.cos(a) * 9, Math.sin(a) * 9)); }
  return autoDef(prims, decals);
}

// ---- head (pivot = neck joint) -------------------------------------------
const HEAD_LIP = [[-92, 8], [-80, 10], [-60, 11], [-36, 11], [-18, 10]];
function headDef() {
  const prims = [
    E(-44, -4, 46, 24, 'skin'),
    E(-74, 3, 20, 14, 'skin', { seam: false }),
    E(-22, 5, 26, 18, 'skin', { seam: false }),
    E(-52, 12, 40, 6, 'belly', { paint: true }),
    E(-2, -4, 12, 22, 'iron', { f: 0.8 }), // gill-root collar machinery
    E(-2, -14, 2, 2, 'redglow'), E(-2, -2, 2, 2, 'redglow'), E(-1, 9, 2, 2, 'redglow'),
  ];
  // upper teeth (stay after the casing is gone)
  for (let x = -86; x <= -24; x += 5) prims.push(P([[x - 2, 8], [x + 2, 8], [x + 0.3, 14]], 'hull', { lum: 0.15, bev: 0.8 }));
  const decals = [
    LN([[-90, 8], [-78, 12], [-60, 13], [-40, 13], [-24, 11], [-16, 7], [-14, 3]], { dk: 3 }), // the smile
    DOT(-86, -1, { dk: 3 }),
  ];
  const rnd = lcg(21);
  for (let i = 0; i < 12; i++) decals.push(DOT(-78 + rnd() * 60, -20 + rnd() * 22, { dk: 2 }));
  return autoDef(prims, decals);
}

// shark-like white head casing (helmet); eye is a separate sprite drawn on top
function helmetPiece() {
  const pts = [[-97, 4], [-90, -6], [-76, -16], [-56, -24], [-30, -28], [-8, -27], [6, -18], [7, -2], [-4, 6], [-20, 8], [-50, 9], [-80, 9], [-93, 8]];
  const cyl = { cx: -40, cy: -6, rx: 60, ry: 26 };
  const prims = [
    P(pts, 'iron', { bev: 2.6, cyl, lum: -0.1 }), // dark substructure shows in the plate breaks
    P([[-95, 1], [-89, -6], [-76, -15], [-56, -23], [-43, -25], [-41, -5], [-91, -2]], 'hull', { bev: 2.2, cyl, seam: true, seamDepth: 3 }),
    P([[-37, -26], [-8, -26], [5, -18], [6, -6], [-35, -5]], 'hull', { bev: 2.2, cyl, seam: true, seamDepth: 3, lum: -0.04 }),
    P([[-93, 6], [-88, 2], [-40, -1], [4, -2], [-4, 5], [-20, 7], [-50, 8], [-80, 8]], 'hull', { bev: 1.8, cyl, seam: true, seamDepth: 3, lum: -0.24 }),
    P([[-74, -13], [-52, -19], [-43, -20], [-43, -16], [-50, -15], [-70, -9]], 'red', { paint: true }), // brow stripe
    P([[-37, -21], [-10, -22], [-8, -18], [-37, -17]], 'red', { paint: true }),
    P([[-97, 4], [-90, -2], [-84, 2], [-86, 8], [-93, 8]], 'iron', { paint: true }), // snout cap
    P([[-28, -29], [-14, -40], [-4, -38], [-8, -27]], 'hull', { bev: 1.8, cyl: { cx: -14, cy: -30, rx: 20, ry: 12 }, lum: -0.05 }), // crest
  ];
  const decals = [
    LN([[-26, -30], [-13, -38]], { lt: 1 }),
    ...rivetRow([[-34, -12], [-12, -12]], 6), ...rivetRow([[-80, -4], [-50, -6]], 6),
    ...rivetRow([[-70, 4], [-30, 2]], 7),
    LN([[-89, 0], [-86, 0]], { dk: 3 }),
  ];
  return pieceDef(prims, decals);
}

function eyeDef() {
  const prims = [E(0, 0, 7, 6, 'iron', { f: 0.6 }), E(0, 0, 4.5, 4, 'redglow'), E(0.5, 0.5, 1.6, 1.6, 'maw')];
  return autoDef(prims, [DOT(-2, -2, { c: '#ffffff' }), { k: 'ring', x: 0, y: 0, r: 6, ry: 5, op: { dk: 1 } }]);
}

// mechanical lower jaw (pivot = hinge)
function jawDef() {
  const prims = [
    C(4, 2, -70, 5, 11, 8, 'skin'),
    E(-64, 5, 13, 8, 'skin', { seam: false }),
    E(-30, 11, 36, 6, 'belly', { paint: true }),
    C(0, -3, -76, -1, 2.2, 2, 'iron', { f: 1.2 }), // tooth rail
    C(-2, 12, -60, 11, 2.4, 2, 'iron', { f: 1.2 }), // jaw bone strut
    E(-8, 11, 13, 9, 'throat', { seam: true }), // soft throat pouch (weak point)
    E(2, 2, 5, 5, 'red', { f: 0.6 }), E(2, 2, 2.4, 2.4, 'redglow'), // hinge light
  ];
  for (let x = -80; x <= -22; x += 5) prims.push(P([[x - 2, -4], [x + 2, -4], [x + 0.3, -10]], 'hull', { lum: 0.15, bev: 0.8 }));
  const decals = [LN([[-14, 6], [-8, 9], [-2, 7]], { m: 'glowpink', i: 3 }), LN([[-14, 15], [-6, 13], [0, 16]], { m: 'glowpink', i: 2 })];
  return autoDef(prims, decals);
}
function chinPiece() {
  const pts = [[-86, 0], [-62, -3], [-22, -3], [-14, 2], [-18, 12], [-40, 16], [-66, 15], [-84, 8]];
  const prims = [
    P(pts, 'hull', { bev: 2.2, cyl: { cx: -50, cy: 4, rx: 50, ry: 14 } }),
    P([[-80, 6], [-24, 4], [-24, 7], [-80, 9]], 'red', { paint: true }),
  ];
  return pieceDef(prims, [...rivetRow([[-70, 1], [-30, 0]], 6), LN([[-50, -2], [-48, 15]], { dk: 2 })]);
}
function mawDef() {
  return autoDef([E(-48, 11, 44, 14, 'maw'), E(-24, 11, 18, 9, 'maw', { lum: -0.2 })], [LN([[-84, 4], [-60, 6], [-40, 6], [-20, 8]], { lt: 1 })], { noOutline: true });
}

// ---- gill-fins: feathery magenta blades (2 segments) ---------------------
function gillSegDef(r0, r1, len, fo, fi, tip) {
  // feather: dark spine + separated barbs (vanes) swept back; light only toward barb tips
  const prims = [];
  const barb = (x0, y0, x1, y1, side) => {
    const mx = x0 + (x1 - x0) * 0.55, my = y0 + (y1 - y0) * 0.55;
    prims.push(C(x0, y0, mx, my, 1.35, 1.1, 'vane', { seam: true, seamDepth: 1, lum: side < 0 ? -0.12 : -0.2 }));
    prims.push(C(mx, my, x1, y1, 1.1, 0.5, 'vane', { seam: false, lum: side < 0 ? 0.04 : -0.06, noOutline: true }));
  };
  for (let s0 = 1.5; s0 <= len; s0 += 3.4) {
    const t = s0 / len;
    const r = r0 + (r1 - r0) * t;
    const taper = tip ? 1 - t * 0.65 : 1 - t * 0.12;
    const lo = fo * taper, li = fi * taper;
    barb(s0, -r * 0.4, s0 + lo * 1.0, -r - lo * 0.7, -1);
    barb(s0 + 1.7, r * 0.4, s0 + 1.7 + li * 1.0, r + li * 0.7, 1);
  }
  if (tip) { barb(len - 2, 0, len + 8, -2, -1); barb(len - 2, 0, len + 6, 3, 1); }
  prims.push(C(0, 0, len, 0, r0 * 1.1, r1 * 1.1, 'spine', { seam: false }));
  return autoDef(prims, [LN([[1, -1], [len - 2, -1]], { lt: 1 })]);
}
function stumpDef() {
  return autoDef([C(0, 0, 6, 0, 4, 3.5, 'iron'), E(7, 0, 2.5, 3.5, 'raw'), E(1, 0, 1.6, 1.6, 'redglow')], [DOT(7, 0, { dk: 2 })]);
}
// fin-blade along the back/belly (pivot = base, pointing +x): dark membrane + bright rays
function bladeDef(len, wid) {
  const pts = [[0, -wid * 0.35], [len * 0.35, -wid * 0.55], [len * 0.8, -wid * 0.3], [len, 0], [len * 0.75, wid * 0.15], [len * 0.3, wid * 0.35], [0, wid * 0.35]];
  const prims = [P(pts, 'membrane', { bev: 1.2, bulge: 0.3 })];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const ex = len * (0.25 + 0.75 * u), ey = -wid * 0.5 * Math.sin(Math.PI * (0.15 + 0.7 * (1 - u))) + wid * 0.1;
    const mx = ex * 0.55, my = ey * 0.55;
    prims.push(C(1, 0, mx, my, 1.1, 0.9, 'vane', { seam: true, seamDepth: 1, lum: -0.08 }));
    prims.push(C(mx, my, ex, ey, 0.9, 0.45, 'vane', { seam: false, lum: 0.14, noOutline: true }));
  }
  prims.push(C(0, 0, len * 0.95, -wid * 0.02, 1.5, 0.6, 'spine', { seam: false }));
  prims.push(E(0, 0, 3.5, 3.5, 'iron', { f: 0.7 }));
  return autoDef(prims, []);
}

// ---- limbs (mechanical) ---------------------------------------------------
function upperLegDef() {
  return autoDef([E(0, 0, 10, 9, 'hull', { f: 0.8 }), C(0, 2, -3, 16, 7.5, 5.5, 'hull', { seam: false }), E(-3, 16, 4.5, 4.5, 'red', { f: 0.6 }), E(-3, 16, 2, 2, 'redglow')],
    [LN([[-6, 2], [2, 4]], { dk: 2 }), RIV(2, -2), RIV(-4, 8)]);
}
function lowerLegDef() {
  const prims = [C(0, 0, -4, 11, 5, 4, 'iron'), E(-8, 13, 8, 4.5, 'iron', { seam: false })];
  for (const [tx, ty] of [[-21, 10], [-22, 15], [-19, 19], [-13, 21]]) prims.push(C(-9, 13, tx, ty, 2.2, 0.9, 'hull', { seam: true, seamDepth: 1 }));
  return autoDef(prims, [RIV(-2, 4)]);
}

// ---- tail ----------------------------------------------------------------
export const TAIL = {
  n: 9,
  len: 18,
  r: [28, 25, 22, 19, 16, 13, 10, 8, 6, 4],
  top: [0, 5, 10, 14, 17, 19, 19, 18, 16, 12],
  bot: [0, 2, 5, 8, 10, 11, 11, 10, 9, 7],
};
function tailSegDef(i) {
  const L = TAIL.len, r0 = TAIL.r[i], r1 = TAIL.r[i + 1];
  const t0 = TAIL.top[i], t1 = TAIL.top[i + 1], b0 = TAIL.bot[i], b1 = TAIL.bot[i + 1];
  const prims = [];
  // serrated magenta fin blades
  if (t0 + t1 > 0) prims.push(P([[-3, -r0 + 3], [L + 4, -r1 + 3], [L + 6, -r1 - t1 - 3], [L * 0.5, -r0 - (t0 + t1) / 2], [-3, -r0 - t0]], 'fin', { bev: 1.5, bulge: 0.3 }));
  if (b0 + b1 > 0) prims.push(P([[-3, r0 - 3], [L + 4, r1 - 3], [L + 6, r1 + b1 + 2], [L * 0.5, r0 + (b0 + b1) / 2], [-3, r0 + b0]], 'fin', { bev: 1.5, bulge: 0.3 }));
  prims.push(C(-5, 0, L + 5, 0, r0, r1, 'iron'));
  // white armored ring with red stripe
  const ring = [[1, -r0 - 1], [L - 2, -r1 - 1], [L - 2, r1 + 1], [1, r0 + 1]];
  prims.push(P(ring, 'hull', { bev: 2, cyl: { cx: L / 2, cy: 0, rx: 30, ry: (r0 + r1) / 2 + 1 } }));
  prims.push(P([[L - 6, -r1], [L - 3, -r1], [L - 3, r1], [L - 6, r1]], 'red', { paint: true }));
  if (i === TAIL.n - 1) prims.push(P([[L, -4], [L + 14, -12], [L + 18, 0], [L + 14, 10], [L, 4]], 'fin', { bev: 1.5 }));
  const decals = [];
  for (let x = 0; x <= L + 2; x += 3) {
    const rr = r0 + ((r1 - r0) * x) / L, tt = t0 + ((t1 - t0) * x) / L, bb = b0 + ((b1 - b0) * x) / L;
    if (tt > 2) decals.push(LN([[x, -rr - 1], [x + 3, -rr - tt + 1]], { dk: 1 }));
    if (bb > 2) decals.push(LN([[x, rr + 1], [x + 3, rr + bb - 1]], { dk: 1 }));
  }
  decals.push(LN([[3, -r0 * 0.4], [L - 8, -r1 * 0.4]], { dk: 2 }));
  decals.push(RIV(L / 2 - 3, -r0 * 0.7), RIV(L / 2 - 3, r0 * 0.6));
  decals.push(DOT(L / 2, 0, { m: 'redglow', i: 2 }));
  return autoDef(prims, decals);
}

// ---- escort (≈1/5 boss): whole body sprite, gill tuft + tail sprites -------
// uniform scale of primitives/decals (escorts are authored large, rendered small)
let ESC_K = 0.62;
function scl(q, k) {
  q = { ...q };
  for (const f of ['x', 'y', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'r1', 'r2']) if (q[f] !== undefined) q[f] *= k;
  if (q.pts) q.pts = q.pts.map(([x, y]) => [x * k, y * k]);
  if (q.cyl) q.cyl = { cx: q.cyl.cx * k, cy: q.cyl.cy * k, rx: q.cyl.rx * k, ry: q.cyl.ry * k };
  if (q.bev) q.bev = Math.max(0.8, q.bev * k);
  if (q.k === 'c') { q.r1 = Math.max(0.6, q.r1); q.r2 = Math.max(0.5, q.r2); }
  return q;
}
const escDef = (prims, decals = []) => autoDef(prims.map((q) => scl(q, ESC_K)), decals.map((q) => scl(q, ESC_K)));

function escortBodyDef() {
  const prims = [
    C(-14, 0, 22, 0, 8, 5, 'iron'),
    P([[-6, -8], [2, -14], [8, -9]], 'fin', { bev: 1.2 }), P([[8, -8], [16, -13], [20, -6]], 'fin', { bev: 1.2 }),
    P([[-2, 7], [6, 13], [10, 7]], 'fin', { bev: 1.2 }), P([[10, 6], [18, 11], [20, 5]], 'fin', { bev: 1.2 }),
    // shark-like head casing
    P([[-34, 2], [-30, -4], [-20, -9], [-8, -10], [-4, -3], [-6, 5], [-18, 6], [-32, 5]], 'hull', { bev: 1.4, cyl: { cx: -18, cy: -2, rx: 18, ry: 9 } }),
    C(-30, 6, -10, 7, 2.6, 2.4, 'hull', { lum: -0.12 }), // jaw
    P([[-4, -9], [6, -9], [6, 9], [-4, 8]], 'hull', { bev: 1.2, cyl: { cx: 1, cy: 0, rx: 12, ry: 9 } }),
    P([[8, -8], [16, -7], [16, 7], [8, 8]], 'hull', { bev: 1.2, cyl: { cx: 12, cy: 0, rx: 12, ry: 8 } }),
    P([[18, -6], [24, -5], [24, 5], [18, 6]], 'hull', { bev: 1, cyl: { cx: 21, cy: 0, rx: 10, ry: 6 } }),
    P([[4, -9], [6, -9], [6, 9], [4, 9]], 'red', { paint: true }),
    P([[14, -7], [16, -7], [16, 7], [14, 7]], 'red', { paint: true }),
    P([[-22, -6], [-10, -8], [-9, -6], [-22, -4]], 'red', { paint: true }),
    E(-22, -2, 2.4, 2.2, 'redglow'),
  ];
  const decals = [DOT(-23, -3, { c: '#ffffff' }), LN([[-32, 4], [-14, 5]], { dk: 3 }), RIV(0, -4), RIV(11, -3), DOT(7, 0, { m: 'redglow', i: 2 }), DOT(17, 0, { m: 'redglow', i: 2 })];
  for (let x = -30; x <= -16; x += 3) decals.push(DOT(x, 5, { c: '#f0eef4' }));
  return escDef(prims, decals);
}
function escortGillDef() {
  const prims = [];
  for (let k = 0; k < 3; k++) {
    const a = -1.25 + k * 0.5, L = 15 - k * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let s = 2; s < L; s += 2.6) prims.push(C(ca * s, sa * s, ca * s + 3.4 * ca + 2.4 * sa, sa * s + 3.4 * sa - 2.4 * ca, 0.9, 0.6, 'vane', { seam: false, noOutline: true, lum: 0.08 }));
    prims.push(C(0, 0, ca * L, sa * L, 1.6, 0.8, 'spine'));
  }
  prims.push(E(0, 0, 2.5, 2.5, 'iron'));
  return escDef(prims);
}
function escortTailDef() {
  const prims = [
    P([[0, -3], [14, -10], [22, -3], [22, 3], [14, 9], [0, 3]], 'fin', { bev: 1.2 }),
    C(-2, 0, 11, 0, 5, 2, 'hull'),
    P([[6, -4], [8, -4], [8, 4], [6, 4]], 'red', { paint: true }),
  ];
  return escDef(prims, [LN([[10, -3], [18, -7]], { dk: 1 }), LN([[11, 0], [21, 0]], { dk: 1 }), LN([[10, 3], [18, 7]], { dk: 1 })]);
}

export const FRY_SIZES = [0.36, 0.44];
export const FRY_DIRS = 16, FRY_WIG = 3;
const FRY_BOX = 40;
function composeFry(parts, k, ang, wig) {
  const draw = (ctx, white) => {
    ctx.imageSmoothingEnabled = false;
    ctx.translate(FRY_BOX / 2, FRY_BOX / 2);
    ctx.rotate(ang - Math.PI);
    if (Math.cos(ang) > 0.01) ctx.scale(1, -1); // keep the belly down when swimming right
    const put = (s, x, y, a) => { ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (a) ctx.rotate(a); ctx.drawImage(white ? s.white : s.img, -s.px, -s.py); ctx.restore(); };
    const kk = k / 0.62;
    put(parts.tail, 14 * kk, 0, wig);
    put(parts.body, 0, 0, 0);
    put(parts.gill, -4 * kk, -2 * kk, -0.15 + wig * 0.3);
  };
  return { img: makeSprite(FRY_BOX, FRY_BOX, (c) => draw(c, false)), white: makeSprite(FRY_BOX, FRY_BOX, (c) => draw(c, true)), h: FRY_BOX / 2 };
}

// ---- build everything once --------------------------------------------------
let CACHE = null;
export function getSprites() {
  if (CACHE) return enhanceAxolotlSprites(CACHE);
  const S = {};
  const piece = (pc, opt) => ({ ...buildPart(pc.def, opt), ox: pc.ox, oy: pc.oy });
  S.torso = buildPart(torsoDef(), { red: true });
  S.core = buildPart(coreDef());
  S.head = buildPart(headDef(), { red: true });
  S.eye = buildPart(eyeDef());
  S.jaw = buildPart(jawDef(), { red: true });
  S.maw = buildPart(mawDef());
  S.gillA = buildPart(gillSegDef(3.2, 2.5, 30, 16, 9, false), { red: true, far: true, flame: true });
  S.gillB = buildPart(gillSegDef(2.5, 0.9, 32, 15, 8, true), { red: true, far: true, flame: true });
  S.stump = buildPart(stumpDef(), { far: true });
  S.blade = buildPart(bladeDef(30, 12), { red: true, far: true });
  S.bladeS = buildPart(bladeDef(22, 9), { red: true, far: true });
  S.upper = buildPart(upperLegDef(), { far: true });
  S.lower = buildPart(lowerLegDef(), { far: true });
  S.tail = [];
  for (let i = 0; i < TAIL.n; i++) S.tail.push(buildPart(tailSegDef(i), { red: true }));
  S.armor = {
    helmet: piece(helmetPiece()),
    chin: piece(chinPiece()),
  };
  BANDS.forEach((_, i) => { S.armor['band' + i] = piece(bandPiece(i)); });
  S.chunks = [
    [[-4, -3], [3, -4], [5, 1], [-1, 4], [-5, 1]],
    [[-3, -2], [4, -2], [2, 3], [-3, 2]],
    [[-5, -1], [0, -4], [5, -1], [2, 3], [-3, 3]],
  ].map((pts, i) => buildPart({ w: 14, h: 12, px: 7, py: 6, prims: [P(pts, i === 1 ? 'fin' : 'hull', { bev: 1.5, bulge: 0.6 })], decals: [] }));
  S.esc = { body: buildPart(escortBodyDef()), gill: buildPart(escortGillDef()), tail: buildPart(escortTailDef()) };
  // school fry: whole-fish composites pre-rendered per size x heading x tail-wiggle frame
  S.fry = FRY_SIZES.map((k) => {
    ESC_K = k;
    const parts = { body: buildPart(escortBodyDef()), gill: buildPart(escortGillDef()), tail: buildPart(escortTailDef()) };
    ESC_K = 0.62;
    const frames = [];
    for (let d = 0; d < FRY_DIRS; d++) {
      const row = [];
      for (let w = 0; w < FRY_WIG; w++) row.push(composeFry(parts, k, (d / FRY_DIRS) * Math.PI * 2, (w - 1) * 0.4));
      frames.push(row);
    }
    return { k, frames };
  });
  // gill regrowth buds (4 sizes) and the weak-point edge pulse comes from buildPart().edge
  S.buds = [2, 3, 4.5, 6].map((r) => buildPart(autoDef([E(0, 0, r, r * 0.8, 'vane', { lum: 0.15 }), E(-r * 0.3, -r * 0.3, r * 0.35, r * 0.3, 'glowpink')])));
  S.eyeGlow = buildGlow(8, [255, 40, 30], 4);
  S.redLight = buildGlow(4, [255, 40, 30], 3);
  S.mawGlow = buildGlow(16, [255, 50, 80], 5);
  S.tipGlow = buildGlow(6, [255, 80, 170], 3);
  S.bigGlow = buildGlow(28, [255, 60, 120], 6);
  S.beam = buildBeamStrip(6, ['#ffffff', '#ffffff', '#ffe4ec', '#ff9aa8', '#ff4a6a', '#d0183a', '#7a0828']);
  // spectacle assets: giga beam cross-section, light shaft for safe columns, rocks
  S.gigaBeam = buildBeamStrip(40, ['#ffffff', '#ffffff', '#fffbe8', '#fff0c8', '#ffd8a0', '#ffb070', '#ff7a50', '#ff4a50', '#e8204a', '#a8103c', '#600828']);
  S.shaft = makeSprite(16, 64, (ctx) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) {
      const e = 1 - Math.abs(x - 7.5) / 8, v = (0.4 + 0.6 * (1 - y / 64)) * e;
      const lv = Math.floor(v * 4) / 4;
      if (lv <= 0) continue;
      ctx.fillStyle = 'rgba(190,240,255,' + (lv * 0.9).toFixed(2) + ')';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  S.rocks = [
    [[-6, -2], [-3, -6], [3, -6], [7, -1], [4, 5], [-4, 5]],
    [[-5, -4], [2, -6], [6, 0], [3, 5], [-4, 4], [-7, 0]],
    [[-4, -5], [4, -5], [6, 2], [0, 6], [-6, 2]],
  ].map((pts) => buildPart(autoDef([P(pts, 'iron', { bev: 2, bulge: 0.7, lum: 0.12 })], [DOT(-1, -2, { lt: 2 }), DOT(1, 2, { dk: 1 })])));
  S.flameGlow = buildGlow(8, [255, 140, 40], 4);
  S.tellGlow = buildGlow(8, [170, 250, 255], 3); // attack tells: cool white-cyan, never orange
  S.coreGlow = buildGlow(24, [255, 190, 110], 6);
  S.beamThin = buildBeamStrip(3, ['#ffffff', '#ffc0c8', '#ff5a70', '#a01030']);
  return enhanceAxolotlSprites(CACHE = S);
}
