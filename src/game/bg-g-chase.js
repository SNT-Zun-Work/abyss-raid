
import { W, H } from '../config.js';
import { makeRng } from '../core/rng.js';
import { fbm1, fbm2, ramp, rampBand, pixelSprite, bayer, hash } from './bg-noise.js';
import { visualAssets } from './g-visual-assets.js';

const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const MW = 800;                 // mudflat tile width
export const SKY_PAR = 0.07;    // painted sky / refinery parallax vs chaseX
const SEG = 0.45;               // right part of the painting (open sky) used to extend it

let ART = null;
function art() {
  if (ART) return ART;
  ART = { mud: makeMudflat(), pylon: makePylon(), waves: [makeWave(150, 46, 3), makeWave(110, 34, 9)], water: makeWater(), sun: makeSun() };
  return ART;
}

// ------------------------------------------------------------- mudflat
const MUD = ramp('#140c08', '#1e140d', '#2a1c12', '#382518', '#48311f', '#5a3e28', '#6e4c31');
function makeMudflat() {
  const h = 62;
  const top = new Float32Array(MW);
  for (let x = 0; x < MW; x++) top[x] = 16 + 9 * (fbm1(x / 80, 10, 81, 4) - 0.5) * 2 + 3 * (fbm1(x / 16, 50, 82, 2) - 0.5);
  const rng = makeRng(88);
  const puddles = [];
  for (let i = 0; i < 14; i++) puddles.push({ x: rng.range(0, MW), y: rng.range(24, 54), rx: rng.range(10, 42), ry: rng.range(1.8, 4.5) });
  const rocks = [];
  for (let i = 0; i < 9; i++) rocks.push({ x: rng.range(0, MW), w: rng.range(8, 26), h: rng.range(4, 12) });
  // periodic worley for mud cracks (cells of 20 px → 40 per tile)
  const cell = 20, cx = MW / cell;
  const pt = (i, j) => [((i % cx) + cx) % cx * cell + hash(((i % cx) + cx) % cx, j, 5) * cell, j * cell + hash(((i % cx) + cx) % cx, j, 6) * cell];
  const crack = (x, y) => {
    const i0 = Math.floor(x / cell), j0 = Math.floor(y / cell);
    let d1 = 1e9, d2 = 1e9;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const [px, py] = pt(i, j), ox = (i - (((i % cx) + cx) % cx)) * cell;
      const dx = x - (px + ox), dy = (y - py) * 1.8, d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return d2 - d1;
  };
  const inPuddle = (x, y) => {
    for (const p of puddles) for (const ox of [-MW, 0, MW]) {
      const dx = (x - p.x - ox) / p.rx, dy = (y - p.y) / p.ry;
      const q = dx * dx + dy * dy;
      if (q < 1) return { p, q, dy };
    }
    return null;
  };
  const rockAt = (x, y) => {
    for (const r of rocks) for (const ox of [-MW, 0, MW]) {
      const dx = (x - r.x - ox) / (r.w / 2), base = top[((Math.round(r.x) % MW) + MW) % MW] + 4;
      if (Math.abs(dx) < 1 && y > base - r.h * Math.sqrt(1 - dx * dx) && y < base + 3) return { r, edge: y < base - r.h * Math.sqrt(1 - dx * dx) + 1.5 };
    }
    return null;
  };
  const REFL = ramp('#241a30', '#4a2a3c', '#8a3c3c', '#d0603e', '#f39050', '#ffc070');
  return pixelSprite(MW, h, (x, y) => {
    const rk = rockAt(x, y);
    if (rk) return rk.edge ? [170, 92, 76] : rampBand(ramp('#07050a', '#0d0a10', '#151018'), 0.5 + (fbm2(x / 4, y / 4, MW / 4, 0, 3, 2) - 0.5), x, y, 0.3);
    const t0 = top[x];
    if (y < t0) return null;
    const pd = inPuddle(x, y);
    if (pd) {
      if (pd.q > 0.78) return [14, 9, 8];                                       // puddle rim
      // reflection of the sunset sky: brighter toward the far (upper) edge
      const v = 0.85 - (pd.dy + 1) * 0.42 + (fbm2(x / 8, y, MW / 8, 0, 9, 2) - 0.5) * 0.5;
      return rampBand(REFL, v, x, y, 0.35);
    }
    const d = y - t0;
    if (crack(x, y) < 1.3 && d > 2) return d > 3 && crack(x, y) < 0.6 ? [4, 3, 3] : [9, 6, 5];
    let v = 0.4 - d * 0.004 + (d < 1 ? 0.4 : d < 3 ? 0.18 : 0);
    v += (fbm2(x / 8, y / 5, MW / 8, 0, 4, 3) - 0.5) * 0.45;
    // wet sheen: thin warm glints catching the sky
    const sheen = fbm2(x / 20, y / 1.5, MW / 20, 0, 12, 2);
    if (sheen > 0.66) return d < 14 ? (sheen > 0.74 ? [236, 146, 86] : [178, 96, 62]) : [128, 78, 54];   // wet glints
    return rampBand(MUD, v, x, y, 0.25);
  });
}

// --------------------------------------------------------------- pylon
function makePylon() {
  const w = 22, h = 150;
  return pixelSprite(w, h, (x, y) => {
    const col = x >= 7 && x <= 14;
    const cap = y < 6 && x >= 2 && x <= 19;
    const brace = y > 30 && ((Math.abs((x - 3) - ((y - 30) % 28) * 0.6) < 1.1) || (Math.abs((x - 18) + ((y - 30) % 28) * 0.6) < 1.1)) && (x < 7 || x > 14) && x > 1 && x < 20;
    const ring = (y % 28 === 2) && x >= 4 && x <= 17;
    if (y >= 1 && y <= 2 && x === 10) return [255, 70, 40];                     // warning lamp
    if (!(col || cap || brace || ring)) return null;
    if (x === 7 || (cap && y === 0)) return [92, 54, 62];                     // warm rim (sun behind)
    return y % 9 === 0 && col ? [22, 18, 30] : x > 12 && col ? [8, 7, 12] : [14, 12, 20];
  });
}

// ---------------------------------------------- breaking surge wave
function makeWave(w, h, seed) {
  const prof = (x) => {
    const f = x / w;
    return h * (0.15 + 0.85 * Math.exp(-Math.pow((f - 0.62) / (f < 0.62 ? 0.32 : 0.12), 2))) + 2 * (fbm1(x / 6, 0, seed, 2) - 0.5);
  };
  const BODY = ramp('#05080f', '#080d18', '#0c1422', '#121c2e', '#1a283a');
  return pixelSprite(w, h + 6, (x, y) => {
    const top = h + 6 - prof(x);
    if (y < top - 3) {
      // spray off the crest
      if (y > top - 9 && x > w * 0.5 && x < w * 0.8 && bayer(x, y) < 0.18) return [130, 120, 130, 180];
      return null;
    }
    if (y < top) return bayer(x, y) < 0.6 ? [150, 138, 146, 220] : null;          // foam cap (muted: behind bullets)
    if (y < top + 2) return [110, 98, 108];
    const face = x > w * 0.55 && x < w * 0.72;                                    // steep lit face
    return rampBand(BODY, 0.35 + (face ? 0.3 : 0) - (y - top) / h * 0.4, x, y, 0.3);
  });
}

// ---------------------------------------- rushing water base (chase)
function makeWater() {
  const h = 90;
  const SEA = ramp('#050818', '#0a0f24', '#111a32', '#1a2440', '#2a2c4c', '#4a3450', '#7c4450', '#c0604c');
  return pixelSprite(W, h, (x, y) => {
    const d = y / h;
    const v = 0.15 + 0.25 * (1 - d) + Math.max(0, 0.6 - d * 4) * 0.9;           // warm band at the horizon
    return rampBand(SEA, v, x, y, 0.3);
  });
}
function makeSun() {
  return pixelSprite(31, 31, (x, y) => {
    const d = Math.hypot(x - 15, y - 15);
    if (d < 8) return d < 6 ? [255, 238, 176] : [255, 206, 120];
    if (d < 15) { const a = Math.round((1 - (d - 8) / 7) ** 1.5 * 4) / 4; return a > 0 ? [255, 150, 70, Math.round(a * 140)] : null; }
    return null;
  });
}

// -------------------------------------------------------------- update
export function initChase(bg) {
  bg.chase = 0; bg.chaseSpeed = 0; bg.chaseX = 0;
}
export function updateChase(world) {
  const bg = world.bg;
  const c = clamp(+bg.chase || 0, 0, 1);
  bg.chaseX += (+bg.chaseSpeed || 0) * c;
}

// ---------------------------------------------------------------- draw
// Painted sky extension: virtual strip = painting, then its open-sky right part
// ping-ponged (mirror / normal) so it continues seamlessly as the refinery leaves.
function drawSkyExt(ctx, img, o, sy, dy) {
  const sx = img.naturalWidth / W, sh = img.naturalHeight / H;
  const S = W * SEG, rows = clamp(sy + 3 - dy, 1, H);
  let x = Math.max(0, W - o);
  while (x < W) {
    const X = o + x - W, k = Math.floor(X / S), u = X - k * S;
    const seg = Math.min(S - u, W - x);
    if (k % 2 === 0) {
      ctx.save(); ctx.translate(x + seg, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, (W - u - seg) * sx, 0, seg * sx, rows * sh, 0, dy, seg, rows);
      ctx.restore();
    } else {
      ctx.drawImage(img, (W * (1 - SEG) + u) * sx, 0, seg * sx, rows * sh, x, dy, seg, rows);
    }
    x += seg;
  }
}

// mood grade for regions this module paints itself (mirrors the painted backdrop's look)
function grade(ctx, m, bg, x, y, w, h, skyRows) {
  if (w <= 0 || h <= 0) return;
  if (m.storm > 0.01) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(${Math.round(255 - 110 * m.storm)},${Math.round(255 - 100 * m.storm)},${Math.round(255 - 70 * m.storm)})`; ctx.fillRect(x, y, w, h); }
  if (m.blood > 0.01) {
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(255,${Math.round(255 - 195 * m.blood)},${Math.round(255 - 200 * m.blood)})`; ctx.fillRect(x, y, w, h);
    if (skyRows > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(150,10,0,${(0.3 * m.blood).toFixed(3)})`; ctx.fillRect(x, y, w, Math.min(h, skyRows)); }
  }
  if (m.flashSky > 0.05 && skyRows > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(200,170,255,${(0.45 * m.flashSky).toFixed(3)})`; ctx.fillRect(x, y, w, Math.min(h, skyRows)); }
  ctx.globalCompositeOperation = 'source-over';
  if (bg.darken > 0) { ctx.fillStyle = `rgba(0,0,10,${(clamp(bg.darken, 0, 1) * 0.7).toFixed(3)})`; ctx.fillRect(x, y, w, h); }
  const tint = bg.tint;
  if (tint && typeof tint === 'object') { ctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${clamp(tint.a ?? 0.3, 0, 1)})`; ctx.fillRect(x, y, w, h); }
  else if (tint > 0) { ctx.fillStyle = `rgba(160,0,20,${0.35 * Math.min(1, tint)})`; ctx.fillRect(x, y, w, h); }
}

// Painted backdrop, scrolled by the chase. Returns false when the painting is
// unavailable (caller falls back to the procedural backdrop).
export function drawPainted(ctx, world, drawVisualBack) {
  const bg = world.bg;
  const img = visualAssets.background;
  const o = Math.floor(bg.chaseX * SKY_PAR);
  if (o <= 0 || !img || !img.naturalWidth) return drawVisualBack(ctx, world);
  const sy = bg.surfaceY ?? 143, dy = sy - 143;
  if (o < W) { ctx.save(); ctx.translate(-o, 0); drawVisualBack(ctx, world); ctx.restore(); }
  const ex = Math.max(0, W - o);
  ctx.fillStyle = '#102439'; ctx.fillRect(ex, 0, W - ex, H);
  drawSkyExt(ctx, img, o, sy, dy);
  grade(ctx, bg.mood, bg, ex, 0, W - ex, Math.ceil(sy + 3), sy + 3);
  return true;
}

// Mudflat foreground band (first half). Slides away + fades as the chase starts.
export function drawMudflat(ctx, world) {
  const bg = world.bg, c = clamp(+bg.chase || 0, 0, 1);
  if (c >= 0.99) return;
  const A = art();
  const off = mod(Math.floor(bg.chaseX * 1.1 + bg.scroll * 0.4), MW);
  const y = H - A.mud.height + 4;
  ctx.globalAlpha = 1 - c;
  ctx.drawImage(A.mud, -off, y);
  if (MW - off < W) ctx.drawImage(A.mud, MW - off, y);
  ctx.globalAlpha = 1;
  grade(ctx, bg.mood, bg, 0, y + 10, W, H - y, 0);
}

const STREAKS = [];
for (let i = 0; i < 46; i++) STREAKS.push({ x: hash(i, 1, 41) * (W + 80), d: hash(i, 2, 41), len: 6 + hash(i, 3, 41) * 34, warm: hash(i, 4, 41) < 0.45 });
const FOAM = [];
for (let i = 0; i < 18; i++) FOAM.push({ x: hash(i, 1, 43) * (W + 120), d: 0.15 + hash(i, 2, 43) * 0.85, len: 10 + hash(i, 3, 43) * 40 });

// Chase water + horizon pier + sun + pylons (all behind the boss).
export function drawChaseWater(ctx, world, rigsImg, rigsHZ) {
  const bg = world.bg, m = bg.mood, c = clamp(+bg.chase || 0, 0, 1);
  if (c <= 0.01 && bg.chaseX <= 0) return;
  const A = art(), t = bg.t, X = bg.chaseX;
  const sy = Math.round(bg.surfaceY ?? 143), wh = H - sy;
  const o = Math.floor(X * SKY_PAR), ex = Math.max(0, W - o);
  const vis = Math.max(c, 0);
  // distant pier / rigs on the horizon (procedural tile), parallax
  if (rigsImg) {
    const tw = rigsImg.width, off = mod(Math.floor(X * 0.16), tw), y = sy - rigsHZ;
    ctx.globalAlpha = vis;
    ctx.drawImage(rigsImg, -off, y);
    if (tw - off < W) ctx.drawImage(rigsImg, tw - off, y);
    ctx.globalAlpha = 1;
  }
  // the low sun that the open sea sets into (fades in once the refinery is gone)
  const sunA = clamp((o - W * 0.55) / (W * 0.3), 0, 1) * vis;
  const sunX = Math.round(W * 0.47);
  if (sunA > 0) { ctx.globalAlpha = sunA * 0.35; ctx.drawImage(A.sun, sunX - 15, sy - 16); ctx.globalAlpha = 1; }
  // rushing water: painted water crossfades out, extension region fully ours
  const alphaL = vis;
  if (alphaL > 0 && ex > 0) { ctx.globalAlpha = alphaL; ctx.drawImage(A.water, 0, 0, ex, Math.min(wh, A.water.height), 0, sy, ex, wh); }
  ctx.globalAlpha = 1;
  if (ex < W) ctx.drawImage(A.water, ex, 0, W - ex, Math.min(wh, A.water.height), ex, sy, W - ex, wh);
  // speed streaks: reflections (warm near the horizon) moving faster with depth
  const sp = Math.max(0.3, +bg.chaseSpeed || 0);
  for (const s of STREAKS) {
    const depth = s.d, y = sy + 2 + Math.round(depth * depth * (wh - 4));
    const x = mod(s.x - X * (0.25 + depth * 1.3), W + 80) - 40;
    const len = Math.round(s.len * (0.6 + depth) * Math.min(2, 0.6 + sp * 0.15));
    const a = (0.25 + 0.4 * (1 - depth)) * vis;
    ctx.fillStyle = s.warm ? `rgba(240,140,90,${a.toFixed(3)})` : `rgba(120,140,190,${(a * 0.7).toFixed(3)})`;
    ctx.fillRect(Math.round(x), y, len, 1);
  }
  // sun glint column under the open-sea sun
  if (sunA > 0) {
    for (let k = 0; k < 16; k++) {
      const yy = sy + 2 + k * 3, hw = 3 + k * 1.4 + Math.sin(t * 0.15 + k * 1.9) * 2;
      ctx.fillStyle = `rgba(240,150,90,${(0.3 * (1 - k / 16) * sunA).toFixed(3)})`;
      ctx.fillRect(Math.round(sunX - hw + Math.sin(t * 0.1 + k) * 3), yy, Math.round(hw * 2), 1);
    }
  }
  grade(ctx, m, bg, 0, sy, W, wh, 0);
}

// Pylons streaking past during the chase (dark silhouettes, background only).
export function drawPylons(ctx, world) {
  const bg = world.bg, X = bg.chaseX, vis = clamp(+bg.chase || 0, 0, 1);
  const A = art();
  const P = A.pylon, gap = 230;
  if (vis > 0.05) {
    ctx.globalAlpha = clamp(vis * 1.3, 0, 1);
    const off = mod(X * 1.5, gap);
    for (let x = -off - P.width; x < W + gap; x += gap) {
      const k = Math.round((x + X * 1.5) / gap);
      const hgt = 0.75 + 0.25 * hash(k, 1, 51);
      const top = Math.round(H - P.height * hgt);
      ctx.drawImage(P, 0, 0, P.width, Math.round(P.height * hgt), Math.round(x), top, P.width, Math.round(P.height * hgt));
    }
    ctx.globalAlpha = 1;
  }
}

// Final-form storm surge: big breaking waves rolling along the horizon band.
export function drawSurge(ctx, world) {
  const bg = world.bg, m = bg.mood;
  const k = Math.max(m.blood, (m.storm - 0.6) * 1.5);
  if (k <= 0.02) return;
  const A = art(), t = bg.t, sy = Math.round(bg.surfaceY ?? 143);
  const v = 0.7 + (+bg.chaseSpeed || 0) * clamp(+bg.chase || 0, 0, 1) * 0.35;
  ctx.globalAlpha = clamp(k, 0, 1);
  for (let i = 0; i < 4; i++) {
    const wv = A.waves[i & 1], span = W + wv.width + 60;
    const x = mod(i * 157 - t * v * (0.8 + i * 0.15), span) - wv.width;
    const bob = Math.round(Math.sin(t * 0.04 + i * 1.7) * 3 * k);
    const scaleY = 0.7 + 0.5 * k;
    const hh = Math.round(wv.height * scaleY);
    ctx.drawImage(wv, Math.round(x), sy + 8 - hh + bob, wv.width, hh);
  }
  ctx.globalAlpha = 1;
}

// Chase extras in front of the boss (behind player/bullets): foam lines + spray.
export function drawChaseMid(ctx, world) {
  const bg = world.bg, c = clamp(+bg.chase || 0, 0, 1);
  if (c <= 0.02) return;
  const X = bg.chaseX, t = bg.t, sy = Math.round(bg.surfaceY ?? 143), wh = H - sy;
  for (const f of FOAM) {
    const y = sy + 1 + Math.round(f.d * f.d * (wh - 6));
    const x = mod(f.x - X * (0.35 + f.d * 1.35), W + 120) - 60;
    ctx.fillStyle = `rgba(210,215,230,${(0.35 * c * (0.5 + f.d * 0.5)).toFixed(3)})`;
    ctx.fillRect(Math.round(x), y, Math.round(f.len * (0.5 + f.d)), 1);
  }
  // spray flicking backward off the surface
  ctx.fillStyle = `rgba(230,220,220,${(0.6 * c).toFixed(3)})`;
  for (let i = 0; i < 28; i++) {
    const ph = (t * 1.3 + i * 23) % 40;
    if (ph > 18) continue;
    const x = mod(i * 61 - X * 1.2 - ph * 3, W + 20) - 10;
    const y = sy - Math.sin((ph / 18) * Math.PI) * (2 + (i % 5) * 2);
    ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  }
}

// red storm grade over the surge band only (the waves are drawn after the
// painted backdrop applied its own grade)
export function gradeSurge(ctx, world) {
  const bg = world.bg, m = bg.mood;
  if (m.blood <= 0.02) return;
  const sy = Math.round(bg.surfaceY ?? 143);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(255,${Math.round(255 - 150 * m.blood)},${Math.round(255 - 160 * m.blood)})`;
  ctx.fillRect(0, sy - 60, W, 70);
  ctx.globalCompositeOperation = 'source-over';
}
