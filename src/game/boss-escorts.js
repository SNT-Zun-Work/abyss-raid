// SCHOOLS of mecha-axolotl fry (fun pass "school wipe"). Owned by the boss agent.
//
// Every few seconds a school of 15-25 small fry (~22-26 px, same design as the
// boss) streams in from the right in a readable formation: ribbon stream,
// S-curve, vortex (rotating rings), or split pincer (top + bottom). Fry die in
// 1-2 laser-1 hits; a few designated "gunners" (red glow) fire one aimed shot
// each, the rest are fodder that only hurt you if you sit in their path.
// Kills build a CHAIN (resets after FRY.chainGap frames without a kill, or when
// a school escapes). Wiping a whole school pays a bonus and a guaranteed item.
//
// Events: fishKill {x,y,chain}, schoolWiped {x,y,bonus,size}, schoolEscaped {left}.
// world.stats: fishKills, bestChain, schoolsWiped.
//
// Export names are kept from the old escorts (initEscorts, updateEscorts, …);
// b.escorts holds the live fry ({x, y, …}) — boss.targets() lists them.
import { W, H } from '../config.js';
import * as bullets from './bullets.js';
import { FRY_DIRS } from './boss-parts.js';
import { sfx, fxCall, aimAt } from './boss-util.js';
import { dropItem, DIFFICULTY } from './boss.js';
import { STRONG, BIG } from './boss-attacks.js';
import { emit } from './world.js';

// ---- tunables --------------------------------------------------------------
export const FRY = {
  hp: [1.2, 1.9],          // small / large fry (laser-1 bolt = 1.0 dmg)
  firstAt: 110,            // frames after the boss entry starts (+40) → first school ≈3 s into the fight
  every: { 1: [360, 480], 2: [480, 600], 3: [540, 660] }, // frames between schools (6-8 s early, 9-11 s later)
  size: [15, 25],
  gunners: [1, 3],
  gunSpd: 1.5,
  chainGap: 45,
  wipeBonus: 10000,        // × size/20 × (1 + min(chain,40)/40)
};
const FORM_CYCLE = ['ribbon', 'pincer', 'scurve', 'vortex', 'ribbon', 'scurve'];
const DEBRIS = ['#d8dde6', '#e07090'];

export function initEscorts(b) {
  b.escorts = [];
  b.schoolN = 0;
  b.schoolT = FRY.firstAt;
  b.schools = {};
  b.chain = 0;
  b.chainT = 0;
}

const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

function spawnSchool(world, b) {
  const R = world.rng;
  const id = b.schoolN++;
  const form = id === 0 ? 'ribbon' : FORM_CYCLE[(id + R.int(0, 2)) % FORM_CYCLE.length];
  const n = R.int(FRY.size[0], FRY.size[1]);
  const top = R.next() < 0.5;
  const sc = { id, form, n, kills: 0, left: n, t: 0, top };
  // formation parameters (positions are a pure function of school time → deterministic)
  sc.v = form === 'vortex' ? 1.15 : 1.55;
  sc.delay = form === 'vortex' ? 0 : form === 'pincer' ? 14 : form === 'scurve' ? 9 : 10;
  sc.yIn = top ? 30 : H - 26;
  sc.yMid = form === 'scurve' ? (top ? H - 60 : 60) : top ? R.range(64, 96) : R.range(H - 96, H - 64);
  sc.amp = form === 'scurve' ? 16 : form === 'vortex' ? 6 : 12;
  sc.w = form === 'scurve' ? 0.035 : 0.07;
  sc.ph = R.range(0, 6.28);
  b.schools[id] = sc;
  const gun = new Set();
  const gn = (DIFFICULTY[b.phase] && DIFFICULTY[b.phase].gunners) || FRY.gunners;
  const ng = R.int(gn[0], gn[1]);
  while (gun.size < ng) gun.add(R.int(2, n - 1));
  for (let i = 0; i < n; i++) {
    const big = i % 5 === 0;
    b.escorts.push({ id, i, x: W + 40, y: sc.yIn, vx: -1, vy: 0, hp: FRY.hp[big ? 1 : 0], big, gunner: gun.has(i), fired: false, flash: 0, t: 0, alive: true, on: false });
  }
}

// position of fry i of school sc at school time T (null = not entered yet)
function fryPos(sc, i, T) {
  let tau, side = 0;
  if (sc.form === 'pincer') { side = i % 2; tau = T - Math.floor(i / 2) * sc.delay; } else tau = T - i * sc.delay;
  if (tau < 0) return null;
  let x = W + 24 - sc.v * tau;
  const u = Math.max(0, Math.min(1, (W * 0.5 - x) / 110));
  const s = u * u * (3 - 2 * u);
  let yIn = sc.yIn, yMid = sc.yMid;
  if (sc.form === 'pincer') { yIn = side ? H - 26 : 30; yMid = side ? H / 2 + 30 : H / 2 - 30; }
  let y = yIn + (yMid - yIn) * s + Math.sin(tau * sc.w + sc.ph) * sc.amp * (0.4 + 0.6 * s);
  if (sc.form === 'vortex') {
    const ring = i < 10 ? 0 : 1, k = ring ? i - 10 : i, m = ring ? sc.n - 10 : Math.min(10, sc.n);
    const r = (ring ? 13 : 24) * (0.6 + 0.4 * s);
    const a = (k / m) * Math.PI * 2 + T * (ring ? -0.06 : 0.045);
    x += Math.cos(a) * r; y += Math.sin(a) * r;
  }
  if (sc.form !== 'vortex') y += ((i % 3) - 1) * 6; // staggered so a stream reads as a school, not a rope
  return { x, y: Math.max(12, Math.min(H - 12, y)) };
}

export function updateEscorts(world, b) {
  // strong attacks (telegraph → end) and stuns: no new schools' gunfire / spawns
  const busy = !!(b.atk && STRONG.has(b.atk.name));
  const calm = b.calmT > 0 || b.mode === 'stun' || busy;
  const active = b.mode === 'fight' || b.mode === 'stun' || (b.mode === 'entry' && b.modeT > 40);
  if (active && !busy && --b.schoolT <= 0) {
    spawnSchool(world, b);
    const e = FRY.every[b.phase] || FRY.every[1];
    b.schoolT = world.rng.int(e[0], e[1]);
  }
  if (b.chain > 0 && ++b.chainT > FRY.chainGap) b.chain = 0;
  for (const id in b.schools) b.schools[id].t++;
  const es = b.escorts;
  for (let k = es.length - 1; k >= 0; k--) {
    const e = es[k];
    const sc = b.schools[e.id];
    if (!sc) { es.splice(k, 1); continue; }
    // spectacle attack: the school scatters off-screen (harmless) so SAFE zones stay safe
    if (b.atk && BIG.has(b.atk.name) && e.on && !e.flee) { e.flee = true; e.fvy = e.y < H / 2 ? -2.2 : 2.2; sc.fled = true; }
    if (e.flee) {
      e.t++; e.vx = 1.2; e.vy = e.fvy; e.x += e.vx; e.y += e.vy;
      if (e.y < -20 || e.y > H + 20) { es.splice(k, 1); sc.left--; checkSchoolDone(world, b, sc, e); }
      continue;
    }
    const p = fryPos(sc, e.i, sc.t);
    if (!p) continue;
    e.t++;
    if (e.flash > 0) e.flash--;
    if (e.t > 1) { e.vx = p.x - e.x; e.vy = p.y - e.y; }
    e.x = p.x; e.y = p.y;
    e.on = e.x < W + 8;
    if (e.gunner && !e.fired && !calm && e.x < W - 40 && e.x > 150 && b.mode !== 'death') {
      e.fired = true;
      const a = aimAt(world, e.x - 6, e.y);
      bullets.fire(world, { x: e.x - 6, y: e.y, vx: Math.cos(a) * FRY.gunSpd, vy: Math.sin(a) * FRY.gunSpd, type: 'orb', color: 'red', cause: 'fryShot', atk: 0 });
    }
    if (e.x < -24) {
      es.splice(k, 1); sc.left--;
      if (!sc.leaked) {
        sc.leaked = true;
        if (b.chain > 0) emit(world, { type: 'chainBreak', x: 0, y: e.y, chain: b.chain });
        b.chain = 0; b.chainT = 0;
      }
      checkSchoolDone(world, b, sc, e);
    }
  }
}

function checkSchoolDone(world, b, sc, e) {
  if (sc.left > 0 || sc.done) return;
  sc.done = true;
  if (sc.fled && sc.kills < sc.n) { delete b.schools[sc.id]; return; } // scattered by a spectacle attack: no penalty
  if (sc.kills >= sc.n) {
    const st = stats(world);
    st.schoolsWiped++;
    const bonus = Math.round(((FRY.wipeBonus * sc.n) / 20) * (1 + Math.min(b.chain, 40) / 40) / 100) * 100;
    world.score += bonus;
    const x = Math.max(40, Math.min(W - 60, e.x)), y = Math.max(20, e.y - 10);
    fxCall('scorePopup', world, x, y, bonus);
    fxCall('explode', world, e.x, e.y, 'medium', { debris: DEBRIS });
    dropItem(world, Math.max(20, Math.min(W - 20, e.x)), e.y); // guaranteed every wipe
    sfx('powerup');
    emit(world, { type: 'schoolWiped', x: e.x, y: e.y, bonus, size: sc.n });
  } else {
    world.score += sc.kills * 50; // partial catch: small consolation score, no item
    emit(world, { type: 'schoolEscaped', left: sc.n - sc.kills });
  }
  delete b.schools[sc.id];
}

export function hitEscort(world, x, y, r) {
  const es = world.boss.escorts;
  for (let k = 0; k < es.length; k++) {
    const e = es[k];
    if (!e.on) continue;
    const rr = (e.big ? 6 : 5) + r;
    const dx = x - e.x, dy = y - e.y;
    if (dx * dx * 0.5 + dy * dy < rr * rr) return { kind: 'escort', part: 'fry', ref: e, mult: 1, x, y };
  }
  return null;
}

export function damageEscort(world, hit, dmg) {
  const b = world.boss, e = hit.ref;
  if (!e || !e.alive) return;
  e.hp -= dmg;
  e.flash = 3;
  world.score += 10;
  if (e.hp > 0) return;
  e.alive = false;
  const k = b.escorts.indexOf(e);
  if (k >= 0) b.escorts.splice(k, 1);
  // crisp pop: small blast + a light hull/fin fragment
  fxCall('explode', world, e.x, e.y, 'small', { debris: DEBRIS });
  fxCall('debris', world, e.x, e.y, world.fxRng.range(-1.2, 0.4), world.fxRng.range(-1.6, -0.4), e.i & 1 ? '#e07090' : '#d8dde6');
  sfx('hit');
  b.chain++; b.chainT = 0;
  const st = stats(world);
  st.fishKills++;
  st.bestChain = Math.max(st.bestChain, b.chain);
  world.score += 200 + 20 * Math.min(b.chain, 50);
  emit(world, { type: 'fishKill', x: e.x, y: e.y, chain: b.chain });
  const sc = b.schools[e.id];
  if (sc) { sc.kills++; sc.left--; checkSchoolDone(world, b, sc, e); }
}

export function escortBodyHit(world, x, y, r) {
  for (const e of world.boss.escorts) {
    if (!e.on || e.flee) continue;
    const dx = x - e.x, dy = y - e.y;
    const rr = (e.big ? 4 : 3) + r;
    if (dx * dx * 0.5 + dy * dy < rr * rr) return e;
  }
  return null;
}

export function killAllEscorts(world, b) {
  for (const e of b.escorts) if (e.on) fxCall('explode', world, e.x, e.y, 'small', { debris: false });
  b.escorts.length = 0;
  b.schools = {};
}

export function drawEscorts(ctx, world, b, S) {
  const es = b.escorts;
  if (!es.length) return;
  for (const e of es) {
    if (!e.on) continue;
    const set = S.fry[e.big ? 1 : 0];
    const ang = Math.atan2(e.vy, e.vx);
    const d = ((Math.round((ang / (Math.PI * 2)) * FRY_DIRS) % FRY_DIRS) + FRY_DIRS) % FRY_DIRS;
    const w = ((e.t >> 3) + e.i) % 4;
    const fr = set.frames[d][w === 3 ? 1 : w];
    ctx.drawImage(e.flash > 0 && (b.t & 1) ? fr.white : fr.img, Math.round(e.x) - fr.h, Math.round(e.y) - fr.h);
    if (e.gunner && !e.fired) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(b.t * 0.3 + e.i);
      ctx.drawImage(S.redLight, Math.round(e.x) - 4, Math.round(e.y) - 4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}
