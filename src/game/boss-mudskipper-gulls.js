import { W, H } from '../config.js';
import * as player from './player.js';
import { sfx, fxCall } from './boss-util.js';
import { emit } from './world.js';
import { DIFFICULTY, SURFACE_Y } from './boss-mudskipper.js';

const ITEMS = ['shield', 'laser', 'wave', 'homing'];
const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

export const GULL_TELL = 30;
export function initGulls(b) { b.gulls = []; b.flocks = {}; b.flockN = 0; b.gullWipes = 0; }

export function spawnFlock(world, b, atk) {
  const d = DIFFICULTY[b.phase];
  const id = b.flockN++;
  const n = d.gullN;
  b.flocks[id] = { id, n, kills: 0, left: n };
  for (let i = 0; i < n; i++) {
    const k = Math.ceil(i / 2), side = i % 2 ? -1 : 1;
    b.gulls.push({ flock: id, i, x: W + 16 + k * 16, y: Math.max(10, 24 + side * k * 7), st: 'cruise', t: 0, hp: 1.5, flash: 0,
      diveAt: W - 70 - i * 22, atk: atk.id, vx: -1.8, vy: 0 });
  }
  sfx('missile');
}

const bez = (a, c, e, u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * e;

export function updateGulls(world, b) {
  const p = world.player, hb = player.playerHitbox(world);
  const gs = b.gulls;
  const halt = b.mode === 'roar' || b.mode === 'crash' || b.mode === 'blind' || b.mode === 'death';
  for (let k = gs.length - 1; k >= 0; k--) {
    const g = gs[k];
    g.t++;
    if (halt && !g.harmless) { g.harmless = true; g.st = 'away'; } // flee harmlessly during transitions/crash
    if (g.flash > 0) g.flash--;
    const x0 = g.x, y0 = g.y;
    if (g.st === 'cruise') {
      g.x -= 1.8; g.y += Math.sin(g.t * 0.15 + g.i) * 0.3;
      if (g.x <= g.diveAt) {
        g.st = 'tell'; g.t = 0;
        const tx = p && p.alive ? p.x + 6 : 80, ty = p && p.alive ? Math.min(p.y, SURFACE_Y - 30) : 90;
        const ex = g.x - 190, ey = 14;
        g.path = { ax: g.x, ay: g.y, cx: 2 * tx - 0.5 * (g.x + ex), cy: 2 * ty - 0.5 * (g.y + ey), ex, ey, T: 74 };
      }
    } else if (g.st === 'tell') {
      if (g.t === 1) sfx('hit');
      if (g.t >= GULL_TELL) { g.st = 'dive'; g.t = 0; }
    } else if (g.st === 'dive') {
      const P = g.path, u = Math.min(1, g.t / P.T);
      g.x = bez(P.ax, P.cx, P.ex, u); g.y = bez(P.ay, P.cy, P.ey, u);
      if (u >= 1) { g.st = 'away'; }
    } else {
      g.x -= 3; g.y -= 1.2;
    }
    g.vx = g.x - x0; g.vy = g.y - y0;
    g.on = g.x < W + 6;
    if (hb && g.on && !g.harmless && (hb.x - g.x) ** 2 + (hb.y - g.y) ** 2 < (8 + hb.r) ** 2) {
      if (typeof player.hurt === 'function') player.hurt(world, { kind: 'escort', cause: 'mudGull', atk: g.atk, x: g.x, y: g.y });
    }
    if (g.x < -24 || g.y < -24) {
      gs.splice(k, 1);
      const f = b.flocks[g.flock];
      if (f) { f.left--; done(world, b, f, g); }
    }
  }
}

function done(world, b, f, g) {
  if (f.left > 0 || f.done) return;
  f.done = true;
  if (f.kills >= f.n) {
    stats(world).schoolsWiped++;
    const bonus = 3000 * f.n;
    world.score += bonus;
    fxCall('scorePopup', world, Math.max(40, Math.min(W - 60, g.x)), Math.max(20, g.y), bonus);
    if (b.gullWipes++ % 2 === 0 && typeof player.spawnItem === 'function') {
      // items fall to the water and float there (lure the ship down)
      player.spawnItem(world, Math.max(30, Math.min(W - 30, g.x)), SURFACE_Y - 10, ITEMS[(b.gullWipes >> 1) % ITEMS.length]);
    }
    emit(world, { type: 'schoolWiped', x: g.x, y: g.y, bonus, size: f.n, kind: 'gull' });
  }
  delete b.flocks[f.id];
}

export function hitGull(world, x, y, r) {
  for (const g of world.boss.gulls) {
    if (!g.on) continue;
    if ((x - g.x) ** 2 + (y - g.y) ** 2 < (11 + r) ** 2) return { kind: 'escort', part: 'gull', ref: g, gull: true, mult: 1, x, y };
  }
  return null;
}

export function damageGull(world, hit, dmg) {
  const b = world.boss, g = hit.ref;
  if (!g || g.dead) return;
  g.hp -= dmg; g.flash = 3; world.score += 10;
  if (g.hp > 0) return;
  g.dead = true;
  const k = b.gulls.indexOf(g);
  if (k >= 0) b.gulls.splice(k, 1);
  fxCall('explode', world, g.x, g.y, 'small', { debris: ['#8a96a8', '#d8dde6'] });
  sfx('hit');
  b.chain = (b.chain || 0) + 1; b.chainT = 0;
  const st = stats(world);
  st.fishKills++; st.bestChain = Math.max(st.bestChain, b.chain);
  world.score += 300 + 20 * Math.min(b.chain, 40);
  emit(world, { type: 'fishKill', x: g.x, y: g.y, chain: b.chain });
  const f = b.flocks[g.flock];
  if (f) { f.kills++; f.left--; done(world, b, f, g); }
}

export function killAllGulls(world, b) {
  for (const g of b.gulls) if (g.on) fxCall('explode', world, g.x, g.y, 'small', { debris: false });
  b.gulls.length = 0; b.flocks = {};
}

export function drawGulls(ctx, world, b, S) {
  for (const g of b.gulls) {
    if (!g.on) continue;
    if ((g.st === 'tell' || g.st === 'dive') && g.path) { // committed path: solid
      ctx.fillStyle = '#c8faff';
      const P = g.path;
      for (let k = 1; k < 20; k++) { const u = k / 20; ctx.fillRect(Math.round(bez(P.ax, P.cx, P.ex, u)), Math.round(bez(P.ay, P.cy, P.ey, u)), 1, 1); }
    }
    const s = S.gull[(b.t >> 3) % 2];
    ctx.save();
    ctx.translate(Math.round(g.x), Math.round(g.y));
    const a = Math.atan2(g.vy, -g.vx || -0.01);
    ctx.rotate(-a * 0.7);
    ctx.scale(1.6, 1.6);
    ctx.drawImage(g.flash > 0 && (b.t & 1) ? s.white : s.img, -s.px, -s.py);
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7;
    ctx.drawImage(S.redLight, Math.round(g.x - 10 * Math.cos(a)) - 4, Math.round(g.y - 2) - 4);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (g.st === 'tell') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(S.tellGlow, Math.round(g.x) - 8, Math.round(g.y) - 8);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  }
}
