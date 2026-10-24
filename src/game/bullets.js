import { W, H } from '../config.js';
import { swapRemove, TAU, makeSprite } from '../core/util.js';
import * as player from './player.js';
import * as fx from './fx.js';

const DEF_R = { orb: 3, needle: 2, bubble: 6, egg: 5, larva: 2 };
const HIT_K = { orb: 0.75, needle: 0, bubble: 0.7, egg: 0.7, larva: 0.8 };
const CANCEL_SCORE = 100;

export function init(world) {
  world.eShots = [];
  world.bulletFx = [];
}

export function fire(world, spec) {
  const type = DEF_R[spec.type] ? spec.type : 'orb';
  const b = { life: 900, t: 0, ...spec, type };
  if (b.r === undefined) b.r = DEF_R[type];
  if (b.ang !== undefined && b.spd !== undefined && b.vx === undefined) {
    b.vx = Math.cos(b.ang) * b.spd;
    b.vy = Math.sin(b.ang) * b.spd;
  }
  b.vx = b.vx || 0; b.vy = b.vy || 0;
  if (b.hr === undefined) b.hr = type === 'needle' ? Math.max(1.5, b.r * 0.6) : Math.max(1.2, b.r * HIT_K[type]);
  if (type === 'egg') {
    if (b.hatch === undefined) b.hatch = 90;
    if (b.drag === undefined && !b.accel) b.drag = 0.985;
    if (b.minSpd === undefined) b.minSpd = 0.3;
  }
  if (type === 'larva' && b.homing && b.homeFrames === undefined) b.homeFrames = 60;
  b.polar = !!(b.accel || b.angVel || b.drag || b.homing);
  if (b.polar) { b.ang = Math.atan2(b.vy, b.vx); b.spd = Math.hypot(b.vx, b.vy); }
  if (type === 'needle' || type === 'larva') b.dir = dirIndex(Math.atan2(b.vy, b.vx));
  b.ph = (world.eShots.length * 7 + (b.x | 0)) & 63; // cosmetic phase, deterministic
  world.eShots.push(b);
  return b;
}

function sparkle(world, x, y, gold) {
  const f = world.bulletFx;
  if (f.length < 400) f.push({ x, y, t: 0, gold });
}

function cancelAt(world, i, toScore) {
  const s = world.eShots, b = s[i];
  if (toScore) world.score += CANCEL_SCORE;
  sparkle(world, b.x, b.y, toScore);
  swapRemove(s, i);
}

export function clearAll(world, toScore = false) {
  const s = world.eShots;
  const n = s.length;
  if (toScore && n && typeof fx.scorePopup === 'function') {
    const step = Math.max(1, Math.ceil(n / 24));
    for (let i = 0; i < n; i += step) fx.scorePopup(world, s[i].x, s[i].y, CANCEL_SCORE * Math.min(step, n - i));
  }
  for (let i = n - 1; i >= 0; i--) cancelAt(world, i, toScore);
}

export function vortex(world, x, y, R, pull, killR) {
  const s = world.eShots;
  let n = 0;
  const R2 = R * R, k2 = killR * killR;
  for (let i = s.length - 1; i >= 0; i--) {
    const b = s[i];
    const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
    if (d2 > R2) continue;
    if (d2 < k2) { cancelAt(world, i, true); n++; continue; }
    if (pull > 0) {
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      const f = pull * (1.6 - d / R);
      b.vx = b.vx * 0.88 + nx * f - ny * f * 0.22;
      b.vy = b.vy * 0.88 + ny * f + nx * f * 0.22;
      b.polar = false; b.homing = false; b.sucked = true;
      if (b.type === 'egg') b.hatch = Math.max(b.hatch, 30);
      if (b.dir !== undefined) b.dir = dirIndex(Math.atan2(b.vy, b.vx));
    }
  }
  return n;
}

function hatchEgg(world, b) {
  if (typeof b.onHatch === 'function') { b.onHatch(world, b); return; }
  const p = world.player;
  const base = Math.atan2(p.y - b.y, p.x - b.x);
  const n = b.count || 6, spr = b.spread === undefined ? 0.32 : b.spread, spd = b.larvaSpd || 1.1;
  for (let k = 0; k < n; k++) {
    const a = base + (k - (n - 1) / 2) * spr;
    fire(world, { type: 'larva', x: b.x + Math.cos(a) * 3, y: b.y + Math.sin(a) * 3, ang: a, spd, homing: b.larvaHoming !== false, homeFrames: 50, turn: 0.03, color: b.color });
  }
  for (let k = 0; k < 6; k++) sparkle(world, b.x + Math.cos(k) * b.r, b.y + Math.sin(k) * b.r, false);
}

export function update(world) {
  const s = world.eShots;
  let hb = player.playerHitbox(world);
  const p = world.player;
  for (let i = s.length - 1; i >= 0; i--) {
    const b = s[i];
    b.t++;
    if (b.delay > 0) { b.delay--; }
    else {
      if (b.polar) {
        if (b.accel) b.spd += b.accel;
        if (b.drag) b.spd *= b.drag;
        if (b.minSpd !== undefined && b.spd < b.minSpd) b.spd = b.minSpd;
        if (b.maxSpd !== undefined && b.spd > b.maxSpd) b.spd = b.maxSpd;
        if (b.angVel) b.ang += b.angVel;
        if (b.homing && b.t <= b.homeFrames && p && p.alive) {
          let da = Math.atan2(p.y - b.y, p.x - b.x) - b.ang;
          da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
          const tr = b.turn || 0.03;
          b.ang += da > tr ? tr : da < -tr ? -tr : da;
        }
        b.vx = Math.cos(b.ang) * b.spd;
        b.vy = Math.sin(b.ang) * b.spd;
        if (b.dir !== undefined) b.dir = dirIndex(b.ang);
      }
      b.x += b.vx; b.y += b.vy;
    }
    const m = b.r + 12;
    // shots spawned off-screen right (e.g. tail tip) survive while still heading in
    const offR = b.x > W + m && !(b.vx < 0 && b.x < W + 80);
    if (--b.life <= 0 || b.x < -m || offR || b.y < -m || b.y > H + m) { swapRemove(s, i); continue; }
    if (b.type === 'egg' && --b.hatch <= 0) {
      swapRemove(s, i);
      hatchEgg(world, b);
      continue;
    }
    if (hb) {
      const dx = b.x - hb.x, dy = b.y - hb.y, rr = b.hr + hb.r;
      if (dx * dx + dy * dy < rr * rr) {
        swapRemove(s, i);
        const r = typeof player.hurt === 'function' ? player.hurt(world, { kind: 'bullet', x: b.x, y: b.y, cause: b.cause || 'unknown', atk: b.atk ?? null })
          : player.absorbHit(world) ? 'absorbed' : (player.killPlayer(world, b.cause, b.atk), 'killed');
        if (r === 'absorbed') sparkle(world, b.x, b.y, false);
        hb = player.playerHitbox(world); // state may have changed (death)
      }
    }
  }
  const f = world.bulletFx;
  for (let i = f.length - 1; i >= 0; i--) {
    const q = f[i];
    q.t++; q.y -= 0.4;
    if (q.t > 18) swapRemove(f, i);
  }
}

// ================================================================ art
const NDIR = 32;
function dirIndex(a) { return ((Math.round((a / TAU) * NDIR) % NDIR) + NDIR) % NDIR; }

const COLORS = {
  pink: ['#ffffff', '#ffc4e6', '#ff3ca8', '#3a0420'],
  orange: ['#ffffff', '#fff0a0', '#ff8a14', '#3c1000'],
  violet: ['#ffffff', '#e6c8ff', '#b048ff', '#1e0640'],
  red: ['#ffffff', '#ffb4a4', '#ff2c2c', '#3e0606'],
  magenta: ['#ffffff', '#ffd0f4', '#ff40d0', '#360430'],
};
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function pix(w, h, fn) {
  return makeSprite(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      if (!c) continue;
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] === undefined ? 255 : c[3];
    }
    ctx.putImageData(img, 0, 0);
  });
}
// mask-based sprite with automatic 1px dark outline. fn → null | rgba
function outlined(w, h, fn, outline, oa = 255) {
  const cells = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = fn(x, y);
  const o = [...hex(outline), oa];
  return pix(w, h, (x, y) => {
    const c = cells[y * w + x];
    if (c) return c;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && cells[ny * w + nx] && cells[ny * w + nx][3] !== 0) return o;
    }
    return null;
  });
}

function orbSprite(r, col, f) {
  const C = COLORS[col] || COLORS.pink;
  const S = 2 * r + 7, c = r + 3;
  const core = r * (f ? 0.5 : 0.4) + 0.35;
  const mid = hex(C[2]);
  return pix(S, S, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (d <= core) return [255, 255, 255];
    if (d <= r * 0.74 + 0.2) return [...hex(C[1])];
    if (d <= r + 0.35) return [...mid];
    if (d <= r + 1.35) return [...hex(C[3])];
    if (d <= r + 3.2) {
      const k = 1 - (d - r - 1.35) / 1.85;
      const a = k * (f ? 120 : 90);
      return BAY[(y & 3) * 4 + (x & 3)] < 0.75 ? [...mid, Math.round(a)] : null;
    }
    return null;
  });
}

function needleSprite(r, col, dir) {
  const C = COLORS[col] || COLORS.magenta;
  const L = r <= 2 ? 11 : 15, Wd = r <= 2 ? 1.6 : 2.3;
  const S = L + 4, c = (S - 1) / 2;
  const a = (dir / NDIR) * TAU, ca = Math.cos(a), sa = Math.sin(a);
  return outlined(S, S, (x, y) => {
    const dx = x - c, dy = y - c;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    const hl = L / 2;
    if (Math.abs(u) > hl) return null;
    // tapered: fat toward the head (u>0), thin tail
    const prof = u > 0 ? Wd * (1 - (u / hl) ** 2) + 0.35 : Wd * (1 + u / hl) * 0.9 + 0.3;
    if (Math.abs(v) > prof) return null;
    if (Math.abs(v) < prof * 0.45 && u > -hl * 0.4) return [255, 255, 255];
    if (Math.abs(v) < prof * 0.8) return [...hex(C[1])];
    return [...hex(C[2])];
  }, C[3]);
}

function bubbleSprite(r, f) {
  const wob = Math.sin((f / 4) * TAU) * 0.08;
  const rx = r * (1 + wob), ry = r * (1 - wob);
  const S = 2 * Math.ceil(r * 1.1) + 5, c = (S - 1) / 2;
  return pix(S, S, (x, y) => {
    const nx = (x - c) / rx, ny = (y - c) / ry;
    const d = Math.hypot(nx, ny);
    if (d > 1.0 + 1.3 / r) return null;
    if (d > 1.0) return [70, 12, 70, 210];
    if (d > 1 - 1.6 / r) {
      const lit = -(nx * 0.6 + ny * 0.8);
      return lit > 0.3 ? [255, 236, 255, 240] : lit > -0.3 ? [255, 160, 220, 225] : [210, 90, 190, 220];
    }
    // specular
    const hx = nx + 0.4, hy = ny + 0.42;
    if (hx * hx + hy * hy < 0.05 + 0.02 * (r > 7 ? 1 : 0)) return [255, 255, 255, 250];
    if (nx > 0.2 && ny > 0.2 && d > 0.6 && d < 0.78) return [255, 200, 240, 120];
    return [255, 120, 210, Math.round(30 + d ** 3 * 70)];
  });
}

function eggSprite(r, f) {
  const S = 2 * r + 5, c = (S - 1) / 2;
  const pulse = f === 1 ? 0.6 : 0;
  const flash = f === 2;
  const emb = [[-0.35, -0.3], [0.35, -0.25], [0, 0.35], [-0.05, -0.02]];
  return pix(S, S, (x, y) => {
    const nx = (x - c) / (r + pulse), ny = (y - c) / (r + pulse);
    const d = Math.hypot(nx, ny);
    if (d > 1.0 + 1.2 / r) return null;
    if (d > 1.0) return [60, 10, 20, 230];
    if (flash) return d > 0.8 ? [255, 255, 255] : [255, 200, 220, 230];
    if (d > 1 - 1.5 / r) return -(nx * 0.6 + ny * 0.8) > 0.2 ? [255, 230, 190] : [255, 140, 90];
    for (const [ex, ey] of emb) {
      const e = Math.hypot(nx - ex, ny - ey);
      if (e < 0.26) {
        if (e < 0.09 && (nx - ex) > 0) return [255, 255, 255];
        return e < 0.16 ? [160, 20, 60] : [90, 10, 40];
      }
    }
    const hx = nx + 0.45, hy = ny + 0.5;
    if (hx * hx + hy * hy < 0.04) return [255, 255, 255];
    return [255, 150, 110, Math.round(150 + d * 60)];
  });
}

function larvaSprite(dir, f) {
  const S = 13, c = 6;
  const a = (dir / NDIR) * TAU, ca = Math.cos(a), sa = Math.sin(a);
  return outlined(S, S, (x, y) => {
    const dx = x - c, dy = y - c;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    // head at u≈+1.5
    const hd = Math.hypot(u - 1.5, v);
    if (hd < 2.3) return hd < 1.0 ? [255, 255, 255] : [255, 196, 228];
    // tail from u=0 back to u=-5.5, wiggling
    if (u < 0.5 && u > -5.5) {
      const off = Math.sin(-u * 1.1 + f * 2.1) * (-u) * 0.28;
      const w = 1.3 * (1 + u / 6);
      if (Math.abs(v - off) < w) return [255, 70, 160];
    }
    return null;
  }, '#300418');
}

const cache = new Map();
function spr(key, make) {
  let s = cache.get(key);
  if (!s) { s = make(); cache.set(key, s); }
  return s;
}

// ================================================================ draw
export function draw(ctx, world) {
  const s = world.eShots, fr = world.frame;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // pass 1: big translucent things underneath
  for (const b of s) {
    if (b.type !== 'bubble' && b.type !== 'egg') continue;
    const r = Math.max(3, Math.min(14, Math.round(b.r)));
    let sp;
    if (b.type === 'bubble') {
      const f = ((fr + b.ph) >> 3) & 3;
      sp = spr(`b${r}_${f}`, () => bubbleSprite(r, f));
    } else {
      const er = Math.max(3, Math.min(10, r));
      const f = b.hatch < 36 && ((b.hatch >> 2) & 1) ? 2 : ((fr + b.ph) >> 4) & 1;
      sp = spr(`e${er}_${f}`, () => eggSprite(er, f));
    }
    ctx.drawImage(sp, Math.round(b.x) - (sp.width >> 1), Math.round(b.y) - (sp.height >> 1));
  }
  // pass 2: needles + larva
  for (const b of s) {
    if (b.type === 'needle') {
      const r = b.r <= 2 ? 2 : 3, col = b.color || 'magenta';
      const sp = spr(`n${r}${col}${b.dir}`, () => needleSprite(r, col, b.dir));
      ctx.drawImage(sp, Math.round(b.x) - (sp.width >> 1), Math.round(b.y) - (sp.height >> 1));
    } else if (b.type === 'larva') {
      const f = ((fr + b.ph) >> 2) % 3;
      const sp = spr(`l${b.dir}_${f}`, () => larvaSprite(b.dir, f));
      ctx.drawImage(sp, Math.round(b.x) - 6, Math.round(b.y) - 6);
    }
  }
  // pass 3: orbs on top (most common, must always read)
  for (const b of s) {
    if (b.type !== 'orb') continue;
    const r = Math.max(2, Math.min(9, Math.round(b.r))), col = b.color || 'pink';
    const f = ((fr + b.ph) >> 2) & 1;
    const sp = spr(`o${r}${col}${f}`, () => orbSprite(r, col, f));
    ctx.drawImage(sp, Math.round(b.x) - r - 3, Math.round(b.y) - r - 3);
  }
  // cancel sparkles
  for (const q of world.bulletFx) {
    const k = q.t, x = Math.round(q.x), y = Math.round(q.y);
    const s2 = k < 5 ? k : k < 10 ? 10 - k : 0;
    ctx.fillStyle = q.gold ? (k < 8 ? '#fff8c0' : '#ffc040') : (k < 8 ? '#ffffff' : '#ff9ad8');
    ctx.fillRect(x - s2, y, s2 * 2 + 1, 1);
    ctx.fillRect(x, y - s2, 1, s2 * 2 + 1);
    if (k < 12) ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  ctx.restore();
}
