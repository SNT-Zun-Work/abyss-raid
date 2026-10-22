// Player weapons (four gauges + bomb):
//   LASER  (red item)    main forward shot: twin bolts → heavy twin → laser beam
//   W WAVE (green item)  wide spread of green crescent waves
//   HOMING (blue item)   homing missiles from above/below the ship
//   ABYSS BURST (bomb)   limited stock: implosion → screen-wide shockwave that
//                        cancels bullets to score and damages the boss
// Shots live in world.pShots; collisions go through boss.hitTest/applyDamage.
// Owned by the player agent.
import { W, H } from '../config.js';
import { swapRemove, TAU } from '../core/util.js';
import * as boss from './boss.js';
import * as fx from './fx.js';
import * as audio from './audio.js';
import * as bullets from './bullets.js';
import { art, waveFor } from './player-art.js';

export const LASER_MAX = 8, WAVE_MAX = 8, HOMING_MAX = 8, BURST_MAX = 3;

// dmg per projectile, cool = frames between volleys. dps assumes every shot hits.
export const LASER = [
  null,
  { form: 'bolt', heavy: 0, cool: 7, dmg: 1.0, gap: 3, spd: 8 },    // 1  twin            ≈17 dps
  { form: 'bolt', heavy: 0, cool: 6, dmg: 1.1, gap: 3, spd: 8.5 },  // 2  twin            ≈22
  { form: 'bolt', heavy: 1, cool: 6, dmg: 1.4, gap: 4, spd: 8.5 },  // 3  heavy twin      ≈28
  { form: 'bolt', heavy: 1, cool: 5, dmg: 1.5, gap: 4, spd: 9 },    // 4  heavy twin      ≈36
  { form: 'laser', k: 0, cool: 3, dmg: 2.0, spd: 11 },              // 5  laser beam      ≈40
  { form: 'laser', k: 0, cool: 3, dmg: 2.3, spd: 11 },              // 6  laser beam      ≈46
  { form: 'laser', k: 1, cool: 3, dmg: 2.6, spd: 12, side: 0.6 },   // 7  wide + side     ≈61
  { form: 'laser', k: 1, cool: 3, dmg: 3.0, spd: 12, side: 0.6 },   // 8  wide + side     ≈69
];
export const WAVE = [
  null,
  { angs: [-0.12, 0.12], cool: 20, dmg: 1.6, h1: 14 },
  { angs: [-0.15, 0.15], cool: 16, dmg: 1.7, h1: 16 },
  { angs: [-0.2, 0, 0.2], cool: 16, dmg: 1.8, h1: 16 },
  { angs: [-0.2, 0, 0.2], cool: 13, dmg: 1.9, h1: 18 },
  { angs: [-0.3, -0.1, 0.1, 0.3], cool: 13, dmg: 2.0, h1: 20 },
  { angs: [-0.36, -0.18, 0, 0.18, 0.36], cool: 12, dmg: 2.0, h1: 20 },
  { angs: [-0.36, -0.18, 0, 0.18, 0.36], cool: 11, dmg: 2.2, h1: 24 },
  { angs: [-0.36, -0.18, 0, 0.18, 0.36], cool: 10, dmg: 2.4, h1: 28 },
];
export const HOMING = [
  null,
  { n: 1, cool: 50, dmg: 3 }, { n: 1, cool: 40, dmg: 3 }, { n: 2, cool: 44, dmg: 3 }, { n: 2, cool: 36, dmg: 3 },
  { n: 3, cool: 40, dmg: 3.5 }, { n: 3, cool: 32, dmg: 3.5 }, { n: 4, cool: 36, dmg: 3.5 }, { n: 4, cool: 28, dmg: 4 },
];
// Abyss Burst timeline (frames) and damage.
export const BURST = { implode: 22, expand: 64, fade: 26, maxR: 330, tickEvery: 3, tickDmg: 8, coreDmg: 24, guard: 100 };

const sfx = (n) => { if (typeof audio.sfx === 'function') audio.sfx(n); };
const fxc = (fn, ...a) => { if (typeof fx[fn] === 'function') fx[fn](...a); };

// ---------------------------------------------------------------- targets
function targets(world) {
  if (typeof boss.targets === 'function') {
    const t = boss.targets(world);
    if (t && t.length) return t;
  }
  const b = world.boss;
  return b && b.active && !b.defeated && b.x < W + 20 ? [{ x: b.x, y: b.y }] : [];
}

// ---------------------------------------------------------------- firing
export function fire(world) {
  const p = world.player;
  if (p.cool > 0) p.cool--;
  if (p.waveCool > 0) p.waveCool--;
  if (p.homingCool > 0) p.homingCool--;
  if (!world.input.shot || world.inputLocked) return;
  const nx = p.x + 13, ny = Math.round(p.y);
  if (p.cool === 0 && p.laserLv > 0) {
    const m = LASER[p.laserLv];
    if (m.form === 'bolt') {
      for (const s of [-1, 1]) world.pShots.push({ kind: 'bolt', heavy: m.heavy, x: nx, y: ny + s * m.gap, vx: m.spd, vy: 0, dmg: m.dmg, t: 0 });
    } else {
      world.pShots.push({ kind: 'laser', k: m.k, x: nx + 4, y: ny, vx: m.spd, vy: 0, dmg: m.dmg, t: 0 });
      if (m.side && (p.volley & 1) === 0) {
        for (const s of [-1, 1]) world.pShots.push({ kind: 'bolt', heavy: 0, x: nx - 6, y: ny + s * 8, vx: 9, vy: 0, dmg: m.side * 2, t: 0 });
      }
    }
    p.cool = m.cool;
    p.muzzle = 4;
    p.volley++;
    if (m.form === 'bolt' ? (p.volley & 1) : (p.volley % 4) === 0) sfx('shot');
  }
  if (p.waveCool === 0 && p.waveLv > 0) {
    const m = WAVE[p.waveLv];
    for (const a of m.angs) {
      world.pShots.push({ kind: 'wave', x: nx, y: ny, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, ang: a, dmg: m.dmg, h: 8, h1: m.h1, t: 0 });
    }
    p.waveCool = m.cool;
  }
  if (p.homingCool === 0 && p.homingLv > 0) {
    const m = HOMING[p.homingLv];
    for (let i = 0; i < m.n; i++) {
      const side = (p.homingSide = -(p.homingSide || 1)); // alternate top/bottom
      const a = side * (1.1 + Math.floor(i / 2) * 0.35);
      world.pShots.push({ kind: 'homing', x: p.x - 2, y: p.y + side * 4, ang: a, spd: 1.8, vx: 0, vy: 0, dmg: m.dmg, t: 0, trail: [] });
    }
    p.homingCool = m.cool;
    sfx('missile');
  }
}

// ---------------------------------------------------------------- shots
function hitBoss(world, x, y, r) {
  return typeof boss.hitTest === 'function' ? boss.hitTest(world, x, y, r) : null;
}
function impact(world, x, y, big) {
  const p = world.player;
  p.impacts.push({ x, y, t: 0, big });
  if (p.impacts.length > 24) p.impacts.shift();
  fxc('spark', world, x, y, Math.PI + world.fxRng.range(-0.6, 0.6));
}

export function updateShots(world) {
  const s = world.pShots;
  let tg = null;
  for (let i = s.length - 1; i >= 0; i--) {
    const b = s[i];
    b.t++;
    if (b.kind === 'homing') {
      if (b.t > 8) {
        if (!tg) tg = targets(world);
        let best = null, bd = 1e9;
        for (const q of tg) { const d = (q.x - b.x) ** 2 + (q.y - b.y) ** 2; if (d < bd) { bd = d; best = q; } }
        if (best) {
          let da = Math.atan2(best.y - b.y, best.x - b.x) - b.ang;
          da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
          b.ang += Math.max(-0.11, Math.min(0.11, da));
        } else {
          b.ang *= 0.94; // no target: straighten out forward
        }
      } else b.ang *= 0.9;
      b.spd = Math.min(5.5, b.spd + 0.22);
      b.vx = Math.cos(b.ang) * b.spd + (b.t < 10 ? 0.6 : 0);
      b.vy = Math.sin(b.ang) * b.spd;
      b.trail.push(b.x, b.y);
      if (b.trail.length > 10) b.trail.splice(0, 2);
      if (b.t > 160) { swapRemove(s, i); continue; }
    }
    b.x += b.vx; b.y += b.vy;
    if (b.kind === 'wave' && b.h < b.h1) b.h = Math.min(b.h1, b.h + 1.2);
    if (b.x > W + 30 || b.x < -24 || b.y < -24 || b.y > H + 24) { swapRemove(s, i); continue; }

    let hit = null;
    if (b.kind === 'wave') {
      const half = b.h / 2, ca = Math.cos(b.ang), sa = Math.sin(b.ang);
      const n = Math.max(2, Math.ceil(b.h / 8));
      for (let k = 0; k <= n && !hit; k++) {
        const vn = -1 + (2 * k) / n, back = 4 * vn * vn, v = vn * half;
        const hx = b.x - back * ca - v * sa, hy = b.y - back * sa + v * ca;
        hit = hitBoss(world, hx, hy, 3);
        if (hit) { b.hx = hx; b.hy = hy; }
      }
    } else if (b.kind === 'laser') {
      const r = b.k ? 4 : 3;
      hit = hitBoss(world, b.x, b.y, r);
      if (hit) { b.hx = b.x; b.hy = b.y; }
      else {
        hit = hitBoss(world, b.x - 14, b.y, r);
        if (hit) { b.hx = b.x - 14; b.hy = b.y; }
      }
    } else {
      hit = hitBoss(world, b.x, b.y, b.kind === 'homing' ? 3 : 2);
      if (hit) { b.hx = b.x; b.hy = b.y; }
    }
    if (hit) {
      hit.source = b.kind; // 'bolt'|'laser'|'wave'|'homing'
      boss.applyDamage(world, hit, b.dmg);
      if (b.kind === 'homing') { fxc('explode', world, b.x, b.y, 'small'); sfx('hit'); }
      impact(world, b.hx, b.hy, b.kind !== 'bolt');
      swapRemove(s, i);
    }
  }
  const im = world.player.impacts;
  for (let i = im.length - 1; i >= 0; i--) if (++im[i].t > 6) im.splice(i, 1);
}

export function drawShots(ctx, world) {
  const A = art();
  for (const b of world.pShots) {
    if (b.kind !== 'homing') continue;
    const tr = b.trail;
    for (let j = 0; j < tr.length; j += 2) {
      const k = j / tr.length;
      ctx.fillStyle = k < 0.4 ? 'rgba(150,200,255,0.35)' : 'rgba(220,240,255,0.7)';
      const sz = k < 0.5 ? 1 : 2;
      ctx.fillRect(Math.round(tr[j]) - (sz >> 1), Math.round(tr[j + 1]) - (sz >> 1), sz, sz);
    }
    const d = ((Math.round((b.ang / TAU) * 16) % 16) + 16) % 16;
    ctx.drawImage(A.homing[d], Math.round(b.x) - 6, Math.round(b.y) - 6);
  }
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (const b of world.pShots) {
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.kind === 'bolt') {
      const sp = A.bolt[b.heavy ? 1 : 0];
      ctx.drawImage(sp, x - sp.width + 1, y - (sp.height >> 1));
    } else if (b.kind === 'laser') {
      const sp = A.laser[b.k];
      ctx.drawImage(sp, x - sp.width + 1, y - (sp.height >> 1));
    } else if (b.kind === 'wave') {
      const sp = waveFor(b.h, b.ang);
      ctx.drawImage(sp, x - (sp.width >> 1), y - (sp.height >> 1));
    } else if (b.kind === 'homing' && (b.t & 2)) {
      ctx.fillStyle = '#9ad8ff';
      ctx.fillRect(Math.round(b.x - Math.cos(b.ang) * 5), Math.round(b.y - Math.sin(b.ang) * 5), 1, 1);
    }
  }
  ctx.globalCompositeOperation = prev;
  for (const m of world.player.impacts) {
    const r = (m.big ? 6 : 4) - m.t * 0.6;
    if (r <= 0) continue;
    ctx.fillStyle = m.t < 2 ? '#ffffff' : '#9ae8ff';
    ctx.fillRect(Math.round(m.x - r), Math.round(m.y), Math.round(r * 2), 1);
    ctx.fillRect(Math.round(m.x), Math.round(m.y - r), 1, Math.round(r * 2));
    if (m.t < 3) ctx.fillRect(Math.round(m.x) - 1, Math.round(m.y) - 1, 3, 3);
  }
}

// ---------------------------------------------------------------- abyss burst
export function launchBurst(world) {
  const p = world.player;
  if (p.burst || p.burstStock <= 0 || !p.alive || p.entering > 0 || world.inputLocked) return false;
  p.burstStock--;
  const x = Math.min(W - 60, p.x + 46), y = p.y;
  const parts = [];
  for (let i = 0; i < 40; i++) {
    const r = world.fxRng.range(40, 120);
    parts.push({ a: world.fxRng.range(0, TAU), r, w: world.fxRng.range(-0.03, 0.03), hot: world.fxRng.next() < 0.35 });
  }
  p.burst = { x, y, t: 0, r: 0, parts, bubbles: [], cancelled: 0 };
  sfx('bomb');
  return true;
}

// true while the burst protects the player (playerHitbox → null)
export function burstGuard(world) {
  const b = world.player.burst;
  return !!b && b.t < BURST.guard;
}

export function updateBurst(world) {
  const p = world.player, bu = p.burst;
  if (!bu) return;
  bu.t++;
  const t = bu.t, T0 = BURST.implode, T1 = T0 + BURST.expand, T2 = T1 + BURST.fade;
  if (t < T0) {
    if (typeof bullets.vortex === 'function') bu.cancelled += bullets.vortex(world, bu.x, bu.y, 70, 0.45, 10);
  } else if (t === T0) {
    world.flash = Math.max(world.flash, 0.6);
    world.hitstop = Math.max(world.hitstop, 4);
    fxc('addShake', world, 7);
    fxc('explode', world, bu.x, bu.y, 'large');
    sfx('explodeL');
    const hit = hitBoss(world, bu.x, bu.y, 30);
    if (hit) { hit.source = 'burst'; boss.applyDamage(world, hit, BURST.coreDmg); }
  }
  if (t >= T0 && t < T1) {
    const k = (t - T0) / BURST.expand;
    bu.r = BURST.maxR * (1 - (1 - k) ** 2.2);
    if (typeof bullets.vortex === 'function') bu.cancelled += bullets.vortex(world, bu.x, bu.y, bu.r, 0, bu.r);
    if ((t - T0) % BURST.tickEvery === 0) {
      let hit = null, hx = 0, hy = 0;
      for (let k2 = 0; k2 < 16 && !hit; k2++) {
        const a = (k2 / 16) * TAU;
        hx = bu.x + Math.cos(a) * bu.r; hy = bu.y + Math.sin(a) * bu.r;
        hit = hitBoss(world, hx, hy, 8);
      }
      if (hit) {
        hit.source = 'burst';
        boss.applyDamage(world, hit, BURST.tickDmg);
        fxc('spark', world, hx, hy, world.fxRng.range(0, TAU));
      }
    }
    if ((t & 1) === 0 && bu.bubbles.length < 90) {
      for (let j = 0; j < 4; j++) {
        const a = world.fxRng.range(0, TAU);
        bu.bubbles.push({ x: bu.x + Math.cos(a) * bu.r, y: bu.y + Math.sin(a) * bu.r, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6 - 0.4, t: 0, s: world.fxRng.next() < 0.3 ? 2 : 1 });
      }
    }
  }
  if (t < T0) for (const q of bu.parts) { q.r *= 0.9; q.a += q.w + 0.05; }
  for (let i = bu.bubbles.length - 1; i >= 0; i--) {
    const q = bu.bubbles[i];
    q.t++; q.x += q.vx; q.y += q.vy; q.vy -= 0.03; q.vx *= 0.96;
    if (q.t > 40) swapRemove(bu.bubbles, i);
  }
  if (t >= T2) p.burst = null;
}

export function drawBurst(ctx, world) {
  const bu = world.player.burst;
  if (!bu) return;
  const A = art();
  const t = bu.t, T0 = BURST.implode, T1 = T0 + BURST.expand;
  const x = Math.round(bu.x), y = Math.round(bu.y);
  ctx.save();
  if (t < T0) {
    const k = t / T0;
    ctx.fillStyle = `rgba(0,8,30,${0.35 * k})`;
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (const q of bu.parts) {
      ctx.strokeStyle = q.hot ? '#ffffff' : '#5cc8ff';
      const r2 = q.r * 1.35 + 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(q.a) * q.r, y + Math.sin(q.a) * q.r);
      ctx.lineTo(x + Math.cos(q.a) * r2, y + Math.sin(q.a) * r2);
      ctx.stroke();
    }
    const cs = Math.round(20 + 44 * k * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(A.burstCore, x - (cs >> 1), y - (cs >> 1), cs, cs);
  } else {
    const fade = t < T1 ? 1 : Math.max(0, 1 - (t - T1) / BURST.fade);
    const r = bu.r;
    // calm, cleared water inside the front
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.10 * fade;
    ctx.fillStyle = '#3aa0ff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.5 * fade;
    ctx.strokeStyle = '#020a24';
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r - 10), 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = '#2a8cff';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r - 3), 0, TAU); ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#bff6ff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.6 * fade;
    ctx.strokeStyle = '#62ccff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r * 0.62), 0, TAU); ctx.stroke();
    if (t < T0 + 18) {
      const k = (t - T0) / 18;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#e8feff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.13;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
        ctx.lineTo(x + Math.cos(a) * (30 + r * 0.8), y + Math.sin(a) * (30 + r * 0.8));
        ctx.stroke();
      }
    }
    const ck = Math.max(0, 1 - (t - T0) / 30);
    ctx.globalCompositeOperation = 'source-over';
    if (ck > 0) {
      ctx.globalAlpha = 1;
      const cs = Math.round(64 * (0.6 + ck * 0.6));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(A.burstCore, x - (cs >> 1), y - (cs >> 1), cs, cs);
    }
    for (const q of bu.bubbles) {
      ctx.globalAlpha = Math.max(0, 1 - q.t / 40) * fade;
      ctx.fillStyle = q.s > 1 ? '#bff6ff' : '#7fd8ff';
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.s, q.s);
    }
  }
  ctx.restore();
}
