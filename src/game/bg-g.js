
import { W, H } from '../config.js';
import { drawMounds } from './fx.js';
import { drawBack as drawVisualBack } from './g-visual-background.js';
import { makeSprite } from '../core/util.js';
import { M, BW, BH, TW } from './bg-art.js';
import { getGArt, SURF_DEFAULT, SUN_X, SKY_EXTRA, GS_W, GS_FR } from './bg-g-art.js';
import { initChase, updateChase, drawPainted, drawMudflat, drawChaseWater, drawPylons, drawSurge, drawChaseMid, gradeSurge } from './bg-g-chase.js';

const PAR = { cloudsFar: 0.02, clouds: 0.05, rigs: 0.06, city: 0.12, mud: 0.45, front: 0.7 };
const mod = (a, n) => ((a % n) + n) % n;

let buf = null, bctx = null;
function ensure() {
  if (buf) return;
  buf = makeSprite(BW, BH, () => {});
  bctx = buf.getContext('2d');
  bctx.imageSmoothingEnabled = false;
}

export function init(world) {
  getGArt();
  ensure();
  world.bg = { scroll: 0, speed: 0.3, t: 0, tint: 0, darken: 0, surfaceY: SURF_DEFAULT, mood: { stage: 0, storm: 0, blood: 0, bolt: null, nextBolt: 90, flashSky: 0 } };
  initChase(world.bg);
}

export function update(world) {
  const bg = world.bg, m = bg.mood;
  bg.scroll += bg.speed || 0;
  bg.t++;
  updateChase(world);
  const evs = Array.isArray(world.lastEvents) ? world.lastEvents : [];
  for (const e of evs) if (e && e.type === 'phaseChange' && typeof e.to === 'number') m.stage = e.to;
  const b = world.boss;
  if (world.scene === 'boss' && b && b.active && typeof b.phase === 'number') m.stage = Math.max(m.stage, b.phase);
  if (world.scene !== 'boss' && world.scene !== 'clear') m.stage = 0;
  const live = world.scene === 'boss' && !(b && b.defeated);
  m.storm += ((live && m.stage >= 3 ? 1 : 0) - m.storm) * 0.015;
  m.blood += ((live && m.stage >= 4 ? 1 : 0) - m.blood) * 0.015;
  m.flashSky *= 0.82;
  if (m.bolt && ++m.bolt.t > 10) m.bolt = null;
  if (m.blood > 0.3 || m.storm > 0.7) {
    if (--m.nextBolt <= 0) {
      const R = world.fxRng;
      m.nextBolt = m.blood > 0.3 ? R.int(70, 170) : R.int(200, 400);
      const pts = [];
      let x = R.range(40, W - 40), y = 0;
      const ground = (bg.surfaceY ?? SURF_DEFAULT) - R.range(0, 30);
      while (y < ground) { pts.push([x, y]); x += R.range(-9, 9); y += R.range(6, 14); }
      pts.push([x, ground]);
      const branch = pts.length > 3 ? { from: R.int(1, pts.length - 2), dx: R.sign() * R.range(10, 22), dy: R.range(10, 24) } : null;
      m.bolt = { t: 0, pts, branch };
      m.flashSky = 1;
    }
  }
}

function layer(img, f, s, dy = 0) {
  const off = mod(Math.floor(s * f), TW);
  bctx.drawImage(img, -off, dy);
  if (TW - off < BW) bctx.drawImage(img, TW - off, dy);
  return off;
}

const GULLS = [0, 1, 2, 3].map((i) => ({ x: 60 + i * 113, y: 26 + i * 11, v: 0.25 + i * 0.07, ph: i * 1.9 }));

export function drawBack(ctx, world) {
  if (drawPainted(ctx, world, drawVisualBack)) { extras(ctx, world); return; }
  const A = getGArt();
  ensure();
  const bg = world.bg, m = bg.mood, s = bg.scroll, t = bg.t;
  const sy = bg.surfaceY ?? SURF_DEFAULT;
  const dy = Math.round(sy - SURF_DEFAULT), hzY = sy + M;   // horizon row in buffer
  bctx.globalCompositeOperation = 'source-over';
  bctx.globalAlpha = 1;
  bctx.drawImage(A.sky.img, 0, -SKY_EXTRA / 2 + dy);

  // clouds (sky only), drifting
  layer(A.cloudsFar, PAR.cloudsFar, s + t * 0.4, M - 4 + Math.min(0, dy));
  layer(A.clouds, PAR.clouds, s + t * 0.6, M + 14 + Math.min(0, dy));
  if (m.storm > 0.02) {
    bctx.globalAlpha = Math.min(1, m.storm);
    layer(A.storm, 0.08, s + t * 1.4, M - 10);
    bctx.globalAlpha = 1;
  }
  // gulls
  for (const g of GULLS) {
    const x = mod(g.x - t * g.v - s * 0.05, W + 40) - 20 + M;
    const y = g.y + Math.sin(t * 0.03 + g.ph) * 4 + M;
    if (y < hzY - 20) bctx.drawImage(A.gull[((t >> 3) + g.ph * 3) & 1], Math.round(x), Math.round(y));
  }
  // lightning (P4 / storm)
  if (m.bolt) drawBolt(m.bolt);

  // distant rigs + refinery city on the horizon
  const offR = layer(A.rigs, PAR.rigs, s, dy);
  const offC = layer(A.city, PAR.city, s, dy);
  lights(A.lights.rigs, offR, t, dy, 1);
  lights(A.lights.city, offC, t, dy, 2);
  for (const f of A.lights.flares) {
    let x = f.x - offC; if (x < -8) x += TW; if (x > BW + 8) continue;
    const spr = A.flare[(t >> 2) % 3];
    bctx.drawImage(spr, x - 3, f.y + dy - 11);
  }

  // reflections below the horizon: mirrored, squashed city + sun glint
  bctx.save();
  bctx.beginPath(); bctx.rect(0, hzY, BW, BH - hzY); bctx.clip();
  bctx.globalAlpha = 0.24;
  bctx.translate(0, hzY * 1.5); bctx.scale(1, -0.5);
  layer(A.city, PAR.city, s, dy);
  bctx.restore();
  bctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 14; k++) {
    const yy = hzY + 2 + k * 3;
    const hw = 2 + k * 1.6 + Math.sin(t * 0.13 + k * 1.7) * 2;
    const jx = Math.sin(t * 0.09 + k * 2.3) * 3;
    bctx.fillStyle = `rgba(255,190,120,${(0.55 * (1 - k / 14)).toFixed(3)})`;
    bctx.fillRect(Math.round(SUN_X + M - hw + jx), yy, Math.round(hw * 2), 1);
  }
  // light reflections: short wobbling dashes under the city lights
  bctx.fillStyle = 'rgba(255,90,50,0.35)';
  for (const L of A.lights.city) {
    let x = L.x - offC; if (x < -4) x += TW; if (x > BW + 4) continue;
    const ry = hzY + Math.round((hzY - (L.y + dy)) * 0.5);
    if (ry > BH) continue;
    bctx.fillRect(Math.round(x - 1 + Math.sin(t * 0.2 + L.x) * 1.5), ry, 3, 1);
    bctx.fillRect(Math.round(x + Math.sin(t * 0.2 + L.x + 1) * 2), ry + 3, 2, 1);
  }
  bctx.globalCompositeOperation = 'source-over';

  layer(A.mud, PAR.mud, s);

  // moods + scene overlays
  if (m.storm > 0.01) {
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgb(${Math.round(255 - 110 * m.storm)},${Math.round(255 - 100 * m.storm)},${Math.round(255 - 70 * m.storm)})`;
    bctx.fillRect(0, 0, BW, BH);
  }
  if (m.blood > 0.01) {
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgb(255,${Math.round(255 - 195 * m.blood)},${Math.round(255 - 200 * m.blood)})`;
    bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = `rgba(150,10,0,${(0.3 * m.blood).toFixed(3)})`;
    bctx.fillRect(0, 0, BW, hzY);
  }
  if (m.flashSky > 0.05) {
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = `rgba(200,170,255,${(0.45 * m.flashSky).toFixed(3)})`;
    bctx.fillRect(0, 0, BW, hzY);
    if (m.bolt) drawBolt(m.bolt);
  }
  bctx.globalCompositeOperation = 'source-over';
  if (bg.darken > 0) { bctx.fillStyle = `rgba(0,0,10,${Math.min(1, bg.darken) * 0.7})`; bctx.fillRect(0, 0, BW, BH); }
  const tint = bg.tint;
  if (tint && typeof tint === 'object') { bctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${Math.max(0, Math.min(1, tint.a ?? 0.3))})`; bctx.fillRect(0, 0, BW, BH); }
  else if (tint > 0) { bctx.fillStyle = `rgba(160,0,20,${0.35 * Math.min(1, tint)})`; bctx.fillRect(0, 0, BW, BH); }

  // blit: air rows straight, underwater rows wobble
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const split = Math.max(0, Math.min(BH, Math.round(hzY) + 2));
  if (split > 0) ctx.drawImage(buf, 0, 0, BW, split, -M, -M, BW, split);
  const amp = 1 + m.blood * 1.5 + m.storm * 0.5;
  let y0 = split, d0 = rowOff(y0, t, amp);
  for (let y = split + 1; y <= BH; y++) {
    const d = y < BH ? rowOff(y, t, amp) : 1e9;
    if (d !== d0) { ctx.drawImage(buf, 0, y0, BW, y - y0, d0 - M, y0 - M, BW, y - y0); y0 = y; d0 = d; }
  }
  ctx.imageSmoothingEnabled = smooth;
  extras(ctx, world);
}

function rowOff(y, t, amp) {
  return Math.round(amp * (0.9 * Math.sin(y * 0.11 + t * 0.05) + 0.4 * Math.sin(y * 0.031 - t * 0.02)));
}

function lights(list, off, t, dy, size) {
  bctx.globalCompositeOperation = 'lighter';
  for (const L of list) {
    let x = L.x - off; if (x < -4) x += TW; if (x > BW + 4) continue;
    if (mod(t + L.ph, L.per) > L.per * 0.5) continue;
    bctx.fillStyle = 'rgba(255,80,50,0.45)';
    bctx.fillRect(x - size, L.y + dy - size, size * 2 + 1, size * 2 + 1);
    bctx.fillStyle = '#ffd0a0';
    bctx.fillRect(x, L.y + dy, 1, 1);
  }
  bctx.globalCompositeOperation = 'source-over';
}

function drawBolt(b) {
  const a = 1 - b.t / 11;
  bctx.globalCompositeOperation = 'lighter';
  for (const [w, col] of [[3, `rgba(170,120,255,${(0.35 * a).toFixed(3)})`], [1, `rgba(255,245,255,${a.toFixed(3)})`]]) {
    bctx.strokeStyle = col; bctx.lineWidth = w;
    bctx.beginPath();
    b.pts.forEach(([x, y], i) => (i ? bctx.lineTo(x + M + 0.5, y + M + 0.5) : bctx.moveTo(x + M + 0.5, y + M + 0.5)));
    if (b.branch) { const [bx, by] = b.pts[b.branch.from]; bctx.moveTo(bx + M + 0.5, by + M + 0.5); bctx.lineTo(bx + b.branch.dx + M, by + b.branch.dy + M); }
    bctx.stroke();
  }
  bctx.globalCompositeOperation = 'source-over';
}

// ----------------------------------------------------------------- mid
export function drawMid(ctx, world) {
  const A = getGArt();
  const bg = world.bg, m = bg.mood, s = bg.scroll, t = bg.t;
  const sy = Math.round(bg.surfaceY ?? SURF_DEFAULT);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // underwater tint over everything drawn so far below the surface (boss included)
  // world.bg.underTint (0..1, default 1) lets the boss thin it further while it shows submerged threats
  const ut = bg.underTint == null ? 1 : Math.max(0, Math.min(1, bg.underTint));
  if (sy < H && ut > 0) { ctx.globalAlpha = ut; ctx.drawImage(A.under, 0, 0, W, H - sy, 0, sy, W, H - sy); ctx.globalAlpha = 1; }
  // surface line: calm = straight strip; storm / tidal surge = rolling swell
  // (strip drawn in 16-px column slices, each lifted by a slow sine).
  const sc = 1 + m.storm * 0.6 + m.blood * 1.2;
  const swell = m.storm * 3 + m.blood * 7;
  const fr = A.surface[(t >> 2) % GS_FR];
  const ox = mod(Math.floor(s * 0.9 + t * 0.35 + (bg.chaseX || 0)), GS_W);
  if (swell < 0.5) {
    for (let x = -ox; x < W; x += GS_W) ctx.drawImage(fr, x, sy - 5);
  } else {
    for (let x = 0; x < W; x += 16) {
      const lift = Math.round(swell * Math.sin(x * 0.028 - t * 0.07) + swell * 0.4 * Math.sin(x * 0.07 + t * 0.11));
      const sx = mod(x + ox, GS_W), w = Math.min(16, GS_W - sx);
      ctx.drawImage(fr, sx, 0, w, fr.height, x, sy - 5 + lift, w, fr.height);
      if (w < 16) ctx.drawImage(fr, 0, 0, 16 - w, fr.height, x + w, sy - 5 + lift, 16 - w, fr.height);
      if (lift < 0) { ctx.fillStyle = 'rgba(16,26,70,0.5)'; ctx.fillRect(x, sy - 5 + lift + 7, 16, -lift); }   // swell body
    }
  }
  drawChaseMid(ctx, world);
  // exposed mudflat (first half): in front of the boss's lower body / the
  // underwater tint, still behind the player and bullets
  drawMudflat(ctx, world);
  drawMounds(ctx, world);
  // spray specks hopping off the surface
  ctx.fillStyle = 'rgba(255,225,200,0.8)';
  const nSpray = 10 + Math.round(20 * (m.storm + m.blood));
  for (let i = 0; i < nSpray; i++) {
    const ph = (t * (0.9 + (i % 5) * 0.13) + i * 37) % 60;
    if (ph > 24) continue;
    const x = mod(i * 97 + Math.floor(i / 3) * 31 - s * 0.9, W);
    const y = sy - 1 - Math.sin((ph / 24) * Math.PI) * (3 + (i % 4) * 2) * sc;
    ctx.fillRect(Math.round(x + ph * 0.3), Math.round(y), 1, 1);
  }
  // rain (storm)
  if (m.storm > 0.05) {
    ctx.fillStyle = `rgba(190,200,230,${(0.35 * m.storm).toFixed(3)})`;
    const n = Math.round(80 * m.storm);
    for (let i = 0; i < n; i++) {
      const x = mod(i * 53.7 - t * 2.2, W + 20) - 10, y = mod(i * 29.3 + t * 6.5, H);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 3);
      ctx.fillRect(Math.round(x) - 1, Math.round(y) + 3, 1, 2);
    }
  }
  ctx.imageSmoothingEnabled = smooth;
}

// --------------------------------------------------------------- front
const FRONT_PERIOD = 1500;
const FRONT = [{ x: -10, r: 'rock' }, { x: 520, r: 'rock2' }, { x: 900, r: 'rock' }, { x: 1250, r: 'rock2' }];
export function drawFront(ctx, world) {
  const A = getGArt();
  const { scroll: s } = world.bg;
  const fade = 1 - Math.min(1, Math.max(0, +world.bg.chase || 0));
  if (fade <= 0.01) return;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const base = mod(Math.floor(s * PAR.front + (world.bg.chaseX || 0) * 1.6), FRONT_PERIOD);
  ctx.globalAlpha = fade;
  for (const g of FRONT) {
    const gx = mod(g.x - base + 160, FRONT_PERIOD) - 160;
    if (gx < -160 || gx > W + 20) continue;
    const r = A[g.r];
    ctx.drawImage(r, Math.round(gx), H - r.height + 2);
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = smooth;
}

// Hybrid-stage layers over the backdrop (playfield coords, behind the boss):
// chase water + horizon pier + sun glow, surge waves, pylons. (The mudflat is
// drawn in drawMid.)
function extras(ctx, world) {
  const A = getGArt();
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  drawChaseWater(ctx, world, A.rigs, A.HZ);
  drawSurge(ctx, world);
  drawPylons(ctx, world);
  gradeSurge(ctx, world);
  ctx.imageSmoothingEnabled = smooth;
}
