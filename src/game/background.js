// Sunken-city cavern parallax zone (bg/fx agent).
//
// world.bg = { scroll, speed, t, tint, darken }
//   speed  : px/frame of the nearest back layer reference (1 = near layers move
//            ~0.4-0.55 px). Scenes write it; a slow drift (~0.3-0.5) suits warning/boss.
//   tint   : red emergency tint — either a number 0..1, or {r,g,b,a} (flat
//            overlay colour), or null. Writable by scenes/boss.
//   darken : 0..1 darkening (dramatic moods). Writable by scenes/boss.
//
// drawBack composes every back layer into an offscreen buffer (with a margin
// for shake), then blits it to the screen in horizontal runs with a sine
// x-offset — a subtle per-scanline raster wobble like 90s arcade water stages.
//   back layers (far → near): haze water, distant spire city + submarines,
//   light shafts, far ceiling, mid city (saucer platforms, towers, red lights),
//   near decks/rocks with red light strips, stalactite cavern ceiling + cables.
// drawMid   = drifting particulate + bubbles (in front of the boss, behind player).
// drawFront = low dark rock outcrops + swaying weeds at the bottom edge.
// Late-fight moods (bg-mood.js): phaseChange to:3 → emergency lighting,
// to:4 → cavern collapse (also follows world.boss.phase as a fallback).

import { W, H } from '../config.js';
import { makeSprite } from '../core/util.js';
import { hash } from './bg-noise.js';
import { getArt, M, BW, BH, TW, RAY_W } from './bg-art.js';
import { initMood, updateMood, drawAlarm, drawFar, drawNear, gradeMood, rasterAmp, lightPulse } from './bg-mood.js';
import * as zoneG from './bg-g.js';
import { isTideZone } from '../config.js';
import { drawBack as drawVisualV } from './v-visual-background.js';

// Zone dispatch: 'G' = SUNSET TIDELANDS (bg-g.js); anything else = the V cavern below.
const isG = (world) => isTideZone(world); // G and M share the tidelands stage

const PAR = { ray: 0.03, skyline: 0.03, far: 0.06, farCeil: 0.12, mid: 0.2, near: 0.38, ceil: 0.55, front: 0.8, specks: 1 };

let buf = null, bctx = null;
function ensureBuffers() {
  if (buf) return;
  buf = makeSprite(BW, BH, () => {});
  bctx = buf.getContext('2d');
  bctx.imageSmoothingEnabled = false;
}

const mod = (a, n) => ((a % n) + n) % n;

export function init(world) {
  if (isG(world)) return zoneG.init(world);
  getArt();
  ensureBuffers();
  world.bg = { scroll: 0, speed: 0.4, t: 0, tint: 0, darken: 0 };
  initMood(world.bg);
}

export function update(world) {
  if (isG(world)) return zoneG.update(world);
  const b = world.bg;
  b.scroll += b.speed || 0;
  b.t++;
  updateMood(world);
}

function layer(img, f, scroll) {
  const off = mod(Math.floor(scroll * f), TW);
  bctx.drawImage(img, -off, 0);
  if (TW - off < BW) bctx.drawImage(img, TW - off, 0);
  return off;
}

function lights(list, off, t, A, dim, m) {
  for (const L of list) {
    let x = L.x - off;
    if (x < -4) x += TW;
    if (x > BW + 4) continue;
    if (mod(t + L.ph, L.per) >= L.per * L.duty && !(m && m.em > 0.4 && lightPulse(m, t, L.x) > 0.5)) continue;
    if (dim) { bctx.fillStyle = '#ff5038'; bctx.fillRect(x, L.y, 1, 1); continue; }
    const g = L.big ? A.glowBig : A.glow;
    bctx.drawImage(g, x - (g.width >> 1), L.y - (g.height >> 1));
  }
}

// light shafts through a gap in the far ceiling, upper-left (as in the reference)
const RAYS = [
  { x: 40, a: 0.30, p: 0.0, w: 1.0 },
  { x: 92, a: 0.24, p: 1.7, w: 0.7 },
  { x: 140, a: 0.18, p: 3.1, w: 1.2 },
  { x: 196, a: 0.12, p: 4.4, w: 0.8 },
  { x: 250, a: 0.07, p: 5.2, w: 0.65 },
];

export function drawBack(ctx, world) {
  if (isG(world)) return zoneG.drawBack(ctx, world);
  if (drawVisualV(ctx,world)) return;
  const A = getArt();
  ensureBuffers();
  const bg = world.bg;
  const s = bg.scroll, t = bg.t;
  bctx.globalCompositeOperation = 'source-over';
  bctx.globalAlpha = 1;
  bctx.drawImage(A.water, 0, 0);

  layer(A.skyline, PAR.skyline, s);
  const offFar = layer(A.far, PAR.far, s);
  bctx.globalCompositeOperation = 'lighter';
  lights(A.lights.far, offFar, t, A, true, bg.mood);
  bctx.globalCompositeOperation = 'source-over';
  drawFar(bctx, bg.mood);
  bctx.globalCompositeOperation = 'lighter';

  // light shafts (additive), slowly swaying
  const rs = mod(s * PAR.ray, 480);
  for (let i = 0; i < RAYS.length; i++) {
    const r = RAYS[i];
    const x = mod(r.x - rs, 480) - 40;
    const ang = r.a + 0.03 * Math.sin(t * 0.0081 + r.p);
    bctx.globalAlpha = Math.max(0, 0.6 + 0.35 * Math.sin(t * 0.011 * (1 + i * 0.13) + r.p * 2));
    bctx.save();
    bctx.translate(x + M, 0);
    bctx.rotate(-ang);
    bctx.scale(r.w, 1);
    bctx.drawImage(A.ray, -RAY_W / 2, -4);
    bctx.restore();
  }
  bctx.globalAlpha = 1;
  bctx.globalCompositeOperation = 'source-over';

  layer(A.farCeil, PAR.farCeil, s);
  const offMid = layer(A.mid, PAR.mid, s);
  bctx.globalCompositeOperation = 'lighter';
  lights(A.lights.mid, offMid, t, A, false, bg.mood);
  bctx.globalCompositeOperation = 'source-over';
  drawAlarm(bctx, bg.mood, A.lights.mid, offMid, t);
  bctx.globalCompositeOperation = 'lighter';
  bctx.globalCompositeOperation = 'source-over';
  const offNear = layer(A.near, PAR.near, s);
  bctx.globalCompositeOperation = 'lighter';
  lights(A.lights.near, offNear, t, A, false, bg.mood);
  bctx.globalCompositeOperation = 'source-over';
  const offCeil = layer(A.ceil, PAR.ceil, s);
  drawNear(bctx, bg.mood, offCeil, t);
  gradeMood(bctx, bg.mood, t);

  // mood overlays
  if (bg.darken > 0) {
    bctx.fillStyle = `rgba(0,3,12,${Math.min(1, bg.darken) * 0.7})`;
    bctx.fillRect(0, 0, BW, BH);
  }
  const tint = bg.tint;
  if (tint && typeof tint === 'object') {
    bctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${Math.max(0, Math.min(1, tint.a ?? 0.3))})`;
    bctx.fillRect(0, 0, BW, BH);
  } else if (tint > 0) {
    const k = Math.min(1, tint);
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgb(255,${Math.round(255 - 175 * k)},${Math.round(255 - 185 * k)})`;
    bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = `rgba(110,0,16,${0.32 * k})`;
    bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'source-over';
  }

  // raster blit: merge consecutive rows with the same offset into one draw
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const amp = rasterAmp(bg.mood);
  let y0 = 0, d0 = rowOff(0, t, amp);
  for (let y = 1; y <= BH; y++) {
    const d = y < BH ? rowOff(y, t, amp) : 1e9;
    if (d !== d0) {
      ctx.drawImage(buf, 0, y0, BW, y - y0, d0 - M, y0 - M, BW, y - y0);
      y0 = y; d0 = d;
    }
  }
  ctx.imageSmoothingEnabled = smooth;
}

function rowOff(y, t, amp = 1) {
  return Math.round(amp * (0.9 * Math.sin(y * 0.07 + t * 0.04) + 0.4 * Math.sin(y * 0.023 - t * 0.019)));
}

// ------------------------------------------------------- mid: particulate
const SPECKS = [];
for (let i = 0; i < 64; i++) {
  const f = 0.3 + hash(i, 3, 9) * 0.9;
  SPECKS.push({ x: hash(i, 1, 9) * (W + 8), y: hash(i, 2, 9) * H, f, ph: hash(i, 4, 9) * 6.28, tier: f > 0.95 ? 2 : f > 0.65 ? 1 : 0 });
}
const SPECK_STYLE = ['rgba(110,180,210,0.3)', 'rgba(140,205,230,0.45)', 'rgba(180,230,250,0.6)'];
const EXTRA = [];
for (let i = 0; i < 70; i++) EXTRA.push({ x: hash(i, 1, 19) * (W + 8), y: hash(i, 2, 19) * H, f: 0.5 + hash(i, 3, 19) * 0.9, ph: hash(i, 4, 19) * 6.28 });
const BUBS = [];
for (let i = 0; i < 10; i++) BUBS.push({ x: hash(i, 5, 10) * (W + 20), y: hash(i, 6, 10) * (H + 40), v: 0.3 + hash(i, 7, 10) * 0.45, sz: hash(i, 8, 10) < 0.6 ? 0 : 1, ph: hash(i, 9, 10) * 6.28 });

export function drawMid(ctx, world) {
  if (isG(world)) return zoneG.drawMid(ctx, world);
  const A = getArt();
  const { scroll: s, t } = world.bg;
  for (let tier = 0; tier < 3; tier++) {
    ctx.fillStyle = SPECK_STYLE[tier];
    for (const p of SPECKS) {
      if (p.tier !== tier) continue;
      const x = mod(p.x - s * p.f - t * 0.1 * p.f, W + 8) - 4;
      const y = mod(p.y + Math.sin(t * 0.02 + p.ph) * 3 + t * 0.04 * p.f, H);
      const sz = tier === 2 && p.ph > 4 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
  }
  // late fight: extra churned-up particulate (falls when the cavern collapses)
  const m = world.bg.mood;
  if (m && (m.em > 0.05 || m.col > 0.05)) {
    const n = Math.round(EXTRA.length * Math.max(m.em, m.col));
    ctx.fillStyle = m.col > 0.3 ? 'rgba(150,140,150,0.5)' : 'rgba(150,190,210,0.45)';
    for (let i = 0; i < n; i++) {
      const p = EXTRA[i];
      const x = mod(p.x - s * p.f + Math.sin(t * 0.03 + p.ph) * 4, W + 8) - 4;
      const y = mod(p.y + t * (0.08 + 0.9 * m.col) * p.f, H);
      ctx.fillRect(Math.round(x), Math.round(y), 1, m.col > 0.3 && p.f > 1 ? 2 : 1);
    }
  }
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const b of BUBS) {
    const y = mod(b.y - t * b.v, H + 40) - 20;
    const x = mod(b.x - s * 0.5 + Math.sin(t * 0.06 + b.ph) * 2.5, W + 20) - 10;
    ctx.drawImage(A.bubbles[b.sz], Math.round(x), Math.round(y));
  }
  ctx.imageSmoothingEnabled = smooth;
}

// ------------------------------------------------- front: rocks + weeds
const FRONT_PERIOD = 1700;
const FRONT = [
  { x: -14, rock: 'frontRock', strands: [[22, 3, 0.0, -26], [40, 4, 1.3, -36], [104, 3, 2.2, -30]] },
  { x: 760, rock: 'frontRock2', strands: [[20, 3, 0.7, -16]] },
  { x: 1180, rock: null, strands: [[0, 4, 1.9, 0], [10, 3, 0.4, 0]] },
];

export function drawFront(ctx, world) {
  if (isG(world)) return zoneG.drawFront(ctx, world);
  const A = getArt();
  const { scroll: s, t } = world.bg;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const base = mod(Math.floor(s * PAR.front), FRONT_PERIOD);
  for (const g of FRONT) {
    const gx = mod(g.x - base + 200, FRONT_PERIOD) - 200;
    if (gx < -200 || gx > W + 40) continue;
    for (const [dx, n, ph, dy] of g.strands) {
      let x = gx + dx, y = H + 4 + dy, ang = 0;
      for (let k = 0; k < n; k++) {
        ang += 0.08 * Math.sin(t * 0.023 + ph - k * 0.5) + 0.03;
        x += Math.sin(ang) * 6;
        y -= Math.cos(ang) * 6;
        ctx.drawImage(A.kelp[(k + ((ph * 3) | 0)) & 3], Math.round(x - 5), Math.round(y - 4));
      }
    }
    if (g.rock) { const r = A[g.rock]; ctx.drawImage(r, Math.round(gx), H - r.height + 2); }
  }
  ctx.imageSmoothingEnabled = smooth;
}
