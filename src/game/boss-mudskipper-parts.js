// PERIOPHTHALMUS (ZONE G) sprite parts. Owned by the boss agent.
// Gunmetal/bronze mechanical mudskipper: big frog-like head with a wide toothy
// red maw, two turret EYES on top (separate sprites: they pop up / retract),
// perforated sail fins glowing orange from within, mechanical arm-fins, red
// light strips. Built once with the shared pixel shader (boss-art.js).
// Part space: facing LEFT, origin = the part's pivot.
import { buildPart, buildGlow } from './boss-art.js';
import { makeSprite } from '../core/util.js';

const E = (x, y, rx, ry, m, o = {}) => ({ k: 'e', x, y, rx, ry, m, ...o });
const C = (x1, y1, x2, y2, r1, r2, m, o = {}) => ({ k: 'c', x1, y1, x2, y2, r1, r2, m, ...o });
const P = (pts, m, o = {}) => ({ k: 'p', pts, m, ...o });
const LN = (pts, op) => ({ k: 'line', pts, op });
const DOT = (x, y, op) => ({ k: 'dot', x, y, op });
const RIV = (x, y) => ({ k: 'rivet', x, y });
const HOLE = (x, y, rx, ry, c) => ({ k: 'fill', x, y, rx, ry, op: { c } });

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
function def(prims, decals = [], extra = {}) {
  const [x0, y0, x1, y1] = bounds(prims);
  const pad = 2;
  return { w: Math.ceil(x1 - x0) + pad * 2 + 1, h: Math.ceil(y1 - y0) + pad * 2 + 1, px: Math.ceil(-x0) + pad, py: Math.ceil(-y0) + pad, prims, decals, ...extra };
}
function rivets(x0, y0, x1, y1, step) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)), out = [];
  for (let k = 0; k <= n; k++) out.push(RIV(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
  return out;
}

// ---- torso (pivot = root): segmented gunmetal hull with bronze belly + red light slits
function torsoDef() {
  const cyl = { cx: 8, cy: 0, rx: 56, ry: 28 };
  const prims = [
    E(8, 0, 54, 28, 'armor', { lum: -0.22 }),
    E(8, 15, 48, 12, 'brass', { paint: true }),
    // overlapping hull bands
    P([[-28, -26], [-4, -29], [-2, 24], [-26, 22]], 'armor', { cyl, seam: true, seamDepth: 3, lum: -0.14 }),
    P([[0, -29], [24, -28], [26, 25], [2, 26]], 'brass', { cyl, seam: true, seamDepth: 3, lum: -0.12 }),
    P([[28, -27], [50, -22], [54, 18], [30, 24]], 'armor', { cyl, seam: true, seamDepth: 3, lum: -0.22 }),
    // red light slits (glowing)
    P([[-22, -12], [-8, -14], [-8, -11], [-22, -9]], 'redglow'),
    P([[4, -14], [20, -15], [20, -12], [4, -11]], 'redglow'),
    P([[32, -12], [46, -10], [46, -7], [32, -9]], 'redglow'),
    P([[6, 4], [20, 4], [20, 6], [6, 6]], 'redglow'),
    // flank turret ring
    E(-14, 6, 7, 7, 'iron', { f: 0.6, seam: true }), E(-14, 6, 3.5, 3.5, 'redglow'),
  ];
  const decals = [
    ...rivets(-24, -20, -6, -22, 5), ...rivets(4, -22, 22, -22, 5), ...rivets(32, -20, 48, -16, 5),
    ...rivets(-20, 16, -4, 18, 5), ...rivets(6, 18, 22, 19, 5),
    LN([[-26, 0], [52, 0]], { dk: 1 }),
    { k: 'ring', x: -14, y: 6, r: 8, op: { dk: 2 } },
  ];
  return def(prims, decals);
}

// ---- head (pivot = neck at root(-34,-4)): big frog-like head, wide upper lip with teeth
function headDef() {
  const cyl = { cx: -30, cy: -2, rx: 40, ry: 26 };
  const prims = [
    E(-30, -6, 36, 28, 'armor', { lum: -0.3 }),
    E(-56, 2, 20, 19, 'armor', { seam: false, lum: -0.26 }),
    P([[-72, -6], [-52, -26], [-22, -32], [0, -22], [2, 4], [-68, 6]], 'armor', { cyl, seam: true, seamDepth: 2, lum: -0.14 }), // brow plate
    P([[-72, 6], [-40, 8], [-6, 6], [-4, 12], [-40, 14], [-70, 12]], 'brass', { bev: 1.4, seam: true, seamDepth: 2 }), // upper lip
    E(-18, -6, 6, 6, 'iron', { f: 0.6 }), E(-18, -6, 3, 3, 'redglow'), // cheek port
  ];
  for (let x = -68; x <= -10; x += 5) prims.push(P([[x - 2, 12], [x + 2, 12], [x + 0.3, 17]], 'hull', { lum: 0.1, bev: 0.8 }));
  const decals = [
    LN([[-60, -10], [-30, -20], [-4, -16]], { dk: 2 }),
    ...rivets(-56, -14, -12, -22, 6),
    DOT(-72, 0, { dk: 3 }), DOT(-71, 0, { dk: 2 }),
    LN([[-30, -27], [-30, 4]], { dk: 1 }),
  ];
  return def(prims, decals);
}
function jawDef() {
  const prims = [
    C(4, 0, -62, 8, 12, 10, 'armor', { lum: -0.18 }),
    E(-60, 8, 12, 8, 'armor', { seam: false, lum: -0.15 }),
    E(-28, 10, 30, 6, 'brass', { paint: true }),
    C(0, -3, -60, 0, 2, 1.8, 'iron', { f: 1.2 }),
  ];
  for (let x = -60; x <= -8; x += 5) prims.push(P([[x - 2, -4], [x + 2, -4], [x + 0.3, -9]], 'hull', { lum: 0.1, bev: 0.8 }));
  return def(prims, [...rivets(-50, 6, -10, 4, 7)]);
}
function mawDef() {
  return def([E(-38, 8, 38, 18, 'maw'), E(-20, 8, 16, 10, 'maw', { lum: -0.25 }), E(-24, 8, 7, 5, 'redglow', { lum: -0.15 })], [], { noOutline: true });
}
// ---- turret eye (pivot = base of the stalk): stalk + housing + red lens
function eyeDef() {
  const prims = [
    C(0, 0, 0, 16, 6, 7, 'iron'),
    E(0, -2, 13, 13, 'brass', { f: 0.8, lum: -0.08 }),
    E(-3, -3, 9, 9, 'iron', { f: 0.6, seam: true }),
    E(-3.5, -3.5, 6.5, 6.5, 'redglow'),
    E(-4, -4, 2, 2, 'maw'),
  ];
  return def(prims, [DOT(-7, -7, { c: '#ffffff' }), DOT(-6, -7, { c: '#ffd0c0' }), { k: 'ring', x: -3, y: -3, r: 10, op: { dk: 2 } }, ...rivets(6, -10, 9, 3, 4)]);
}
function eyeDeadDef() {
  return def([C(0, 0, 0, 10, 5, 6, 'iron'), E(0, 0, 8, 5, 'iron', { lum: -0.15 }), E(-1, -1, 4, 3, 'raw')], [DOT(-2, -2, { dk: 2 })]);
}
// ---- latticed sail fin (pivot = base): iron frame with glowing perforations
function sailDef(h, w) {
  // fan-shaped latticed sail: dark iron web, radiating bronze spines, glowing perforations
  const pts = [[0, 0], [w * 0.05, -h * 0.7], [w * 0.35, -h], [w * 0.75, -h * 0.9], [w, -h * 0.45], [w * 0.92, 0]];
  const prims = [P(pts, 'iron', { bev: 1.6, bulge: 0.3, lum: -0.05 })];
  const tips = [[w * 0.05, -h * 0.7], [w * 0.3, -h * 0.98], [w * 0.58, -h * 0.97], [w * 0.82, -h * 0.8], [w, -h * 0.45]];
  for (const [tx, ty] of tips) prims.push(C(w * 0.45, 0, tx, ty, 1.8, 1, 'brass', { seam: false, lum: -0.05 }));
  const decals = [];
  for (let k = 0; k < tips.length - 1; k++) {
    const [ax, ay] = tips[k], [bx, by] = tips[k + 1];
    for (let u = 0.3; u < 0.95; u += 0.2) {
      const mx = w * 0.45 + ((ax + bx) / 2 - w * 0.45) * u, my = ((ay + by) / 2) * u;
      decals.push(HOLE(mx, my, 1.6 + u, 2 + u, u > 0.6 ? '#ff9a40' : '#ff6a28'));
    }
  }
  return def(prims, decals);
}
function sailGlowDef(h, w) {
  const pts = [[4, -2], [w * 0.08, -h * 0.66], [w * 0.36, -h * 0.94], [w * 0.74, -h * 0.85], [w * 0.95, -h * 0.45], [w * 0.88, -2]];
  return def([P(pts, 'glowpink', { bev: 4, bulge: 0.2 })], [], { noOutline: true });
}
// ---- arm-fin (two segments)
function upperArmDef() {
  return def([E(0, 0, 10, 9, 'brass', { f: 0.8, lum: -0.1 }), C(0, 2, -5, 18, 8, 6, 'armor', { seam: false, lum: -0.12 }), E(-5, 18, 4, 4, 'red', { f: 0.6 }), E(-5, 18, 2, 2, 'redglow')], [RIV(2, -2), RIV(-3, 9)]);
}
function lowerArmDef() {
  const prims = [C(0, 0, -14, 8, 6, 5, 'armor', { lum: -0.12 })];
  // webbed fin-foot
  prims.push(P([[-12, 6], [-26, 4], [-30, 10], [-24, 16], [-10, 12]], 'iron', { bev: 1.2, lum: 0.05 }));
  for (const [tx, ty] of [[-28, 5], [-30, 10], [-25, 15]]) prims.push(C(-12, 9, tx, ty, 1.6, 0.8, 'armor', { seam: false }));
  return def(prims, [RIV(-4, 2)]);
}
// ---- tail (two segments + latticed caudal fin)
function tailADef() {
  return def([C(-4, 0, 30, 0, 22, 14, 'armor', { lum: -0.2 }), P([[6, -20], [10, -20], [10, 20], [6, 20]], 'iron', { paint: true }), P([[16, -10], [26, -8], [26, -6], [16, -8]], 'redglow')], [RIV(20, -12), RIV(20, 10)]);
}
function tailBDef() {
  const prims = [C(-4, 0, 26, 0, 14, 6, 'armor', { lum: -0.2 }), P([[20, -6], [44, -24], [50, -6], [50, 6], [44, 22], [20, 6]], 'iron', { bev: 1.4, lum: 0.05 })];
  const decals = [];
  for (const [x, y] of [[34, -12], [40, -16], [38, -4], [44, -8], [38, 8], [44, 14], [44, 2]]) decals.push(HOLE(x, y, 1.6, 1.8, '#ff7a30'));
  return def(prims, decals);
}

// ---- minion hopper (~30 px) ------------------------------------------------
function hopperDef() {
  const prims = [
    C(-2, 0, 14, 1, 6, 3, 'armor'),
    E(-10, -1, 8, 6.5, 'armor', { seam: false }),
    P([[-16, 2], [-4, 3], [-4, 5], [-15, 5]], 'brass', { bev: 0.8 }),
    P([[-2, -6], [2, -13], [9, -12], [10, -5]], 'iron', { bev: 0.9 }),
    P([[13, -1], [20, -6], [21, 0], [20, 6], [13, 3]], 'iron', { bev: 0.9 }),
    C(-4, 5, -9, 10, 1.6, 1.2, 'armor'),
    E(-12, -7, 2.8, 2.8, 'iron', { f: 0.6 }), E(-12.3, -7.3, 1.7, 1.7, 'redglow'),
    E(-7, -7.5, 2.8, 2.8, 'iron', { f: 0.6 }), E(-7.3, -7.8, 1.7, 1.7, 'redglow'),
  ];
  return def(prims, [{ k: 'fill', x: 3, y: -9, rx: 1, ry: 1, op: { c: '#ff8a3a' } }, { k: 'fill', x: 6, y: -8, rx: 1, ry: 1, op: { c: '#ff8a3a' } }, LN([[-16, 3], [-6, 3]], { dk: 3 }), DOT(0, -2, { m: 'redglow', i: 2 })]);
}
function mudBallDef(r) {
  return def([E(0, 0, r, r, 'iron', { lum: -0.12 }), E(-0.5, -0.5, r * 0.5, r * 0.5, 'redglow', { lum: -0.25 })], [DOT(-r * 0.5, -r * 0.5, { lt: 2 })]);
}

let CACHE = null;
export function getMudSprites() {
  if (CACHE) return CACHE;
  const S = {};
  S.torso = buildPart(torsoDef(), { red: true });
  S.head = buildPart(headDef(), { red: true });
  S.jaw = buildPart(jawDef(), { red: true });
  S.maw = buildPart(mawDef());
  S.eye = buildPart(eyeDef());
  S.eyeDead = buildPart(eyeDeadDef());
  S.sails = [sailDef(54, 40), sailDef(64, 46), sailDef(48, 36)].map((d) => buildPart(d, { red: true, far: true }));
  S.sailGlow = [sailGlowDef(54, 40), sailGlowDef(64, 46), sailGlowDef(48, 36)].map((d) => buildPart(d));
  S.upper = buildPart(upperArmDef(), { far: true });
  S.lower = buildPart(lowerArmDef(), { far: true });
  S.tailA = buildPart(tailADef(), { red: true });
  S.tailB = buildPart(tailBDef(), { red: true });
  S.hopper = buildPart(hopperDef());
  S.mud = buildPart(mudBallDef(4));
  S.mudBig = buildPart(mudBallDef(6));
  S.eyeGlow = buildGlow(10, [255, 50, 30], 4);
  S.redLight = buildGlow(4, [255, 40, 30], 3);
  S.sailFire = buildGlow(26, [255, 120, 40], 6);
  S.bellyGlow = buildGlow(14, [255, 200, 90], 4);
  S.tellGlow = buildGlow(8, [170, 250, 255], 3);
  S.mawGlow = buildGlow(14, [255, 60, 40], 5);
  // landing shadow ellipse (stepped alpha)
  S.shadow = makeSprite(64, 12, (ctx) => {
    for (let y = 0; y < 12; y++) for (let x = 0; x < 64; x++) {
      const q = ((x - 31.5) / 32) ** 2 + ((y - 5.5) / 6) ** 2;
      if (q > 1) continue;
      ctx.fillStyle = `rgba(10,4,20,${(Math.ceil((1 - q) * 3) / 3 * 0.55).toFixed(2)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return (CACHE = S);
}
