import { W, H } from '../config.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, aimAt } from './boss-util.js';
import { emit } from './world.js';
import { DIFFICULTY, SURFACE_Y } from './boss-mudskipper.js';
import { MSTRONG } from './boss-mudskipper-attacks.js';

export const HOP = { hp: [1.4, 2.2], firstAt: 140, g: 0.12, chainGap: 50, wipeBonus: 8000 };
const ITEMS = ['laser', 'shield', 'wave', 'homing', 'laser', 'shield', 'wave', 'bomb'];
const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

export function initHoppers(b) {
  b.hoppers = []; b.packs = {}; b.packN = 0; b.hopT = HOP.firstAt; b.chain = 0; b.chainT = 0; b.itemN = 0;
}

function spawnPack(world, b) {
  const R = world.rng, d = DIFFICULTY[b.phase];
  const id = b.packN++;
  const n = R.int(d.hopN[0], d.hopN[1]);
  b.packs[id] = { id, n, kills: 0, left: n };
  const gun = new Set();
  while (gun.size < Math.min(n - 1, d.hopGunners)) gun.add(R.int(1, n - 1));
  for (let i = 0; i < n; i++) {
    b.hoppers.push({ pack: id, i, x: W + 12 + (i % 3) * 10, y: SURFACE_Y + 8, vx: -1.2, vy: 0, g: HOP.g, air: false, on: false,
      under: 10 + i * 9 + R.int(0, 6), hp: HOP.hp[i % 4 === 0 ? 1 : 0], big: i % 4 === 0, gunner: gun.has(i), fired: false, flash: 0, t: 0,
      len: R.range(48, 74), h: R.range(36, 66) });
  }
}

export function updateHoppers(world, b) {
  const active = (b.mode === 'fight' || b.mode === 'crash') && !(b.atk && MSTRONG.has(b.atk.name));
  if (active && --b.hopT <= 0) {
    spawnPack(world, b);
    const e = DIFFICULTY[b.phase].hopEvery;
    b.hopT = world.rng.int(e[0], e[1]);
  }
  if (b.chain > 0 && ++b.chainT > HOP.chainGap) b.chain = 0;
  const calm = b.calmT > 0 || b.mode === 'crash' || (b.atk && MSTRONG.has(b.atk.name));
  const hs = b.hoppers;
  for (let k = hs.length - 1; k >= 0; k--) {
    const h = hs[k];
    h.t++;
    if (h.flash > 0) h.flash--;
    if (!h.air) {
      h.x -= 1.1;
      if (--h.under <= 0) {
        // leap: from the surface, travel `len` px left with apex height `h`
        const vy0 = Math.sqrt(2 * h.g * h.h), T = (2 * vy0) / h.g;
        h.vx = -h.len / T; h.vy = -vy0; h.air = true; h.y = SURFACE_Y + 2;
        for (let i = 0; i < 4; i++) b.splash.push({ x: h.x, y: SURFACE_Y - 1, vx: world.fxRng.range(-0.8, 0.8), vy: world.fxRng.range(-2, -0.8), t: 0, c: i & 1 });
      }
    } else {
      const prevVy = h.vy;
      h.vy += h.g; h.x += h.vx; h.y += h.vy;
      if (h.gunner && !h.fired && prevVy < 0 && h.vy >= 0 && !calm && h.x < W - 20 && h.x > 60) {
        h.fired = true;
        const a = aimAt(world, h.x, h.y);
        bullets.fire(world, { x: h.x - 4, y: h.y, vx: Math.cos(a) * 1.7, vy: Math.sin(a) * 1.7, type: 'orb', color: 'red', cause: 'mudHopShot', atk: 0 });
      }
      if (h.vy > 0 && h.y >= SURFACE_Y + 4) {
        h.air = false; h.under = 12 + ((h.i * 5) % 12);
        for (let i = 0; i < 3; i++) b.splash.push({ x: h.x, y: SURFACE_Y - 1, vx: world.fxRng.range(-0.8, 0.8), vy: world.fxRng.range(-1.6, -0.6), t: 0, c: i & 1 });
      }
    }
    h.on = h.x < W + 6;
    if (h.x < -24) {
      hs.splice(k, 1);
      const pk = b.packs[h.pack];
      if (pk) {
        pk.left--;
        if (!pk.leaked) { pk.leaked = true; if (b.chain > 0) emit(world, { type: 'chainBreak', x: 0, y: h.y, chain: b.chain }); b.chain = 0; b.chainT = 0; }
        packDone(world, b, pk, h);
      }
    }
  }
}

function dropItem(world, b, x, y) {
  if (typeof player.spawnItem !== 'function') return;
  player.spawnItem(world, Math.max(20, Math.min(W - 20, x)), Math.min(SURFACE_Y - 10, y), ITEMS[b.itemN++ % ITEMS.length]);
}

function packDone(world, b, pk, h) {
  if (pk.left > 0 || pk.done) return;
  pk.done = true;
  if (pk.kills >= pk.n) {
    stats(world).schoolsWiped++;
    const bonus = Math.round(((HOP.wipeBonus * pk.n) / 10) * (1 + Math.min(b.chain, 30) / 30) / 100) * 100;
    world.score += bonus;
    fxCall('scorePopup', world, Math.max(40, Math.min(W - 60, h.x)), Math.max(20, h.y - 10), bonus);
    dropItem(world, b, h.x, h.y);
    sfx('powerup');
    emit(world, { type: 'schoolWiped', x: h.x, y: h.y, bonus, size: pk.n, kind: 'hopper' });
  } else {
    world.score += pk.kills * 50;
    emit(world, { type: 'schoolEscaped', left: pk.n - pk.kills });
  }
  delete b.packs[pk.id];
}

const above = (h) => h.on && h.air && h.y < SURFACE_Y - 2;
export function hitHopper(world, x, y, r) {
  const hs = world.boss.hoppers;
  for (const h of hs) {
    if (!above(h)) continue;
    const rr = (h.big ? 9 : 7) + r, dx = x - h.x, dy = y - h.y;
    if (dx * dx * 0.6 + dy * dy < rr * rr) return { kind: 'escort', part: 'hopper', ref: h, mult: 1, x, y };
  }
  return null;
}

export function damageHopper(world, hit, dmg) {
  const b = world.boss, h = hit.ref;
  if (!h || h.dead) return;
  h.hp -= dmg; h.flash = 3; world.score += 10;
  if (h.hp > 0) return;
  h.dead = true;
  const k = b.hoppers.indexOf(h);
  if (k >= 0) b.hoppers.splice(k, 1);
  fxCall('explode', world, h.x, h.y, 'small', { debris: ['#8a96a8', '#ff7a30'] });
  sfx('hit');
  b.chain++; b.chainT = 0;
  const st = stats(world);
  st.fishKills++; st.bestChain = Math.max(st.bestChain, b.chain);
  world.score += 300 + 20 * Math.min(b.chain, 40);
  emit(world, { type: 'fishKill', x: h.x, y: h.y, chain: b.chain });
  const pk = b.packs[h.pack];
  if (pk) { pk.kills++; pk.left--; packDone(world, b, pk, h); }
}

export function hopperBodyHit(world, x, y, r) {
  for (const h of world.boss.hoppers) {
    if (!above(h)) continue;
    const rr = (h.big ? 5 : 4) + r, dx = x - h.x, dy = y - h.y;
    if (dx * dx * 0.6 + dy * dy < rr * rr) return h;
  }
  return null;
}

export function killAllHoppers(world, b) {
  for (const h of b.hoppers) if (above(h)) fxCall('explode', world, h.x, h.y, 'small', { debris: false });
  b.hoppers.length = 0; b.packs = {};
}

export function drawHoppers(ctx, world, b, S) {
  const s = S.hopper;
  for (const h of b.hoppers) {
    if (!h.on || !h.air) continue;
    ctx.save();
    ctx.translate(Math.round(h.x), Math.round(h.y));
    const a = Math.atan2(h.vy, -h.vx); // facing left, nose follows the arc
    ctx.rotate(-a * 0.8);
    if (h.big) ctx.scale(1.25, 1.25);
    ctx.drawImage(h.flash > 0 && (b.t & 1) ? s.white : s.img, -s.px, -s.py);
    ctx.restore();
    if (h.gunner && !h.fired) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(b.t * 0.4 + h.i);
      ctx.drawImage(S.redLight, Math.round(h.x) - 4, Math.round(h.y) - 4);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  }
}
