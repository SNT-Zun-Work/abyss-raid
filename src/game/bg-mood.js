
import { W, H } from '../config.js';
import { pixelSprite, bayer, hash } from './bg-noise.js';
import { M, BW, TW } from './bg-art.js';
import { chunkSprites } from './fx-art.js';

const MAXP = 140;
const mod = (a, n) => ((a % n) + n) % n;

let SPR = null;
function sprites() {
  if (SPR) return SPR;
  const blob = (r, col, a) => pixelSprite(r * 2 + 1, r * 2 + 1, (x, y) => {
    const d = Math.hypot(x - r, y - r) / (r + 0.5);
    if (d >= 1) return null;
    const q = (1 - d) * 1.6;
    return q > bayer(x, y) ? [...col, a] : null;
  });
  const glow = (r) => pixelSprite(r * 2 + 1, r * 2 + 1, (x, y) => {
    const d = Math.hypot(x - r, y - r) / (r + 0.5);
    if (d >= 1) return null;
    const q = Math.round((1 - d) ** 1.8 * 5) / 5;
    return q > 0 ? [255, 40, 30, Math.round(q * 170)] : null;
  });
  SPR = {
    dust: [blob(4, [70, 96, 112], 150), blob(7, [62, 86, 102], 130), blob(10, [56, 78, 94], 110)],
    alarm: glow(9),
    alarmS: glow(5),
    rocks: chunkSprites('#3a4c5a'),
  };
  return SPR;
}

// ceiling crack polylines in ceiling-tile coordinates (deterministic)
const CRACKS = [];
for (let i = 0; i < 7; i++) {
  const pts = [];
  let x = hash(i, 1, 91) * TW, y = M + 4 + hash(i, 2, 91) * 6;
  pts.push([x, y]);
  const n = 5 + Math.floor(hash(i, 3, 91) * 4);
  for (let k = 0; k < n; k++) { x += (hash(i, 10 + k, 91) - 0.5) * 14; y += 2 + hash(i, 30 + k, 91) * 5; pts.push([x, y]); }
  CRACKS.push(pts);
}

export function initMood(bg) {
  bg.mood = { stage: 0, em: 0, col: 0, parts: [], streams: [], nextCollapse: 240, nextRock: 30, flick: 1 };
}

function spawn(m, p) { if (m.parts.length < MAXP) m.parts.push(p); }

function collapse(world, m, far) {
  const R = world.fxRng;
  const x = R.range(30, W - 30) + M, y = R.range(120, 175) + M;
  for (let i = 0; i < 7; i++) spawn(m, { k: 'dust', far, x: x + R.range(-10, 10), y: y + R.range(-6, 6), vx: R.range(-0.15, 0.15), vy: R.range(-0.25, -0.05), t: 0, d: i * 4, life: R.int(90, 160), s: R.int(0, 2) });
  for (let i = 0; i < 6; i++) spawn(m, { k: 'chunk', far, x: x + R.range(-8, 8), y: y - R.range(10, 40), vx: R.range(-0.3, 0.3), vy: R.range(0, 0.4), t: 0, d: R.int(0, 20), life: 200, s: R.int(0, 3) });
}

export function updateMood(world) {
  const bg = world.bg;
  const m = bg.mood;
  if (!m) return;
  const evs = Array.isArray(world.lastEvents) ? world.lastEvents : [];
  for (const e of evs) if (e && e.type === 'phaseChange' && typeof e.to === 'number') m.stage = e.to;
  const b = world.boss;
  if (world.scene === 'boss' && b && b.active && typeof b.phase === 'number') m.stage = Math.max(m.stage, b.phase);
  const live = world.scene === 'boss' && !(b && b.defeated);
  if (world.scene !== 'boss' && world.scene !== 'clear') m.stage = 0;
  const emT = live && m.stage >= 3 ? 1 : 0, colT = m.stage >= 4 && world.scene === 'boss' ? 1 : 0;
  m.em += (emT - m.em) * 0.02;
  m.col += (colT - m.col) * 0.015;
  if (m.em < 0.002) m.em = emT ? m.em : 0;
  const R = world.fxRng;
  // distant collapses
  if (m.em > 0.5 || m.col > 0.3) {
    if (--m.nextCollapse <= 0) { collapse(world, m, true); m.nextCollapse = m.col > 0.5 ? R.int(90, 170) : R.int(220, 420); }
  }
  // P4: rocks + dust streams from the ceiling, flickering crack light
  if (m.col > 0.2) {
    if (--m.nextRock <= 0) {
      m.nextRock = R.int(8, 26);
      spawn(m, { k: 'rock', far: false, x: R.range(0, BW), y: M + R.range(4, 16), vx: R.range(-0.2, 0.2), vy: R.range(0.2, 0.8), t: 0, d: 0, life: 300, s: R.int(0, 3) });
    }
    if (m.streams.length < 4 && R.next() < 0.012) m.streams.push({ x: R.range(10, BW - 10), t: 0, life: R.int(140, 260), w: R.int(2, 5) });
    m.flick = 0.65 + 0.35 * Math.sin(bg.t * 0.21) * Math.sin(bg.t * 0.057 + 1);
  }
  for (let i = m.streams.length - 1; i >= 0; i--) { const s = m.streams[i]; if (++s.t >= s.life) m.streams.splice(i, 1); }
  for (let i = m.parts.length - 1; i >= 0; i--) {
    const p = m.parts[i];
    if (p.d > 0) { p.d--; continue; }
    p.t++;
    if (p.k === 'dust') { p.x += p.vx; p.y += p.vy; p.vy *= 0.99; }
    else { p.vy = Math.min(p.k === 'rock' ? 2.6 : 1.2, p.vy + (p.k === 'rock' ? 0.05 : 0.03)); p.x += p.vx; p.y += p.vy; }
    if (p.t >= p.life || p.y > H + M + 20) { m.parts[i] = m.parts[m.parts.length - 1]; m.parts.pop(); }
  }
}

// emergency: are lights forced on, and how bright (0..1)
export function lightPulse(m, t, x) {
  return m.em * (0.55 + 0.45 * Math.sin(t * 0.13 + x * 0.03));
}

export function drawAlarm(bctx, m, list, off, t) {
  if (m.em < 0.05) return;
  const S = sprites();
  bctx.globalCompositeOperation = 'lighter';
  for (const L of list) {
    const big = L.big;
    let x = L.x - off;
    if (x < -10) x += TW;
    if (x > BW + 10) continue;
    bctx.globalAlpha = Math.max(0, lightPulse(m, t, L.x));
    const g = big ? S.alarm : S.alarmS;
    bctx.drawImage(g, x - (g.width >> 1), L.y - (g.height >> 1));
  }
  bctx.globalAlpha = 1;
  bctx.globalCompositeOperation = 'source-over';
}

// far plane: distant collapse dust + debris (drawn after the far layer)
export function drawFar(bctx, m) {
  if (!m.parts.length) return;
  const S = sprites();
  for (const p of m.parts) {
    if (!p.far || p.d > 0) continue;
    if (p.k === 'dust') {
      const q = p.t / p.life, spr = S.dust[Math.min(2, p.s + (q > 0.5 ? 1 : 0))];
      bctx.globalAlpha = 0.8 * (1 - q);
      const sc = p.s > 1 ? 2 : 1;
    bctx.drawImage(spr, Math.round(p.x - spr.width * sc / 2), Math.round(p.y - spr.height * sc / 2), spr.width * sc, spr.height * sc);
    } else {
      bctx.globalAlpha = 1;
      bctx.fillStyle = '#0d2232';
      bctx.fillRect(Math.round(p.x), Math.round(p.y), p.s > 1 ? 2 : 1, p.s > 1 ? 2 : 1);
    }
  }
  bctx.globalAlpha = 1;
}

// near plane: falling rocks + dust streams + ceiling cracks (after ceiling)
export function drawNear(bctx, m, offCeil, t) {
  if (m.col < 0.02 && !m.parts.length) return;
  const S = sprites();
  // ceiling cracks leaking light
  if (m.col > 0.05) {
    bctx.globalCompositeOperation = 'lighter';
    const a = m.col * m.flick;
    for (let c = 0; c < CRACKS.length; c++) {
      const pts = CRACKS[c];
      let ox = -offCeil;
      if (pts[0][0] + ox < -20) ox += TW;
      if (pts[0][0] + ox > BW + 20) continue;
      const shown = Math.max(1, Math.round((pts.length - 1) * Math.min(1, m.col * 1.4)));
      bctx.strokeStyle = `rgba(190,235,255,${(0.75 * a).toFixed(3)})`;
      bctx.lineWidth = 1;
      bctx.beginPath();
      bctx.moveTo(Math.round(pts[0][0] + ox) + 0.5, Math.round(pts[0][1]) + 0.5);
      for (let k = 1; k <= shown; k++) bctx.lineTo(Math.round(pts[k][0] + ox) + 0.5, Math.round(pts[k][1]) + 0.5);
      bctx.stroke();
      // faint light spill beneath the crack
      const tip = pts[shown];
      bctx.fillStyle = `rgba(120,200,235,${(0.12 * a).toFixed(3)})`;
      for (let k = 0; k < 4; k++) bctx.fillRect(Math.round(tip[0] + ox) - 6 + k * 2, Math.round(tip[1]) + 2 + k * 6, 12 - k * 4 + 2, 6);
    }
    bctx.globalCompositeOperation = 'source-over';
  }
  // dust streams pouring from the ceiling
  for (const s of m.streams) {
    const fade = Math.min(1, s.t / 30, (s.life - s.t) / 40);
    bctx.fillStyle = `rgba(170,170,180,${(0.7 * fade).toFixed(3)})`;
    for (let k = 0; k < 40; k++) {
      const yy = M + 10 + mod(t * 1.6 + k * 6.1, H);
      const xx = s.x + Math.sin(k * 1.7 + t * 0.05) * s.w;
      bctx.fillRect(Math.round(xx), Math.round(yy), k % 3 ? 1 : 2, 3);
    }
  }
  for (const p of m.parts) {
    if (p.far || p.d > 0) continue;
    const spr = S.rocks[p.s];
    const sc = p.s > 1 ? 2 : 1;
    bctx.drawImage(spr, Math.round(p.x - spr.width * sc / 2), Math.round(p.y - spr.height * sc / 2), spr.width * sc, spr.height * sc);
  }
}

// colour grades (applied to the whole back buffer)
export function gradeMood(bctx, m, t) {
  if (m.em > 0.01) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.13);
    bctx.globalCompositeOperation = 'lighter';
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgb(255,${Math.round(255 - 70 * m.em)},${Math.round(255 - 60 * m.em)})`;
    bctx.fillRect(0, 0, BW, H + 2 * M);
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = `rgba(150,0,12,${(m.em * (0.06 + 0.16 * pulse)).toFixed(3)})`;
    bctx.fillRect(0, 0, BW, H + 2 * M);
  }
  if (m.col > 0.01) {
    const k = m.col;
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgb(255,${Math.round(255 - 120 * k)},${Math.round(255 - 50 * k)})`;
    bctx.fillRect(0, 0, BW, H + 2 * M);
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = `rgba(70,0,50,${(0.22 * k).toFixed(3)})`;
    bctx.fillRect(0, 0, BW, H + 2 * M);
  }
  bctx.globalCompositeOperation = 'source-over';
}

export function rasterAmp(m) { return 1 + 1.8 * m.col; }
