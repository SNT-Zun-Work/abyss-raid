import { W } from '../config.js';
import * as player from './player.js';
import { sfx, fxCall } from './boss-util.js';
import { emit } from './world.js';
import { SURFACE_Y, DIFFICULTY, stats } from './boss-skipper-core.js';
import { getSkArt } from './boss-skipper-art.js';

const FRY = { hp: 1.6, g: 0.11, chainGap: 50, wipeBonus: 6000, chimneyHp: 30 };
const ITEMS = ['laser', 'shield', 'wave', 'homing', 'laser', 'wave', 'homing', 'bomb']; // one shield per cycle (balance r3)
export const CHIMNEY_X = [158, 226];

export function initFry(b) {
  b.fry = []; b.fryGroups = {}; b.fryN = 0; b.fryT = 200; b.chain = 0; b.chainT = 0; b.itemN = 0;
  b.chimneys = CHIMNEY_X.map((x) => ({ x, hp: FRY.chimneyHp, max: FRY.chimneyHp, state: 'ok', flash: 0, puff: 0 }));
}

function spawnGroup(world, b, n, src) {
  const R = world.rng, id = b.fryN++;
  b.fryGroups[id] = { id, n, kills: 0, left: n };
  for (let i = 0; i < n; i++) {
    const f = { group: id, i, x: src ? src.x : W + 10 + i * 9, y: src ? SURFACE_Y - 16 : SURFACE_Y + 4, vx: 0, vy: 0, g: FRY.g,
      air: false, under: src ? 4 + i * 11 : 8 + i * 10, hp: FRY.hp, flash: 0, t: 0,
      len: src ? R.range(40, 62) : R.range(50, 78), h: src ? R.range(34, 58) : R.range(22, 40), on: true };
    b.fry.push(f);
  }
  if (src) src.puff = 20;
}

// a submerged stream: fry swim in a line under the water (hittable + harmful there)
function spawnSwim(world, b, n) {
  const R = world.rng, id = b.fryN++, y0 = R.range(SURFACE_Y + 16, 202);
  b.fryGroups[id] = { id, n, kills: 0, left: n, noItem: true };
  for (let i = 0; i < n; i++) b.fry.push({ group: id, i, swim: true, x: W + 10 + i * 16, y: y0, y0, vx: -1.5, vy: 0, g: 0, air: false, hp: FRY.hp, flash: 0, t: 0, on: true });
}

export function updateFry(world, b, active) {
  if (active && --b.fryT <= 0) {
    const d = DIFFICULTY[b.phase];
    const alive = b.half === 1 ? b.chimneys.filter((c) => c.state === 'ok') : [];
    if (b.half === 2 && world.rng.next() < 0.55) spawnSwim(world, b, world.rng.int(4, 5));
    else spawnGroup(world, b, world.rng.int(3, 4), alive.length ? world.rng.pick(alive) : null);
    b.fryT = world.rng.int(d.fryEvery[0], d.fryEvery[1]);
  }
  if (b.chain > 0 && ++b.chainT > FRY.chainGap) b.chain = 0;
  for (const c of b.chimneys) { if (c.flash > 0) c.flash--; if (c.puff > 0) c.puff--; }
  const fs = b.fry;
  for (let k = fs.length - 1; k >= 0; k--) {
    const f = fs[k];
    f.t++;
    if (f.flash > 0) f.flash--;
    if (f.swim) { f.x += f.vx; f.y = f.y0 + Math.sin(f.t * 0.12 + f.i) * 4; }
    else if (!f.air) {
      if (f.y > SURFACE_Y) f.x -= 1.1;
      if (--f.under <= 0) {
        const vy0 = Math.sqrt(2 * f.g * f.h), T = (2 * vy0) / f.g;
        f.vx = -f.len / T; f.vy = -vy0; f.air = true;
        for (let i = 0; i < 3; i++) b.splash.push({ x: f.x, y: SURFACE_Y - 1, vx: world.fxRng.range(-0.8, 0.8), vy: world.fxRng.range(-1.8, -0.6), t: 0, c: i & 1 });
      }
    } else {
      f.vy += f.g; f.x += f.vx; f.y += f.vy;
      if (f.vy > 0 && f.y >= SURFACE_Y + 3) {
        f.air = false; f.y = SURFACE_Y + 3; f.under = 10 + ((f.i * 5) % 10);
        f.len = Math.max(36, f.len); f.h = Math.max(18, f.h * 0.9);
      }
    }
    if (f.x < -20) {
      fs.splice(k, 1);
      const gp = b.fryGroups[f.group];
      if (gp) {
        gp.left--;
        if (!gp.leaked) { gp.leaked = true; if (b.chain > 0) emit(world, { type: 'chainBreak', x: 0, y: f.y, chain: b.chain }); b.chain = 0; b.chainT = 0; }
        groupDone(world, b, gp, f);
      }
    }
  }
}

function dropItem(world, b, x, y) {
  if (typeof player.spawnItem !== 'function') return;
  player.spawnItem(world, Math.max(20, Math.min(W - 20, x)), Math.min(SURFACE_Y - 12, y), ITEMS[b.itemN++ % ITEMS.length]);
}

function groupDone(world, b, gp, f) {
  if (gp.left > 0 || gp.done) return;
  gp.done = true;
  if (gp.kills >= gp.n) {
    stats(world).schoolsWiped++;
    const bonus = Math.round(((FRY.wipeBonus * gp.n) / 10) * (1 + Math.min(b.chain, 30) / 30) / 100) * 100;
    world.score += bonus;
    fxCall('scorePopup', world, Math.max(40, Math.min(W - 60, f.x)), Math.max(20, f.y - 10), bonus);
    if (!gp.noItem) dropItem(world, b, f.x, f.y); // submerged streams pay score only
    sfx('powerup');
    emit(world, { type: 'schoolWiped', x: f.x, y: f.y, bonus, size: gp.n, kind: 'fry' });
  } else {
    world.score += gp.kills * 50;
    emit(world, { type: 'schoolEscaped', left: gp.n - gp.kills });
  }
  delete b.fryGroups[gp.id];
}

const above = (f) => ((f.air && f.y < SURFACE_Y - 2) || f.swim) && f.x < W + 4;
export function hitFry(world, x, y, r) {
  const b = world.boss;
  for (const f of b.fry) {
    if (!above(f)) continue;
    const rr = 7 + r, dx = x - f.x, dy = y - f.y;
    if (dx * dx * 0.6 + dy * dy < rr * rr) return { kind: 'escort', part: 'fry', ref: f, mult: 1, x, y };
  }
  if (b.half === 1) for (const c of b.chimneys) {
    if (c.state !== 'ok') continue;
    const rr = 10 + r, dx = x - c.x, dy = y - (SURFACE_Y - 8);
    if (dx * dx + dy * dy < rr * rr) return { kind: 'chimney', part: 'chimney', ref: c, mult: 1, x, y };
  }
  return null;
}

export function damageFry(world, hit, dmg) {
  const b = world.boss;
  if (hit.kind === 'chimney') {
    const c = hit.ref;
    if (c.state !== 'ok') return;
    c.hp -= dmg; c.flash = 3; world.score += 5;
    if ((b.t & 3) === 0) fxCall('debris', world, hit.x, hit.y, world.fxRng.range(-1, 0.5), -world.fxRng.range(0.8, 1.8), '#5a4430');
    if (c.hp > 0) return;
    c.state = 'broken';
    fxCall('explode', world, c.x, SURFACE_Y - 10, 'medium', { debris: ['#5a4430', '#8a6c4a'] });
    fxCall('mudBurst', world, c.x, SURFACE_Y - 6);
    fxCall('mudChunk', world, c.x, SURFACE_Y - 12, -1, -2.5);
    sfx('explodeS');
    world.score += 2000;
    fxCall('scorePopup', world, c.x, SURFACE_Y - 24, 2000);
    spawnGroup(world, b, 3, c);
    dropItem(world, b, c.x, SURFACE_Y - 24);
    return;
  }
  const f = hit.ref;
  if (!f || f.dead) return;
  f.hp -= dmg; f.flash = 3; world.score += 10;
  if (f.hp > 0) return;
  f.dead = true;
  const k = b.fry.indexOf(f);
  if (k >= 0) b.fry.splice(k, 1);
  fxCall('explode', world, f.x, f.y, 'small', { debris: ['#5a4430', '#ff7a30'] });
  sfx('hit');
  b.chain++; b.chainT = 0;
  const st = stats(world);
  st.fishKills++; st.bestChain = Math.max(st.bestChain, b.chain);
  world.score += 300 + 20 * Math.min(b.chain, 40);
  emit(world, { type: 'fishKill', x: f.x, y: f.y, chain: b.chain });
  const gp = b.fryGroups[f.group];
  if (gp) { gp.kills++; gp.left--; groupDone(world, b, gp, f); }
}

export function fryBodyHit(world, x, y, r) {
  for (const f of world.boss.fry) {
    if (!above(f)) continue;
    const rr = 4 + r, dx = x - f.x, dy = y - f.y;
    if (dx * dx * 0.6 + dy * dy < rr * rr) return f;
  }
  return null;
}

export function killAllFry(world, b) {
  for (const f of b.fry) if (above(f)) fxCall('explode', world, f.x, f.y, 'small', { debris: false });
  b.fry.length = 0; b.fryGroups = {};
}

export function fryHazards(b, out) {
  for (const f of b.fry) if (above(f)) out.push({ x: f.x, y: f.y, vx: f.vx, vy: f.swim ? 0 : f.vy, r: 5, g: f.g, cause: 'skFry', atk: 0 });
}

export function fryTargets(b, out) {
  for (const f of b.fry) if (above(f)) out.push({ x: f.x, y: f.y, kind: 'fry' });
}

export function drawChimneys(ctx, b) {
  if (b.half !== 1 || b.chimneysGone) return;
  const A = getSkArt();
  for (const c of b.chimneys) {
    const s = c.state === 'ok' ? A.chimney.ok : A.chimney.broken;
    const x = Math.round(c.x - s.w / 2), y = SURFACE_Y + 5 - s.h;
    ctx.drawImage(s.img, x, y, s.w, s.h);
    if (c.flash > 0 && (b.t & 1)) { ctx.globalAlpha = 0.4; ctx.fillStyle = '#fff'; ctx.fillRect(x + 6, y + 4, s.w - 12, s.h - 6); ctx.globalAlpha = 1; }
    if (c.state === 'ok' && c.puff > 0) {
      ctx.fillStyle = '#6e563a';
      for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(c.x - 4 + ((i * 5 + b.t) % 9)), Math.round(y - 2 - ((20 - c.puff) * 0.6) - i * 2), 3, 3);
    }
  }
}

export function drawFry(ctx, world, b, S) {
  const s = S.hopper;
  for (const f of b.fry) {
    if ((!f.air && !f.swim) || f.x > W + 8) continue;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    if (!f.swim) ctx.rotate(-Math.atan2(f.vy, -f.vx) * 0.8);
    else ctx.globalAlpha = 0.85;
    ctx.scale(0.8, 0.8);
    const img = f.flash > 0 && (b.t & 1) && s.white ? s.white : s.img, ds = s.detailScale || 1;
    ctx.drawImage(img, -s.px, -s.py, img.width / ds, img.height / ds);
    ctx.restore();
  }
}
