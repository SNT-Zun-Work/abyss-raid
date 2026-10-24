import { drawSpray } from './boss-skipper-art.js';
import { paintedCell, paintedSurface } from './g-painted-fx.js';
import { W, H } from '../config.js';
import { swapRemove } from '../core/util.js';
import { getFxArt, chunkSprites, digitSprite, getMudArt } from './fx-art.js';

const MAX = 900;          // hard cap on live particles
const SOFT = 760;         // cosmetic extras (smoke/bubbles/debris) stop spawning here
const SURFACE_Y = 10;     // bubbles pop here
const MAX_BUBBLES = 70;   // keep bubbles from cluttering big death sequences

const K_FIRE = 0, K_SMOKE = 1, K_SPARK = 2, K_FLASH = 3, K_DEBRIS = 4, K_BUBBLE = 5, K_POPUP = 6, K_RING = 7, K_GLOW = 8;
const K_DROP = 9, K_FOAM = 10, K_MUD = 11, K_GEYSER = 12, K_SPLAT = 13;   // zone G water / mud FX
const ESSENTIAL = new Set([K_FIRE, K_FLASH, K_POPUP, K_RING, K_GLOW]);

export function init(world) {
  getFxArt();
  world.fxState = { parts: [], spare: [], popCache: new Map(), nBub: 0, hazes: [], rumble: null };
  if (world.zone && world.zone !== 'V') getMudArt();
}

function spawn(world, k, x, y) {
  const st = world.fxState;
  const n = st.parts.length;
  if (n >= MAX || (n >= SOFT && !ESSENTIAL.has(k))) return null;
  if (k === K_BUBBLE && st.nBub >= MAX_BUBBLES) return null;
  if (k === K_BUBBLE) st.nBub++;
  const p = st.spare.pop() || {};
  p.k = k; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.life = 30; p.d = 0;
  p.s = 0; p.sc = 1; p.a = 0; p.va = 0; p.spr = null; p.fd = 2; p.r0 = 0; p.r1 = 0; p.ph = 0; p.v = 0; p.fl = 0;
  st.parts.push(p);
  return p;
}

// ------------------------------------------------------------ explosions
const CFG = {
  small: { main: 0, sc: 1, fd: 2, sec: 0, secR: 0, secDelay: 0, sparks: 4, smoke: 1, debris: 0, bubbles: 2, flash: 0, shake: 0, rings: 0 },
  medium: { main: 1, sc: 1, fd: 2, sec: 2, secR: 10, secDelay: 8, sparks: 8, smoke: 3, debris: 2, bubbles: 3, flash: 1, shake: 1.5, rings: 0 },
  large: { main: 2, sc: 1, fd: 3, sec: 4, secR: 22, secDelay: 14, sparks: 14, smoke: 6, debris: 5, bubbles: 5, flash: 2, shake: 4, rings: 1 },
  huge: { main: 3, sc: 1, fd: 4, sec: 12, secR: 56, secDelay: 40, sparks: 34, smoke: 16, debris: 12, bubbles: 14, flash: 2, shake: 10, rings: 2 },
};

function fire(world, x, y, idx, sc, fd, delay) {
  const A = getFxArt();
  const p = spawn(world, K_FIRE, x, y);
  if (!p) return null;
  const R = world.fxRng;
  const vars = A.fire[idx];
  p.s = idx; p.sc = sc; p.fd = fd; p.d = delay;
  p.v = R.int(0, vars.length - 1);                 // round / lobed / elongated
  p.fl = R.int(0, 3);                              // bit0 = flip x, bit1 = flip y
  p.a = vars[p.v].SH !== vars[p.v].SW ? Math.round(R.range(-0.6, 0.6) / (Math.PI / 8)) * (Math.PI / 8) : 0;
  p.life = vars[p.v].frames * fd;
  p.vy = -0.12; p.vx = 0;
  return p;
}

// opts.debris: CSS colour | array of colours | canvas sprite | false (no debris).
// Omitted → default gunmetal chunks.
export function explode(world, x, y, size = 'small', opts) {
  const c = CFG[size] || CFG.small;
  const R = world.fxRng;
  const A = getFxArt();
  const main = fire(world, x, y, c.main, c.sc, c.fd, 0);
  const mainLife = main ? main.life : 20;
  if (c.flash) { const f = spawn(world, K_FLASH, x, y); if (f) { f.s = c.flash; f.life = 6; } }
  else { const f = spawn(world, K_FLASH, x, y); if (f) { f.s = 0; f.life = 4; } }
  for (let i = 0; i < c.sec; i++) {
    const a = R.range(0, Math.PI * 2), d = R.range(0.35, 1) * c.secR;
    const idx = size === 'huge' ? (R.next() < 0.5 ? 2 : 1) : size === 'large' ? (R.next() < 0.5 ? 1 : 0) : 0;
    const delay = Math.round(R.range(2, c.secDelay));
    fire(world, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, idx, 1, idx === 2 ? 3 : 2, delay);
    if (size === 'huge' && R.next() < 0.5) {
      const f = spawn(world, K_FLASH, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8);
      if (f) { f.s = 1; f.life = 6; f.d = delay; }
    }
  }
  for (let i = 0; i < c.sparks; i++) {
    const a = R.range(0, Math.PI * 2), sp = R.range(1.2, size === 'huge' ? 6 : 3.8);
    const p = spawn(world, K_SPARK, x, y);
    if (!p) break;
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.life = R.int(10, size === 'huge' ? 30 : 18);
    p.d = size === 'huge' ? R.int(0, 24) : 0;
  }
  for (let i = 0; i < c.smoke; i++) {
    const a = R.range(0, Math.PI * 2), d = R.range(0, c.secR * 0.8 + 4);
    const p = spawn(world, K_SMOKE, x + Math.cos(a) * d, y + Math.sin(a) * d);
    if (!p) break;
    p.d = Math.round(mainLife * R.range(0.35, 0.8)) + (size === 'huge' ? R.int(0, 40) : 0);
    p.vx = R.range(-0.25, 0.25); p.vy = R.range(-0.5, -0.2);
    p.life = R.int(36, 60); p.sc = size === 'huge' && R.next() < 0.6 ? 2 : 1;
  }
  const dOpt = opts && opts.debris !== undefined ? opts.debris : null;
  const nDebris = dOpt === false ? 0 : c.debris;
  for (let i = 0; i < nDebris; i++) {
    const a = R.range(-Math.PI, 0), sp = R.range(0.8, size === 'huge' ? 3.2 : 2.2);
    const col = dOpt == null ? (R.next() < 0.5 ? '#6e7a8c' : '#4e5868')
      : Array.isArray(dOpt) ? dOpt[R.int(0, dOpt.length - 1)] : dOpt;
    debris(world, x + Math.cos(a) * 4, y + Math.sin(a) * 4, Math.cos(a) * sp, Math.sin(a) * sp, col);
  }
  for (let i = 0; i < c.bubbles; i++) {
    const p = spawn(world, K_BUBBLE, x + R.range(-1, 1) * (c.secR + 6), y + R.range(-1, 1) * (c.secR * 0.7 + 6));
    if (!p) break;
    p.d = Math.round(mainLife * 0.5 + R.range(0, 30) + (size === 'huge' ? R.range(0, 50) : 0));
    p.s = R.next() < 0.55 ? 0 : R.next() < 0.7 ? 1 : 2;
    p.vx = R.range(-0.2, 0.2); p.vy = R.range(-0.4, -0.1); p.life = R.int(70, 150); p.ph = R.range(0, 6.28);
  }
  for (let i = 0; i < c.rings; i++) {
    const p = spawn(world, K_RING, x, y);
    if (!p) break;
    p.d = i * 8; p.r0 = 6; p.r1 = size === 'huge' ? 150 - i * 40 : 34; p.life = size === 'huge' ? 34 : 18;
  }
  if (size === 'huge') {
    const g = spawn(world, K_GLOW, x, y);
    if (g) { g.life = 30; g.sc = 1; }
    world.flash = Math.max(world.flash || 0, 0.9);
  }
  if (c.shake) addShake(world, c.shake);
  void A;
}

// ----------------------------------------------------------------- spark
export function spark(world, x, y, angle = Math.PI) {
  const R = world.fxRng;
  const n = R.int(3, 5);
  for (let i = 0; i < n; i++) {
    const p = spawn(world, K_SPARK, x, y);
    if (!p) break;
    const a = angle + R.range(-0.75, 0.75), sp = R.range(1.4, 3.4);
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.life = R.int(5, 10); p.s = 1;
  }
  const f = spawn(world, K_FLASH, x, y);
  if (f) { f.s = 0; f.life = 3; }
}

export function addShake(world, px) {
  world.shake = Math.min(10, (world.shake || 0) + px);
}

// ---------------------------------------------------------------- debris
export function debris(world, x, y, vx = 0, vy = 0, spriteOrColor = '#5a6474') {
  const R = world.fxRng;
  const p = spawn(world, K_DEBRIS, x, y);
  if (!p) return;
  p.spr = spriteOrColor && typeof spriteOrColor === 'object' && spriteOrColor.width
    ? spriteOrColor
    : chunkSprites(typeof spriteOrColor === 'string' ? spriteOrColor : '#5a6474')[R.int(0, 3)];
  p.vx = vx; p.vy = vy; p.va = R.range(-0.18, 0.18); p.a = R.range(0, 6.28);
  p.life = 900; p.ph = R.int(0, 9);
}

// ----------------------------------------------------------- score popup
export function scorePopup(world, x, y, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const scheme = v >= 10000 ? 1 : 0, scale = v >= 100000 ? 2 : 1;
  const key = `${v}|${scheme}|${scale}`;
  const cache = world.fxState.popCache;
  let spr = cache.get(key);
  if (!spr) {
    if (cache.size > 64) cache.clear();
    spr = digitSprite(String(v), scheme, scale);
    cache.set(key, spr);
  }
  const p = spawn(world, K_POPUP, x, y);
  if (!p) return;
  p.spr = spr; p.life = scale > 1 ? 90 : 50; p.vy = -0.7;
}

// ---------------------------------------------------------- bubble trail
export function bubbleTrail(world, x, y) {
  const R = world.fxRng;
  const p = spawn(world, K_BUBBLE, x + R.range(-1, 1), y + R.range(-1.5, 1.5));
  if (!p) return;
  p.s = R.next() < 0.8 ? 0 : 1;
  p.vx = R.range(-1.1, -0.5); p.vy = R.range(-0.3, 0.1); p.life = R.int(28, 48); p.ph = R.range(0, 6.28);
}

// ---------------------------------------------------------------- update
export function update(world) {
  world.shake *= 0.88;
  const st0 = world.fxState;
  if (st0.rumble) {
    const r = st0.rumble;
    r.t++;
    world.shake = Math.max(world.shake, Math.min(10, r.px * (0.5 + 0.5 * (1 - r.t / r.frames))));
    if (r.t >= r.frames) st0.rumble = null;
  }
  for (let i = st0.hazes.length - 1; i >= 0; i--) if (++st0.hazes[i].t >= st0.hazes[i].life) st0.hazes.splice(i, 1);
  if (world.shake < 0.05) world.shake = 0;
  world.flash = Math.max(0, world.flash - 0.08);
  const st = world.fxState;
  const P = st.parts;
  const bgc = world.bg;
  const drift = bgc && bgc.chase > 0 && bgc.chaseSpeed ? bgc.chaseSpeed * Math.min(1, bgc.chase) * 0.9 : 0;
  if (st.mounds && st.mounds.length) updateMounds(world, st);
  if (st.wipe && ++st.wipe.t >= st.wipe.life) st.wipe = null;
  else if (st.wipe) updateWipe(st.wipe);
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    if (p.d > 0) { p.d--; continue; }
    p.t++;
    switch (p.k) {
      case K_FIRE: p.y += p.vy; break;
      case K_SMOKE: p.x += p.vx; p.y += p.vy; p.vy *= 0.985; break;
      case K_SPARK: p.x += p.vx; p.y += p.vy; p.vx *= 0.88; p.vy = p.vy * 0.88 + 0.03; break;
      case K_DEBRIS:
        if (p.r1 === 1) { // dried mud flake in air: falls, plops into the sea in zone G
          p.vy = Math.min(3, p.vy + 0.1); p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
          if (world.zone !== 'V' && p.vy > 0 && p.r0 === 1 && p.y > surfaceY(world)) {
            const f = spawn(world, K_FOAM, p.x, surfaceY(world)); if (f) { f.r0 = 1; f.r1 = 6; f.life = 16; }
            p.t = p.life;
          }
          if (p.y > H + 20 || p.x < -40 || p.x > W + 40) p.t = p.life;
          break;
        }
        p.x += p.vx; p.y += p.vy; p.a += p.va;
        p.vx *= 0.985; p.vy = Math.min(1.4, p.vy * 0.99 + 0.035);
        if ((p.t + p.ph) % 26 === 0 && P.length < SOFT) {
          const b = spawn(world, K_BUBBLE, p.x, p.y);
          if (b) { b.s = 0; b.vx = 0; b.vy = -0.2; b.life = 50; b.ph = p.t; }
        }
        if (p.y > H + 20 || p.x < -40 || p.x > W + 40) p.t = p.life;
        break;
      case K_BUBBLE:
        p.vy = Math.max(-(0.55 + p.s * 0.22), p.vy - 0.012);
        p.vx *= 0.94;
        p.x += p.vx + Math.sin(p.t * 0.15 + p.ph) * 0.22; p.y += p.vy;
        if (p.y < surfaceTop(world)) p.t = p.life;
        break;
      case K_POPUP: p.y += p.vy; p.vy *= 0.95; break;
      case K_DROP:
        p.vy += 0.14; p.vx *= 0.99; p.x += p.vx; p.y += p.vy;
        if ((p.s === 0 || p.r0 === 1) && p.vy > 0 && p.y > surfaceY(world) + 1) p.t = p.life;   // fell back into the sea
        if (p.y > H + 8) p.t = p.life;
        break;
      case K_MUD: p.x += p.vx; p.y += p.vy; p.vy = p.vy * 0.97 + 0.01; break;
      case K_SPLAT: if (p.t > 26) { p.vy += 0.05; p.y += p.vy; } break;
      default: break;
    }
    if (drift && (p.k === K_DROP || p.k === K_FOAM || p.k === K_MUD || p.k === K_GEYSER || (p.k === K_DEBRIS && p.r1 === 1))) p.x -= drift;
    if (p.t >= p.life) { if (p.k === K_BUBBLE) st.nBub--; st.spare.push(p); swapRemove(P, i); }
  }
}

// ------------------------------------------------------------------ draw
const SPARK_COL = ['#ff6a1c', '#ffd040', '#ffffff'];
const METAL_COL = ['#8aa0c0', '#e8f4ff', '#ffffff'];

export function drawUnder(ctx, world) {
  const A = getFxArt();
  const P = world.fxState.parts;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // smoke
  const sm = A.smoke;
  for (const p of P) {
    if (p.k !== K_SMOKE || p.d > 0) continue;
    const f = Math.min(sm.frames - 1, ((p.t / p.life) * sm.frames) | 0);
    const sz = sm.S * p.sc;
    ctx.drawImage(sm.sheet, f * sm.S, 0, sm.S, sm.S, Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
  }
  // debris (behind fireballs so chunks emerge from the blast)
  for (const p of P) {
    if (p.k !== K_DEBRIS || p.d > 0) continue;
    const s = p.spr;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.rotate(Math.round(p.a / (Math.PI / 8)) * (Math.PI / 8));
    ctx.drawImage(s, -(s.width >> 1), -(s.height >> 1));
    ctx.restore();
  }
  // fireballs (variant sheet + random flip / tilt so chains never repeat one shape)
  for (const p of P) {
    if (p.k !== K_FIRE || p.d > 0) continue;
    const sh = A.fire[p.s][p.v];
    const f = Math.min(sh.frames - 1, (p.t / p.fd) | 0);
    const w = sh.SW * p.sc, h = sh.SH * p.sc;
    if (!p.fl && !p.a) {
      ctx.drawImage(sh.sheet, f * sh.SW, 0, sh.SW, sh.SH, Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
    } else {
      ctx.save();
      ctx.translate(Math.round(p.x), Math.round(p.y));
      if (p.a) ctx.rotate(p.a);
      ctx.scale(p.fl & 1 ? -1 : 1, p.fl & 2 ? -1 : 1);
      ctx.drawImage(sh.sheet, f * sh.SW, 0, sh.SW, sh.SH, -Math.round(w / 2), -Math.round(h / 2), w, h);
      ctx.restore();
    }
  }
  // bubbles
  for (const p of P) {
    if (p.k !== K_BUBBLE || p.d > 0) continue;
    const b = A.bubbles[p.s];
    ctx.drawImage(b, Math.round(p.x - (b.width >> 1)), Math.round(p.y - (b.height >> 1)));
  }
  drawMudPuffs(ctx, world);
  drawHazes(ctx, world);
  ctx.imageSmoothingEnabled = smooth;
}

export function drawOver(ctx, world) {
  const A = getFxArt();
  const P = world.fxState.parts;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const op = ctx.globalCompositeOperation;
  // additive glow + rings
  ctx.globalCompositeOperation = 'lighter';
  for (const p of P) {
    if (p.d > 0) continue;
    if (p.k === K_GLOW) {
      const q = p.t / p.life, g = A.glow;
      const sz = g.width * (1.2 + q * 1.6);
      ctx.globalAlpha = 1 - q;
      ctx.drawImage(g, Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
    } else if (p.k === K_RING) {
      const q = p.t / p.life, e = 1 - (1 - q) ** 3;
      const r = p.r0 + (p.r1 - p.r0) * e;
      ctx.globalAlpha = (1 - q) * 0.85;
      ctx.strokeStyle = '#bfefff';
      ctx.lineWidth = Math.max(1, 4 * (1 - q));
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.86, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd070';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 0.8, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = op;
  // flash stars
  for (const p of P) {
    if (p.k !== K_FLASH || p.d > 0) continue;
    const fr = A.flash[p.s];
    const s = fr[Math.min(2, ((p.t / p.life) * 3) | 0)];
    ctx.drawImage(s, Math.round(p.x - s.width / 2), Math.round(p.y - s.height / 2));
  }
  // sparks: 2-3 px streaks along velocity
  for (const p of P) {
    if (p.k !== K_SPARK || p.d > 0) continue;
    const q = 1 - p.t / p.life;
    ctx.fillStyle = (p.s === 1 ? METAL_COL : SPARK_COL)[q > 0.6 ? 2 : q > 0.3 ? 1 : 0];
    const x = Math.round(p.x), y = Math.round(p.y);
    ctx.fillRect(x, y, 1, 1);
    const sp = Math.abs(p.vx) + Math.abs(p.vy);
    if (sp > 0.6) {
      ctx.fillRect(Math.round(p.x - p.vx * 0.6), Math.round(p.y - p.vy * 0.6), 1, 1);
      if (sp > 1.8) ctx.fillRect(Math.round(p.x - p.vx * 1.2), Math.round(p.y - p.vy * 1.2), 1, 1);
    }
  }
  // score popups (blink before vanishing)
  for (const p of P) {
    if (p.k !== K_POPUP || p.d > 0) continue;
    if (p.life - p.t < 14 && ((p.t >> 1) & 1)) continue;
    const s = p.spr;
    ctx.drawImage(s, Math.round(p.x - s.width / 2), Math.round(p.y - s.height / 2));
  }
  drawWater(ctx, world);
  if (world.fxState.wipe) drawWipe(ctx, world.fxState.wipe);
  ctx.imageSmoothingEnabled = smooth;
}

// -------------------------------------------------------- heat haze / rumble
export function heatHaze(world, x, y, w, h, frames = 30) {
  const st = world.fxState;
  if (!st || st.hazes.length >= 6) return;
  st.hazes.push({ x, y, w, h, t: 0, life: Math.max(1, frames | 0), ph: world.fxRng.range(0, 6.28) });
}

export function screenRumble(world, frames = 30, px = 3) {
  const st = world.fxState;
  if (!st) return;
  const r = st.rumble;
  if (r && r.px * (1 - r.t / r.frames) > px) return; // keep the stronger rumble
  st.rumble = { t: 0, frames: Math.max(1, frames | 0), px: Math.min(10, px) };
}

// Re-blits horizontal 2-px strips of what is already drawn (bg + boss) with a
// sine x-offset: a cheap raster heat shimmer. Runs in drawUnder, so player
// and bullets are never displaced. ~h/2 drawImage calls per band at most.
function drawHazes(ctx, world) {
  const hz = world.fxState.hazes;
  if (!hz.length || !ctx.canvas || !ctx.getTransform) return;
  const cv = ctx.canvas, m = ctx.getTransform();
  for (const z of hz) {
    const fade = Math.min(1, z.t / 8, (z.life - z.t) / 12);
    if (fade <= 0) continue;
    const amp = 2.2 * fade;
    const x0 = Math.max(-8, Math.round(z.x)), x1 = Math.min(W + 8, Math.round(z.x + z.w));
    const y0 = Math.max(0, Math.round(z.y)), y1 = Math.min(H, Math.round(z.y + z.h));
    const w = x1 - x0;
    if (w <= 0) continue;
    for (let y = y0; y < y1; y += 2) {
      const dx = Math.round(Math.sin((y - y0) * 0.33 + z.t * 0.45 + z.ph) * amp);
      if (!dx) continue;
      ctx.drawImage(cv, m.a * x0 + m.e, m.d * y + m.f, w * m.a, 2 * m.d, x0 + dx, y, w, 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,210,170,${(0.035 * fade).toFixed(3)})`;
    for (let y = y0 + ((z.t >> 1) % 7); y < y1; y += 7) ctx.fillRect(x0, y, w, 1);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------ zone G: water / mud
// Sea surface y (zone G: world.bg.surfaceY); elsewhere the cavern ceiling.
function surfaceY(world) {
  const bg = world.bg;
  return bg && typeof bg.surfaceY === 'number' ? bg.surfaceY : Math.round(H * 0.66);
}
function surfaceTop(world) { return world.zone === 'G' || world.zone === 'M' ? surfaceY(world) : SURFACE_Y; }

const SPLASH = { small: { n: 10, k: 0.7, rings: 1, col: 0 }, medium: { n: 20, k: 1, rings: 1, col: 3 }, large: { n: 34, k: 1.3, rings: 2, col: 7 } };

// splash(world, x, y?, size): crown of droplets + foam ring(s) on the surface +
// bubbles below. y defaults to the surface. size 'small'|'medium'|'large' or a number (≈ scale).
export function splash(world, x, y, size = 'medium') {
  const R = world.fxRng;
  const c = typeof size === 'number' ? { n: Math.round(18 * size), k: size, rings: size > 1.2 ? 2 : 1, col: Math.round(5 * size) } : SPLASH[size] || SPLASH.medium;
  const yy = typeof y === 'number' ? y : surfaceY(world);
  for (let i = 0; i < c.n; i++) {
    const p = spawn(world, K_DROP, x + R.range(-6, 6) * c.k, yy - 1);
    if (!p) break;
    const side = R.range(-1, 1);
    p.vx = side * R.range(0.6, 1.8) * c.k; p.vy = -R.range(1.6, 3.6) * c.k * (1 - Math.abs(side) * 0.35);
    p.life = 90; p.s = 0; p.ph = R.next() < 0.3 ? 1 : 0;
  }
  for (let i = 0; i < c.col; i++) {        // central column
    const p = spawn(world, K_DROP, x + R.range(-2, 2), yy - 1);
    if (!p) break;
    p.vx = R.range(-0.25, 0.25); p.vy = -R.range(4, 6.2) * Math.min(1.3, c.k); p.life = 90; p.s = 0; p.ph = 1;
  }
  for (let i = 0; i < c.rings; i++) {
    const p = spawn(world, K_FOAM, x, yy);
    if (!p) break;
    p.d = i * 7; p.r0 = 4; p.r1 = 22 * c.k + i * 10; p.life = 30;
  }
  for (let i = 0; i < Math.round(4 * c.k); i++) {
    const p = spawn(world, K_BUBBLE, x + R.range(-10, 10) * c.k, yy + R.range(4, 18));
    if (!p) break;
    p.s = R.next() < 0.6 ? 0 : 1; p.vx = R.range(-0.2, 0.2); p.vy = -R.range(0.2, 0.5); p.life = 80; p.ph = R.range(0, 6.28);
  }
  if (c.k >= 1.2) addShake(world, 2);
}

// wake(world, x): surface disturbance above a submerged boss — call every few
// frames while it lurks (foam ripple, a couple of drops, bubbles rising).
export function wake(world, x) {
  const R = world.fxRng, sy = surfaceY(world);
  const f = spawn(world, K_FOAM, x + R.range(-6, 6), sy);
  if (f) { f.r0 = 2; f.r1 = R.range(8, 14); f.life = 24; }
  for (let i = 0; i < 2; i++) {
    const p = spawn(world, K_DROP, x + R.range(-8, 8), sy - 1);
    if (!p) break;
    p.vx = R.range(-0.6, 0.6); p.vy = -R.range(0.8, 1.8); p.life = 40; p.s = 0; p.ph = 0;
  }
  const b = spawn(world, K_BUBBLE, x + R.range(-12, 12), sy + R.range(6, 26));
  if (b) { b.s = R.next() < 0.7 ? 0 : 1; b.vx = 0; b.vy = -R.range(0.3, 0.6); b.life = 60; b.ph = R.range(0, 6.28); }
}

// mudBurst(world, x, y): mud ball impact — brown clods flying + mud puffs + chunks.
export function mudBurst(world, x, y) {
  const R = world.fxRng;
  for (let i = 0; i < 14; i++) {
    const p = spawn(world, K_DROP, x, y - 1);
    if (!p) break;
    const a = R.range(-Math.PI * 0.95, -Math.PI * 0.05), sp = R.range(1, 3.2);
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.life = R.int(30, 60); p.s = 1; p.ph = R.next() < 0.4 ? 1 : 0;
  }
  for (let i = 0; i < 3; i++) {
    const p = spawn(world, K_MUD, x + R.range(-6, 6), y - R.range(0, 6));
    if (!p) break;
    p.vx = R.range(-0.3, 0.3); p.vy = R.range(-0.5, -0.15); p.life = R.int(30, 48); p.d = i * 3; p.sc = R.next() < 0.4 ? 2 : 1;
  }
  for (let i = 0; i < 3; i++) debris(world, x, y - 2, R.range(-1.5, 1.5), -R.range(1, 2.4), R.next() < 0.5 ? '#4a3424' : '#5e4630');
  const f = spawn(world, K_FLASH, x, y); if (f) { f.s = 0; f.life = 3; }
}

const DROP_COL = [['#cfeeff', '#ffffff'], ['#5e4430', '#8e6c48']];
function drawMudPuffs(ctx, world) {
  const P = world.fxState.parts;
  const A = getFxArt();
  // localized splats (behind bullets): slam in oversized, slide down, fade
  for (const p of P) {
    if (p.k !== K_SPLAT || p.d > 0) continue;
    const s = getMudArt().splats[p.s], q = p.t / p.life;
    const sz = Math.round(s.width * p.sc * (p.t < 4 ? 1.4 : 1));
    ctx.globalAlpha = q < 0.7 ? 1 : Math.max(0, 1 - (q - 0.7) / 0.3);
    if(!paintedCell(ctx,'clods',8+Math.abs(p.s%4),Math.round(p.x-sz/2),Math.round(p.y-sz/2),sz,sz))ctx.drawImage(s, Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
    ctx.globalAlpha = 1;
  }
  // geyser columns: shoot up fast, hold, then collapse back down
  for (const p of P) {
    if (p.k !== K_GEYSER || p.d > 0) continue;
    const g = getMudArt().geyser, q = p.t / p.life;
    const k = q < 0.15 ? q / 0.15 : q < 0.55 ? 1 : Math.max(0, 1 - (q - 0.55) / 0.45);
    const h = Math.round(g.height * p.sc * (q < 0.15 ? 1 - (1 - k) ** 2 : k)), w = Math.round(g.width * p.sc * (0.8 + 0.2 * k));
    if (h < 2) continue;
    ctx.drawImage(g, 0, 0, g.width, g.height, Math.round(p.x - w / 2), Math.round(p.y - h), w, h);
  }
  // mud puffs
  const sm = A.mud;
  for (const p of P) {
    if (p.k !== K_MUD || p.d > 0) continue;
    const f = Math.min(sm.frames - 1, ((p.t / p.life) * sm.frames) | 0), sz = sm.S * p.sc;
    ctx.drawImage(sm.sheet, f * sm.S, 0, sm.S, sm.S, Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
  }
}
function drawWater(ctx, world) {
  const P = world.fxState.parts;
  // foam rings on the surface
  for (const p of P) {
    if (p.k !== K_FOAM || p.d > 0) continue;
    const q = p.t / p.life, r = p.r0 + (p.r1 - p.r0) * (1 - (1 - q) ** 2);
    if(world.zone==='G' && paintedCell(ctx,p.s===1?'clods':'water',p.s===1?8+Math.abs(Math.floor(p.r1))%4:14+(q>.5?1:0),p.x-r,p.y-5,r*2,10,1-q)){
      if(p.s!==1)paintedSurface(ctx,p.x,p.y,p.t,Math.max(28,p.r1*2));
      continue;
    }
    ctx.globalAlpha = 1 - q;
    ctx.strokeStyle = p.s === 1 ? '#a07a52' : '#e8f8ff'; ctx.lineWidth = q < 0.4 ? 2 : 1;
    for(let j=0;j<7;j++){const a=j*.91+p.x*.13;ctx.beginPath();ctx.ellipse(Math.round(p.x),Math.round(p.y),r,Math.max(1,r*.16),0,a,a+.34+(1-q)*.25);ctx.stroke();}
  }
  ctx.globalAlpha = 1;
  // droplets / clods
  for (const p of P) {
    if (p.k !== K_DROP || p.d > 0) continue;
    const col = DROP_COL[p.s];
    ctx.fillStyle = col[p.ph ? 1 : 0];
    const x = Math.round(p.x), y = Math.round(p.y);
    drawSpray(ctx,x,y,p.vx,p.vy,p.t,p.s===1,p.ph+Math.floor(p.x));
  }
}

// ------------------------------------------------- hybrid ZONE G: mud FX
const MUD_FLAKES = ['#6a5236', '#54402a', '#8a6c48', '#3e2e1e'];

// mudChunk(world, x, y, vx, vy): dried mud flake chipping off (harmless,
// drawn in drawUnder = behind bullets). Falls; plops into the sea if it
// started above the surface.
export function mudChunk(world, x, y, vx = 0, vy = 0) {
  const R = world.fxRng;
  const p = spawn(world, K_DEBRIS, x, y);
  if (!p) return;
  p.spr = chunkSprites(MUD_FLAKES[R.int(0, MUD_FLAKES.length - 1)])[R.int(0, 2)];
  p.vx = vx; p.vy = vy; p.va = R.range(-0.25, 0.25); p.a = R.range(0, 6.28);
  p.life = 300; p.r1 = 1; p.r0 = y < surfaceY(world) ? 1 : 0;
}

// mudWake(world, x, y?): mud + spray kicked up behind the skipping boss (call
// every few frames). y defaults to the sea surface.
export function mudWake(world, x, y) {
  const R = world.fxRng, yy = typeof y === 'number' ? y : surfaceY(world), above = yy <= surfaceY(world) + 1 ? 1 : 0;
  for (let i = 0; i < 5; i++) {
    const p = spawn(world, K_DROP, x + R.range(-6, 6), yy - 1);
    if (!p) break;
    const mud = i >= 3;
    p.s = mud ? 1 : 0; p.r0 = mud ? above : 0;
    p.vx = -R.range(0.8, 2.6); p.vy = -R.range(0.8, 2.6); p.life = 50; p.ph = R.next() < 0.4 ? 1 : 0;
  }
  const f = spawn(world, K_FOAM, x + R.range(-4, 4), surfaceY(world));
  if (f) { f.r0 = 3; f.r1 = R.range(10, 18); f.life = 22; }
  if (R.next() < 0.3) {
    const m = spawn(world, K_MUD, x, yy - 2);
    if (m) { m.vx = -R.range(0.3, 0.9); m.vy = -R.range(0.1, 0.3); m.life = R.int(24, 36); m.sc = 1; }
  }
}

// mudColumn(world, x, y?): huge mud-and-water column (eruption / death).
export function mudColumn(world, x, y) {
  const R = world.fxRng, yy = typeof y === 'number' ? y : surfaceY(world);
  splash(world, x, yy, 'large');
  const gz = spawn(world, K_GEYSER, x, yy + 4);
  if (gz) { gz.life = 70; gz.sc = 1.3; }
  for (let i = 0; i < 70; i++) {
    const p = spawn(world, K_DROP, x + R.range(-10, 10), yy - R.range(0, 6));
    if (!p) break;
    const mud = R.next() < 0.6;
    p.s = mud ? 1 : 0; p.r0 = mud ? 1 : 0; p.d = R.int(0, 12);
    p.vx = R.range(-1.7, 1.7); p.vy = -R.range(4, 9.5); p.life = 120; p.ph = R.next() < 0.5 ? 1 : 0;
  }
  for (let i = 0; i < 11; i++) {
    const m = spawn(world, K_MUD, x + R.range(-8, 8), yy - i * 11);
    if (!m) break;
    m.d = i * 2; m.vx = R.range(-0.3, 0.3); m.vy = -R.range(0.2, 0.5); m.life = R.int(50, 80); m.sc = 3;
  }
  for (let i = 0; i < 2; i++) { const f = spawn(world, K_FOAM, x, surfaceY(world)); if (f) { f.d = i * 9; f.r0 = 8; f.r1 = 50 + i * 30; f.life = 40; } }
  for (let i = 0; i < 6; i++) mudChunk(world, x + R.range(-8, 8), yy - R.range(10, 60), R.range(-2, 2), -R.range(2, 5));
  addShake(world, 6);
}

// mudWipe(world, frames=150): screen-space mud splatter that slams over the
// playfield, holds, then slides and drips off. Drawn last in drawOver (above
// gameplay; HUD/scenes stay on top). Purely cosmetic — the gameplay pause
// belongs to the boss/scenes side.
export function mudWipe(world, frames = 150) {
  const R = world.fxRng;
  const blobs = [];
  // a coarse jittered grid so the whole field is covered, heavier at the edges
  for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 8; gx++) {
    const edge = gx === 0 || gx === 7 || gy === 0 || gy === 4;
    if (!edge && R.next() < 0.25) continue;
    blobs.push({ x: (gx + 0.5) * (W / 8) + R.range(-14, 14), y: (gy + 0.5) * (H / 5) + R.range(-10, 10), v: R.int(0, 4),
      sc: edge || R.next() < 0.35 ? 2 : 1, d: R.int(0, 7), vy: 0, g: R.range(0.02, 0.07), fl: R.int(0, 3) });
  }
  const drips = [];
  for (let i = 0; i < 26; i++) drips.push({ x: R.range(0, W), y: R.range(-10, H * 0.6), v: R.int(0, 2), sp: R.range(0.4, 1.6), d: R.int(10, 50) });
  world.fxState.wipe = { t: 0, life: Math.max(30, frames | 0), blobs, drips };
}

function updateWipe(w) {
  const hold = w.life * 0.35;
  for (const b of w.blobs) if (w.t > hold + b.d * 3) { b.vy += b.g; b.y += b.vy; }
  for (const d of w.drips) if (w.t > d.d) d.y += d.sp * (w.t > hold ? 2.2 : 1);
}

function drawWipe(ctx, w) {
  const A = getMudArt();
  const q = w.t / w.life;
  const a = q < 0.75 ? 1 : Math.max(0, 1 - (q - 0.75) / 0.25);
  ctx.globalAlpha = a;
  for (const d of w.drips) {
    if (w.t < d.d) continue;
    const s = A.drips[d.v];
    ctx.drawImage(s, Math.round(d.x), Math.round(d.y));
  }
  for (const b of w.blobs) {
    const lt = w.t - b.d;
    if (lt < 0) continue;
    const slam = lt < 4 ? 1.5 : 1;                             // slams in oversized, then snaps
    const s = A.splats[b.v], sz = s.width * b.sc * slam;
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    ctx.scale(b.fl & 1 ? -1 : 1, b.fl & 2 ? -1 : 1);
    ctx.drawImage(s, -Math.round(sz / 2), -Math.round(sz / 2), Math.round(sz), Math.round(sz));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------- ZONE G burrow transition
// burrowMound(world, x, y, frames=150): the boss digs into the mudflat in the
// LOWER-RIGHT. A churning mud heap rises out of the flat at (x, y = ground
// line), throwing mud fountains, chunks and brown shockwave rings along the
// flat; at ~85% it bursts (mud column + chunks) as the boss emerges, then the
// heap collapses. Localized: x is clamped to the right third so the player's
// left/centre stays clear. Drawn in drawUnder (over the boss, behind player
// and bullets).
export function burrowMound(world, x, y, frames = 150) {
  const st = world.fxState;
  if (!st.mounds) st.mounds = [];
  if (st.mounds.length >= 2) st.mounds.shift();
  const L = Math.max(40, frames | 0);
  st.mounds.push({ x: Math.max(x, W * 0.68), y: typeof y === 'number' ? y : H - 30, t: 0, life: L, burst: Math.round(L * 0.85), sc: 1 });
  screenRumble(world, Math.round(L * 0.85), 1.5);
}

function moundK(m) {
  const q = m.t / m.life;
  if (q < 0.08) return 0;
  if (q < 0.7) { const u = (q - 0.08) / 0.62; return 1 - (1 - u) ** 2; }
  if (m.t < m.burst) return 1 + 0.12 * Math.sin(m.t * 0.9);       // bulging before the burst
  return Math.max(0, 1 - (m.t - m.burst) / 40);                   // collapses after the burst
}

function ring(world, x, y, r1, life, delay = 0) {
  const f = spawn(world, K_FOAM, x, y);
  if (f) { f.s = 1; f.r0 = 6; f.r1 = r1; f.life = life; f.d = delay; }
}

function updateMounds(world, st) {
  const R = world.fxRng;
  for (let i = st.mounds.length - 1; i >= 0; i--) {
    const m = st.mounds[i];
    m.t++;
    const k = moundK(m), top = m.y - 54 * k, half = 60;
    if (m.t === 1) { ring(world, m.x, m.y, 70, 34); ring(world, m.x, m.y, 46, 26, 8); }
    if (m.t > m.life * 0.08 && m.t < m.burst) {
      if (m.t % 22 === 0) ring(world, m.x, m.y, 56 + R.range(0, 20), 30);
      if (m.t % 5 === 0) {      // mud fountains off the heap (thrown up and to the right)
        for (let j = 0; j < 4; j++) {
          const p = spawn(world, K_DROP, m.x + R.range(-half * 0.6, half * 0.6) * k, top + R.range(0, 6));
          if (!p) break;
          p.s = 1; p.r0 = 0; p.vx = R.range(-0.7, 1.4); p.vy = -R.range(2.2, 5) * (0.6 + 0.4 * k); p.life = 60; p.ph = R.next() < 0.5 ? 1 : 0;
        }
        if (R.next() < 0.35) mudChunk(world, m.x + R.range(-30, 30) * k, top + 4, R.range(-0.6, 1.6), -R.range(2, 4));
        if (R.next() < 0.3) { const pf = spawn(world, K_MUD, m.x + R.range(-24, 24) * k, top + 2); if (pf) { pf.vx = R.range(-0.2, 0.4); pf.vy = -R.range(0.3, 0.7); pf.life = R.int(30, 50); pf.sc = 2; } }
      }
    }
    if (m.t === m.burst) {
      mudColumn(world, m.x, m.y - 6);
      for (let j = 0; j < 12; j++) mudChunk(world, m.x + R.range(-20, 20), m.y - R.range(10, 50), R.range(-1.2, 2.6), -R.range(3, 6));
      ring(world, m.x, m.y, 110, 40); ring(world, m.x, m.y, 80, 32, 6);
      addShake(world, 6);
    }
    if (m.t > m.burst + 44) st.mounds.splice(i, 1);
  }
}

// Called by bg-g.drawMid right after the mudflat (in front of the flat and
// the boss's lower body, behind player and bullets).
export function drawMounds(ctx, world) {
  const ms = world.fxState.mounds;
  if (!ms || !ms.length) return;
  const A = getMudArt();
  for (const m of ms) {
    const k = moundK(m);
    if (k <= 0.01) continue;
    const spr = A.mound[(m.t >> 3) % 3], w = spr.width, h = spr.height;
    const jx = m.t < m.burst ? ((m.t >> 1) & 1) : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(Math.round(m.x - w / 2 - 4), -60, w + 8, Math.round(m.y) + 62); ctx.clip();   // rises out of the flat
    ctx.drawImage(spr, Math.round(m.x - w / 2 + jx), Math.round(m.y + 2 - h * Math.min(1.15, k)));
    ctx.restore();
  }
}

// mudSplat(world, x, y, size='medium'): one localized mud splat that slams on,
// slides down and fades (~70 frames). Drawn behind bullets. size 'small' |
// 'medium' | 'large'. Use near the lower-right edge for the burrow; never
// over the player's area.
export function mudSplat(world, x, y, size = 'medium') {
  const R = world.fxRng;
  const p = spawn(world, K_SPLAT, x, y);
  if (!p) return;
  p.s = size === 'small' ? R.pick([0, 3]) : size === 'large' ? R.pick([2, 4]) : R.pick([1, 3]);
  p.sc = size === 'large' ? 2 : 1; p.life = 70; p.vy = 0;
}
