// PERIOPHTHALMUS (ZONE G) attacks, gravity projectiles, shockwaves, tidal wave.
// Owned by the boss agent. Each attack: (world, b, atk) → true when finished.
// Mud balls live in b.mud (own physics: gravity, slowed under the water);
// b.hazards mirrors them for the bots. Every hazard carries cause + atk.
import { W, H } from '../config.js';
import { clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, hurtPlayer, aimAt } from './boss-util.js';
import { DIFFICULTY, SURFACE_Y, PERCH_Y, HOME_L, HOME_R, stepLeap, splash, toWorld, eyePos } from './boss-mudskipper.js';
import { spawnFlock } from './boss-mudskipper-gulls.js';

export const MPOOLS = {
  1: ['lob', 'eyeShot', 'hop', 'gulls', 'flak', 'skyLeap'],
  2: ['leap', 'skyLeap', 'dive', 'gulls', 'eyeShot', 'lob', 'hop'],
  3: ['flak', 'geyser', 'shockHop', 'doubleLeap', 'dive', 'skyLeap', 'gulls'],
  4: ['glideLeap', 'mudRain', 'flak', 'geyser', 'dive', 'gulls', 'skyLeap'],
};
// where each attack applies pressure; the scheduler alternates TOP and LOW beats
// so the ship has to move vertically through the fight
export const MTAG = {
  lob: 'top', flak: 'top', gulls: 'top', skyLeap: 'top', leap: 'top', doubleLeap: 'top', glideLeap: 'top', mudRain: 'top',
  eyeShot: 'mid', geyser: 'col', hop: 'low', shockHop: 'low', dive: 'low', tidalWave: 'all',
};
export const MBIG = new Set(['tidalWave', 'mudRain']);
// strong attacks: need a quiet screen to start; hoppers don't spawn and gunners hold fire while they run
export const MSTRONG = new Set(['tidalWave', 'mudRain', 'skyLeap', 'gulls', 'flak', 'geyser']);
const D = (b) => DIFFICULTY[b.phase];
// contact extent of the perched body around root x: head side ~84 px, tail side ~86 px (+8 margin)
export function landing(x, f, k) { return { x, k, l: x - (f > 0 ? 92 : 94), r: x + (f > 0 ? 94 : 92) }; }
export const WAVE_W = 56; // tidal wave thickness (all of it is dangerous)
const homeX = (b) => (b.home === 'L' ? HOME_L : HOME_R);
const hint = (b, atk, cause, text, rects = []) => {
  b.safeHint = { cause, atk: atk.id, text, rects: rects.map((q) => {
    const x = Math.max(0, q.x), y = Math.max(0, q.y), w = Math.min(W, q.x + q.w) - x, h = Math.min(H, q.y + q.h) - y;
    return w > 2 && h > 2 ? { x, y, w, h } : null;
  }).filter(Boolean) };
};

// ballistic lob from (x0,y0) to pass through (tx,ty) after T frames under gravity g
function lob(world, b, atk, x0, y0, tx, ty, T, extra = {}) {
  const g = D(b).grav;
  const vx = (tx - x0) / T, vy = (ty - y0 - 0.5 * g * T * T) / T;
  b.mud.push({ x: x0, y: y0, vx, vy, g, r: extra.big ? 6 : 4, cause: 'mudLob', atk: atk.id, tx, ty, mark: 1, ...extra });
}
const mouth = (b) => toWorld(b, -60, 8);
const target = (world) => { const p = world.player; return p && p.alive ? { x: p.x, y: p.y } : { x: 60, y: 100 }; };

// safe rects under a leap arc: per 24px column, everything below the body's lowest
// point (+margin) and above the surface; landing zone excluded
function arcRects(L, land) {
  const rects = [];
  for (let x = 0; x < W; x += 24) {
    if (x + 24 > land.l && x < land.r) continue;
    let low = -1e9, inside = false;
    for (let k = 0; k <= 20; k++) {
      const u = k / 20, ax = L.x0 + (L.x1 - L.x0) * u;
      if (ax < x - 60 || ax > x + 84) continue;
      inside = true;
      low = Math.max(low, L.y0 + (L.y1 - L.y0) * u - 4 * L.h * u * (1 - u) + 44);
    }
    rects.push(inside ? { x, y: low + 6, w: 24, h: SURFACE_Y - 16 - low } : { x, y: 0, w: 24, h: SURFACE_Y - 14 });
  }
  return rects;
}

function shockPair(world, b, x, atk) {
  const d = D(b);
  if (!d.shock) return;
  b.shocks.push({ x: x - 20, vx: -d.shockSpd, atk: atk.id, t: 0 }, { x: x + 20, vx: d.shockSpd, atk: atk.id, t: 0 });
  sfx('rumble');
}
function spray(world, b, atk, x, n, cause = 'mudSpray') {
  const g = D(b).grav;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.28;
    const s = 3.1 + (k % 2) * 0.5;
    b.mud.push({ x, y: SURFACE_Y - 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g, r: 4, cause, atk: atk.id });
  }
}

export const MATTACKS = {
  // jaw opens, volleys of lobbed mud arcing onto/around the ship (landing marks shown)
  lob(world, b, atk) {
    const d = D(b);
    b.jawT = atk.t < 24 + d.lobVolleys * 26 ? 1 : 0;
    b.eyeUpT = 1;
    if (atk.t === 0) hint(b, atk, 'mudLob', 'Watch the cyan landing marks - step aside before the mud falls');
    if (atk.t >= 24 && (atk.t - 24) % 26 === 0 && (atk.t - 24) / 26 < d.lobVolleys) {
      const m = mouth(b), tg = target(world);
      for (let k = 0; k < d.lobN; k++) {
        const off = (k - (d.lobN - 1) / 2) * 26;
        const T = 66 + k * 7;
        const big = d.shock && k === ((d.lobN - 1) >> 1);
        lob(world, b, atk, m.x, m.y, clamp(tg.x + off, 8, W - 8), tg.y, T, big ? { big: true, shock: true } : {});
      }
      sfx('missile');
    }
    return atk.t >= 24 + d.lobVolleys * 26 + 20;
  },
  // eyes pop up and flash (tell), then fire aimed fans
  eyeShot(world, b, atk) {
    const d = D(b);
    b.eyeUpT = 1;
    const live = b.eyes.filter((e) => e.state === 'ok').length;
    if (!live) return MATTACKS.lob(world, b, atk);
    const T0 = 34, iv = 16, end = T0 + d.eyeBursts * iv;
    atk.tell = atk.t < T0 ? ((atk.t >> 2) & 1) * 0.8 : 0;
    if (atk.t === 0) hint(b, atk, 'mudEye', 'Eyes flash cyan, then fire aimed fans: sidestep each fan - shoot the raised eyes');
    if (atk.t >= T0 && atk.t < end && (atk.t - T0) % iv === 0) {
      b.eyes.forEach((e, i) => {
        if (e.state !== 'ok') return;
        const p = eyePos(b, i);
        const a0 = aimAt(world, p.x, p.y);
        for (let k = 0; k < d.eyeN; k++) {
          const a = a0 + (k - (d.eyeN - 1) / 2) * 0.17;
          bullets.fire(world, { x: p.x, y: p.y, vx: Math.cos(a) * 1.9 * d.spd, vy: Math.sin(a) * 1.9 * d.spd, type: 'orb', color: 'red', cause: 'mudEye', atk: atk.id });
        }
      });
    }
    return atk.t >= end + 26;
  },
  // small hop near the perch, lobs at the apex
  hop(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      const hx = homeX(b);
      atk.L = { x0: b.x, y0: b.y, x1: clamp(hx + world.rng.range(-36, 36), 70, HOME_R + 20), y1: PERCH_Y, h: 46, T: 56, t: 0 };
      hint(b, atk, 'mudLob', 'It hops and throws mud at the top of the hop');
      b.landing = landing(atk.L.x1, b.f, 0);
    }
    stepLeap(world, b, atk.L);
    if (b.landing) b.landing.k = atk.L.t / atk.L.T;
    if (atk.L.t === 28) { const m = mouth(b), tg = target(world); for (let k = -1; k <= 1; k++) lob(world, b, atk, m.x, m.y, clamp(tg.x + k * 30, 8, W - 8), tg.y, 50); }
    if (atk.L.done && !atk.landed) { atk.landed = atk.t; b.landing = null; shockPair(world, b, b.x, atk); }
    return atk.landed && atk.t >= atk.landed + 16;
  },
  // a flock of MECH GULLS cruises in along the top and dives one by one
  gulls(world, b, atk) {
    if (atk.t === 0) { spawnFlock(world, b, atk); hint(b, atk, 'mudGull', 'Gulls flash cyan and show their dive path: move off it (or shoot them) - stay low'); }
    b.eyeUpT = 1;
    if (atk.t === 30 && b.phase >= 2) { const m = mouth(b), tg = target(world); lob(world, b, atk, m.x, m.y, tg.x, tg.y, 70); }
    return atk.t >= 70;
  },
  // SKY LEAP: a high, flat leap that sweeps the TOP band from one side to the other
  skyLeap(world, b, atk) {
    const d = D(b);
    const TELL = d.skyTell, SKY = 34;
    if (atk.t === 0) {
      const toLeft = b.home !== 'L';
      atk.x1 = toLeft ? HOME_L : HOME_R; atk.dir = toLeft ? -1 : 1; b.home = toLeft ? 'L' : 'R';
      sfx('bossRoar');
    }
    if (atk.sx === undefined) atk.sx = b.x;
    const zl = Math.min(atk.sx, atk.x1) , zr = Math.max(atk.sx, atk.x1);
    // rise/drop zones (full height near the start and landing points) + the flat top band
    b.skyBand = { y1: SKY + 50, k: Math.min(1, atk.t / TELL), on: atk.st !== 'land', zones: [[atk.sx - 96, atk.sx + 96], [atk.x1 - 96, atk.x1 + 96]] };
    hint(b, atk, 'mudSky', 'Sky leap: drop below the striped band and keep away from both striped ends', [{ x: zl + 100, y: SKY + 58, w: zr - zl - 200, h: SURFACE_Y - 16 - (SKY + 58) }]);
    if (atk.t < TELL) { b.y += 0.4; b.eyeUpT = 0; b.jawT = 1; return false; }
    if (!atk.st) { atk.st = 'rise'; atk.t0 = atk.t; atk.y0 = b.y; atk.x0 = b.x; }
    const px = b.x, py = b.y;
    if (atk.st === 'rise') {
      const u = Math.min(1, (atk.t - atk.t0) / 20);
      b.y = atk.y0 + (SKY - atk.y0) * (1 - (1 - u) * (1 - u)); b.x = atk.x0 + atk.dir * 30 * u;
      if (u >= 1) atk.st = 'fly';
    } else if (atk.st === 'fly') {
      b.x += atk.dir * d.skySpd; b.y = SKY + Math.sin(atk.t * 0.2) * 2;
      if (atk.dir < 0 ? b.x <= atk.x1 + 40 : b.x >= atk.x1 - 40) { atk.st = 'drop'; atk.t0 = atk.t; atk.y0 = b.y; atk.x0 = b.x; }
    } else if (atk.st === 'drop') {
      const u = Math.min(1, (atk.t - atk.t0) / 22);
      b.y = atk.y0 + (PERCH_Y - atk.y0) * u * u; b.x = atk.x0 + (atk.x1 - atk.x0) * u;
      if (u >= 1) { atk.st = 'land'; atk.t0 = atk.t; splash(b, b.x, 34, world); shockPair(world, b, b.x, atk); fxCall('addShake', world, 4); sfx('explodeS'); }
    }
    b.vx = b.x - px; b.vy = b.y - py;
    b.f = atk.dir < 0 ? 1 : -1;
    b.a += (Math.max(-0.6, Math.min(0.6, Math.atan2(-b.vy, Math.abs(b.vx) + 0.5) * 0.7)) - b.a) * 0.3;
    b.air = atk.st === 'rise' || atk.st === 'fly' || atk.st === 'drop';
    if (atk.st === 'land') { b.air = false; b.skyBand = null; return atk.t >= atk.t0 + 20; }
    return false;
  },
  // FLAK: shells lobbed to the ceiling that burst into falling shrapnel at their apex
  flak(world, b, atk) {
    const d = D(b);
    b.jawT = atk.t < 24 + d.flakN * 18 ? 1 : 0;
    if (atk.t === 0) hint(b, atk, 'mudFlak', 'Shells burst at the top into falling shrapnel: stay low and step out from under the blinking shell');
    if (atk.t >= 24 && (atk.t - 24) % 18 === 0 && (atk.t - 24) / 18 < d.flakN) {
      const m = mouth(b), tg = target(world), g = d.grav;
      const k = (atk.t - 24) / 18;
      const tx = Math.max(16, Math.min(W - 16, tg.x + (k % 2 ? 36 : -24)));
      const vy0 = -Math.sqrt(2 * g * Math.max(20, m.y - 16)), ta = -vy0 / g;
      b.mud.push({ x: m.x, y: m.y, vx: (tx - m.x) / ta, vy: vy0, g, r: 5, cause: 'mudFlak', atk: atk.id, flak: true, big: true });
      sfx('missile');
    }
    return atk.t >= 24 + d.flakN * 18 + 50;
  },
  // GEYSERS: water columns erupt from the surface to the ceiling; thread the gaps
  geyser(world, b, atk) {
    const d = D(b);
    const TELL = d.geyTell, ON = 54;
    if (atk.t === 0) {
      const n = d.geyN, xs = [];
      const p = world.player, px = p && p.alive ? p.x : 80;
      xs.push(Math.max(30, Math.min(W - 30, px + world.rng.range(-10, 10)))); // one right under the ship
      let tries = 0;
      while (xs.length < n && tries++ < 40) { const x = world.rng.range(24, W - 24); if (xs.every((q) => Math.abs(q - x) > 62)) xs.push(x); }
      atk.cols = xs.sort((a, c) => a - c);
      b.jawT = 1; sfx('rumble');
    }
    const k = atk.t / TELL;
    b.geysers = atk.cols.map((x) => ({ x, state: atk.t < TELL ? 'tell' : atk.t < TELL + ON ? 'on' : 'off', k: Math.min(1, k), left: Math.max(0, TELL - atk.t), atk: atk.id }));
    const rects = [], xs = [-12, ...atk.cols, W + 12];
    for (let i = 0; i + 1 < xs.length; i++) rects.push({ x: xs[i] + 18, y: 0, w: xs[i + 1] - xs[i] - 36, h: H });
    hint(b, atk, 'mudGeyser', 'Boiling spots become water columns: move into a gap between them', rects);
    if (atk.t === TELL) { fxCall('addShake', world, 4); sfx('explodeL'); for (const x of atk.cols) splash(b, x, 24, world, 5); }
    if (atk.t >= TELL && atk.t < TELL + ON) {
      const hb = player.playerHitbox(world);
      if (hb) for (const x of atk.cols) if (Math.abs(hb.x - x) < 11 + hb.r && hb.y < SURFACE_Y + 10) { hurtPlayer(world, { kind: 'bullet', cause: 'mudGeyser', atk: atk.id, x, y: hb.y }); break; }
    }
    if (atk.t === 20) b.jawT = 0;
    if (atk.t >= TELL + ON + 10) { b.geysers = null; return true; }
    return false;
  },
  // big parabolic leap to the other side (lands BEHIND the player on the left); spray on landing
  leap(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      const toLeft = atk.to ? atk.to === 'L' : b.home !== 'L';
      const x1 = toLeft ? HOME_L : HOME_R;
      atk.L = { x0: b.x, y0: b.y, x1, y1: PERCH_Y, h: 62, T: d.leapT, t: 0 };
      b.home = toLeft ? 'L' : 'R';
      b.jawT = 1;
      sfx('bossRoar');
    }
    if (atk.t === 0) atk.tell = b.home === 'R' && atk.L.x0 < 200 ? 44 : 34; // returning from the left perch: longer tell
    if (atk.t < atk.tell) {
      b.y += 0.45; b.a *= 0.9; b.eyeUpT = 0;
      b.landing = landing(atk.L.x1, atk.L.x1 < atk.L.x0 ? 1 : -1, 0);
      b.arcPreview = atk.L; b.bellyTell = 1;
      hint(b, atk, 'mudLeap', 'It will leap back: stay low under the arc, away from the landing shadow - shoot the belly as it passes', arcRects(atk.L, b.landing));
      return false;
    }
    b.arcPreview = null; b.bellyTell = 0;
    if (!atk.L.done) {
      stepLeap(world, b, atk.L);
      b.landing = landing(atk.L.x1, atk.L.x1 < atk.L.x0 ? 1 : -1, atk.L.t / atk.L.T);
      hint(b, atk, 'mudLeap', 'Leave the landing shadow; stay low under the arc', arcRects(atk.L, b.landing));
    }
    if (atk.L.done && !atk.landed) {
      atk.landed = atk.t; b.landing = null;
      shockPair(world, b, b.x, atk);
      if (b.phase >= 2) spray(world, b, atk, b.x - 20 * b.f, 3 + b.phase);
      fxCall('addShake', world, 5);
    }
    if (atk.landed) { b.jawT = 0; const p = world.player; if (p && p.alive) b.f = p.x < b.x ? 1 : -1; }
    return atk.landed && atk.t >= atk.landed + 24;
  },
  // two leaps: to mid-screen, then to the far side
  doubleLeap(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      const toLeft = b.home !== 'L';
      atk.legs = [
        { x0: b.x, y0: b.y, x1: 204, y1: PERCH_Y, h: 48, T: Math.round(d.leapT * 0.7), t: 0 },
        { x0: 204, y0: PERCH_Y, x1: toLeft ? HOME_L : HOME_R, y1: PERCH_Y, h: 54, T: Math.round(d.leapT * 0.8), t: 0 },
      ];
      atk.k = 0; b.home = toLeft ? 'L' : 'R';
      sfx('bossRoar');
    }
    if (atk.t < 14) { b.y += 0.6; return false; }
    const L = atk.legs[atk.k];
    if (!L) return atk.t >= atk.end + 20;
    if (L.t === 0) { L.x0 = b.x; L.y0 = b.y; }
    stepLeap(world, b, L);
    b.landing = landing(L.x1, L.x1 < L.x0 ? 1 : -1, L.t / L.T);
    hint(b, atk, 'mudLeap', 'Two leaps: leave each landing shadow, stay under the arcs', arcRects(L, b.landing));
    if (L.done) {
      shockPair(world, b, b.x, atk);
      spray(world, b, atk, b.x, 4);
      atk.k++;
      if (!atk.legs[atk.k]) { atk.end = atk.t; b.landing = null; }
    }
    return false;
  },
  // dives under the surface, moves unseen (wake), boils, then bursts out under the ship
  dive(world, b, atk) {
    const d = D(b);
    const tgx = () => clamp(target(world).x + 10, 96, HOME_R);
    if (atk.t === 0) { atk.st = 'sink'; b.eyeUpT = 0; sfx('explodeS'); splash(b, b.x, 30, world); }
    if (atk.st === 'sink') {
      b.y += (SURFACE_Y + 52 - b.y) * 0.12; b.a += (-0.5 - b.a) * 0.1;
      if (atk.t >= 34) { atk.st = 'swim'; atk.t0 = atk.t; atk.tx = tgx(); }
    } else if (atk.st === 'swim') {
      const k = Math.min(1, (atk.t - atk.t0) / 50);
      b.x += (atk.tx - b.x) * 0.08; b.y = SURFACE_Y + 52; b.a = 0;
      b.f = atk.tx < b.x ? 1 : -1;
      b.wake = { x: b.x, k };
      if (k >= 1) { atk.st = 'boil'; atk.t0 = atk.t; b.wake = null; }
    } else if (atk.st === 'boil') {
      const k = (atk.t - atk.t0) / d.diveTell;
      b.boil = { x: atk.tx, k };
      hint(b, atk, 'mudBurst', 'Boiling water: move sideways away from it', [{ x: 0, y: 0, w: atk.tx - 56, h: H }, { x: atk.tx + 56, y: 0, w: W, h: H }]);
      if (k >= 1) {
        atk.st = 'burst'; b.boil = null;
        const toRight = atk.tx < W / 2 ? false : true;
        atk.L = { x0: atk.tx, y0: SURFACE_Y + 52, x1: toRight ? HOME_R : HOME_L, y1: PERCH_Y, h: 72, T: 78, t: 0 };
        b.home = toRight ? 'R' : 'L';
        splash(b, atk.tx, 70, world, 5);
        spray(world, b, atk, atk.tx, 5 + b.phase);
        fxCall('addShake', world, 6); sfx('explodeL');
      }
    } else if (atk.st === 'burst') {
      stepLeap(world, b, atk.L);
      b.jawT = 1;
      if (atk.L.done) { atk.st = 'done'; atk.t0 = atk.t; shockPair(world, b, b.x, atk); b.jawT = 0; }
    } else return atk.t >= atk.t0 + 20;
    return false;
  },
  // P3: heavy stomp in place → shockwaves both ways + lobs
  shockHop(world, b, atk) {
    if (atk.t === 0) {
      atk.L = { x0: b.x, y0: b.y, x1: b.x, y1: PERCH_Y, h: 50, T: 60, t: 0 };
      hint(b, atk, 'mudShock', 'Heavy stomp: be above the water line when it lands', [{ x: 0, y: 0, w: W, h: SURFACE_Y - 20 }]);
      b.landing = landing(b.x, b.f, 0);
    }
    if (atk.t < 16) { b.y += 0.7; return false; }
    if (!atk.L.done) { stepLeap(world, b, atk.L); b.landing.k = atk.L.t / atk.L.T; }
    if (atk.L.done && !atk.landed) {
      atk.landed = atk.t; b.landing = null;
      const d = D(b);
      b.shocks.push({ x: b.x - 20, vx: -d.shockSpd * 1.1, atk: atk.id, t: 0 }, { x: b.x + 20, vx: d.shockSpd * 1.1, atk: atk.id, t: 0 });
      spray(world, b, atk, b.x, 5);
      fxCall('addShake', world, 6); sfx('rumble');
    }
    return atk.landed && atk.t >= atk.landed + 30;
  },
  // FINAL FORM: gliding leap with the sails ablaze, dropping mud behind it
  glideLeap(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      const toLeft = b.home !== 'L';
      atk.L = { x0: b.x, y0: b.y, x1: toLeft ? HOME_L : HOME_R, y1: PERCH_Y, h: 60, T: d.leapT + 30, t: 0 };
      b.home = toLeft ? 'L' : 'R';
      sfx('bossRoar');
    }
    if (atk.t < 14) { b.y += 0.6; return false; }
    if (!atk.L.done) {
      stepLeap(world, b, atk.L);
      b.landing = landing(atk.L.x1, atk.L.x1 < atk.L.x0 ? 1 : -1, atk.L.t / atk.L.T);
      hint(b, atk, 'mudLeap', 'It glides overhead dropping mud: stay out of its trail and the landing shadow', arcRects(atk.L, b.landing));
      if (atk.L.t % 12 === 6 && atk.L.t < atk.L.T - 10) b.mud.push({ x: b.x, y: b.y + 20, vx: b.vx * 0.3, vy: 0.5, g: d.grav, r: 4, cause: 'mudLob', atk: atk.id });
    }
    if (atk.L.done && !atk.landed) { atk.landed = atk.t; b.landing = null; shockPair(world, b, b.x, atk); spray(world, b, atk, b.x, 5); }
    return atk.landed && atk.t >= atk.landed + 24;
  },
  // FINAL FORM: mud rain from the sky in waves; two lit safe columns per wave
  mudRain(world, b, atk) {
    const d = D(b);
    const WAVES = d.rainWaves, IV = d.rainEvery, T0 = 50, SW = d.rainSafe;
    if (atk.t === 0) {
      atk.cols = [];
      for (let w = 0; w < WAVES; w++) { const a = world.rng.range(24, 150), c = world.rng.range(a + 70, 300); atk.cols.push([a, c]); }
      b.jawT = 1; sfx('bossRoar');
    }
    if (atk.t === 20) b.jawT = 0;
    for (let w = 0; w < WAVES; w++) {
      if (atk.t !== T0 + w * IV) continue;
      const [ca, cb] = atk.cols[w];
      for (let x = 6; x < W - 6; x += 12) {
        if (Math.abs(x - ca) < SW / 2 + 5 || Math.abs(x - cb) < SW / 2 + 5) continue;
        b.mud.push({ x: x + world.rng.range(-3, 3), y: -8 - world.rng.range(0, 24), vx: 0, vy: 0.5, g: d.grav * 0.8, r: 4, cause: 'mudRain', atk: atk.id, wave: w });
      }
    }
    let oldest = WAVES;
    for (const m of b.mud) if (m.wave !== undefined && m.atk === atk.id) oldest = Math.min(oldest, m.wave);
    const spawned = Math.max(-1, Math.floor((atk.t - T0) / IV));
    const hw = oldest < WAVES ? oldest : Math.min(WAVES - 1, spawned + 1);
    const cols = atk.cols[hw];
    hint(b, atk, 'mudRain', 'Stand in a lit column while the mud falls', cols.map((c) => ({ x: c - SW / 2 + 2, y: 0, w: SW - 4, h: H })));
    const next = spawned + 1 < WAVES && spawned + 1 !== hw && atk.t >= T0 + (spawned + 1) * IV - 40 ? atk.cols[spawned + 1] : null;
    const done = atk.t >= T0 + (WAVES - 1) * IV && oldest >= WAVES;
    b.rain = done ? null : { cols, sw: SW, next };
    return done && atk.t > T0 + (WAVES - 1) * IV + 20;
  },
  // FINAL FORM spectacle: it dives, the sea draws back, then a TIDAL WAVE sweeps
  // the screen right→left; the only way through is the tunnel (striped band).
  tidalWave(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      atk.st = 'sink'; b.eyeUpT = 0; sfx('rumble'); fxCall('screenRumble', world, 60, 2);
      splash(b, b.x, 40, world);
      atk.waves = [];
    }
    if (atk.st === 'sink') {
      b.y += (SURFACE_Y + 60 - b.y) * 0.1; b.x += (W + 60 - b.x) * 0.04; b.a *= 0.9;
      if (atk.t >= 40) { atk.st = 'tell'; atk.t0 = atk.t; atk.n = 0; newWave(world, b, atk, d); }
    }
    const wv = b.wave;
    if (wv) {
      if (wv.state === 'tell') {
        wv.recede = Math.min(14, (atk.t - wv.t0) / 5);
        if (atk.t - wv.t0 >= d.tideTell) { wv.state = 'run'; sfx('explodeL'); fxCall('screenRumble', world, 90, 4); }
      } else if (wv.state === 'run') {
        wv.x -= wv.spd; wv.recede = Math.max(0, wv.recede - 0.5);
        if (atk.t % 3 === 0 && typeof bullets.vortex === 'function') for (let y = wv.top + 10; y < H; y += 24) if (y < wv.g0 || y > wv.g1) bullets.vortex(world, wv.x + 16, y, 16, 0, 16);
        if (wv.x < W / 2) b.tideFired = true;
        const hb = player.playerHitbox(world);
        if (hb && hb.x > wv.x - 2 && hb.x < wv.x + WAVE_W && (hb.y < wv.g0 + 2 || hb.y > wv.g1 - 2) && !(b.tideCd > 0)) {
          b.tideCd = 20; hurtPlayer(world, { kind: 'laser', cause: 'mudTide', atk: atk.id, x: wv.x, y: hb.y });
        }
        if (wv.x < -60) { b.wave = null; atk.n++; if (atk.n < 2) newWave(world, b, atk, d); else { atk.st = 'rise'; atk.t0 = atk.t; atk.L = { x0: W + 60, y0: SURFACE_Y + 60, x1: HOME_R, y1: PERCH_Y, h: 60, T: 70, t: 0 }; b.home = 'R'; } }
      }
      if (b.wave) hint(b, atk, 'mudTide', 'Be inside the striped tunnel when the wave arrives', [{ x: 0, y: b.wave.g0 + 3, w: W, h: b.wave.g1 - b.wave.g0 - 6 }]);
    }
    if (b.tideCd > 0) b.tideCd--;
    if (atk.st === 'rise') {
      if (atk.L.t === 0) splash(b, W - 30, 40, world, 4);
      stepLeap(world, b, atk.L);
      if (atk.L.done) return true;
    }
    return false;
  },
};

function newWave(world, b, atk, d) {
  const p = world.player;
  const py = p && p.alive ? p.y : 100;
  let gc = clamp(py + world.rng.range(-60, 60), 40, H - 30);
  if (Math.abs(gc - py) < 30) gc = clamp(gc + (gc < H / 2 ? 50 : -50), 40, H - 30);
  b.wave = { x: W + 20, spd: d.tideSpd, top: 0, g0: gc - d.tideGap / 2, g1: gc + d.tideGap / 2, state: 'tell', t0: atk.t, recede: 0, atk: atk.id };
}

// ---- hazards physics ----------------------------------------------------------
export function updateHazards(world, b) {
  const hb = player.playerHitbox(world);
  const m = b.mud;
  for (let i = m.length - 1; i >= 0; i--) {
    const q = m[i];
    const wasAbove = q.y < SURFACE_Y;
    if (q.y >= SURFACE_Y) { q.vx *= 0.94; q.vy = Math.min(q.vy + q.g * 0.4, 1.2); } else q.vy += q.g;
    q.x += q.vx; q.y += q.vy;
    if (q.flak && q.vy >= 0) {
      const n = D(b).flakShards;
      for (let k = 0; k < n; k++) b.mud.push({ x: q.x, y: q.y, vx: q.vx * 0.3 + (k - (n - 1) / 2) * 0.62, vy: 0.2 + Math.abs(k - (n - 1) / 2) * 0.12, g: q.g, r: 3, cause: 'mudFlak', atk: q.atk });
      fxCall('explode', world, q.x, q.y, 'small', { debris: false });
      m.splice(i, 1); continue;
    }
    if (wasAbove && q.y >= SURFACE_Y && q.vy > 0) {
      for (let k = 0; k < 5; k++) b.splash.push({ x: q.x, y: SURFACE_Y - 1, vx: world.fxRng.range(-1, 1), vy: world.fxRng.range(-2.2, -0.8), t: 0, c: k & 1 });
      if (q.shock) { const d = D(b); if (d.shock) b.shocks.push({ x: q.x - 8, vx: -d.shockSpd * 0.8, atk: q.atk, t: 0 }, { x: q.x + 8, vx: d.shockSpd * 0.8, atk: q.atk, t: 0 }); }
      q.mark = 0;
    }
    if (hb && (hb.x - q.x) ** 2 + (hb.y - q.y) ** 2 < (q.r * 0.8 + hb.r) ** 2) { hurtPlayer(world, { kind: 'bullet', cause: q.cause, atk: q.atk, x: q.x, y: q.y }); m.splice(i, 1); continue; }
    if (q.y > H + 10 || q.x < -20 || q.x > W + 20) m.splice(i, 1);
  }
  const s = b.shocks;
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i];
    q.t++; q.x += q.vx;
    if (hb && Math.abs(hb.x - q.x) < 8 + hb.r && hb.y > SURFACE_Y - 13 && hb.y < SURFACE_Y + 6) hurtPlayer(world, { kind: 'bullet', cause: 'mudShock', atk: q.atk, x: q.x, y: SURFACE_Y - 4 });
    if (q.x < -20 || q.x > W + 20) s.splice(i, 1);
  }
  if (!b.atk || b.atk.name !== 'tidalWave') b.wave = null;
  if (!b.atk || b.atk.name !== 'mudRain') b.rain = null;
  if (!b.atk || b.atk.name !== 'skyLeap') b.skyBand = null;
  if (!b.atk || b.atk.name !== 'geyser') b.geysers = null;
  if (!b.atk || b.atk.name !== 'dive') { b.wake = null; b.boil = null; }
}

// warning stripes (cyan), cheap fillRects
function hatch(ctx, x0, y0, w, h, t, color, alpha) {
  if (w <= 0 || h <= 0) return;
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.fillRect(Math.round(x0), Math.round(y0), Math.round(w), 1);
  ctx.fillRect(Math.round(x0), Math.round(y0 + h - 1), Math.round(w), 1);
  const off = (t >> 1) % 14;
  for (let x = x0 - h + off; x < x0 + w; x += 14) for (let k = 0; k < h; k += 2) {
    const px = Math.round(x + k * 0.5 + h * 0.5);
    if (px >= x0 && px < x0 + w) ctx.fillRect(px, Math.round(y0 + k), 3, 1);
  }
  ctx.globalAlpha = 1;
}

export function drawHazards(ctx, world, b, S, layer) {
  if (layer === 'under') {
    // landing shadow on the water surface
    if (b.landing) {
      const k = clamp(b.landing.k, 0, 1), sc = 0.5 + 0.8 * k;
      ctx.globalAlpha = 0.5 + 0.4 * k;
      const LW = (b.landing.r - b.landing.l) * (0.55 + 0.45 * k), LX = (b.landing.l + b.landing.r) / 2;
      ctx.drawImage(S.shadow, Math.round(LX - LW / 2), SURFACE_Y - 5, Math.round(LW), 10);
      ctx.globalAlpha = (b.t >> 2) & 1 ? 0.9 : 0.5;
      ctx.fillStyle = '#a8f6ff';
      for (const ex of [b.landing.l, b.landing.r - 6]) { ctx.fillRect(Math.round(ex), SURFACE_Y - 7, 6, 1); ctx.fillRect(Math.round(ex) + (ex === b.landing.l ? 0 : 5), SURFACE_Y - 12, 1, 6); }
      ctx.globalAlpha = 1;
    }
    if (b.skyBand && b.skyBand.on) {
      ctx.globalAlpha = 0.35 * b.skyBand.k; ctx.fillStyle = '#05020c'; ctx.fillRect(0, 0, W, 6);
      hatch(ctx, 0, 0, W, b.skyBand.y1, b.t, '#c8faff', 0.18 + 0.2 * b.skyBand.k * ((b.t >> 3) & 1 ? 1 : 0.5));
      for (const [a0, a1] of b.skyBand.zones) hatch(ctx, Math.max(0, a0), b.skyBand.y1, Math.min(W, a1) - Math.max(0, a0), SURFACE_Y - b.skyBand.y1, b.t, '#c8faff', 0.14 + 0.12 * b.skyBand.k);
    }
    if (b.geysers) for (const gy of b.geysers) {
      if (gy.state === 'tell') {
        hatch(ctx, gy.x - 11, SURFACE_Y - (SURFACE_Y - 4) * gy.k, 22, (SURFACE_Y - 4) * gy.k, b.t, '#c8faff', 0.3 + 0.2 * ((b.t >> 2) & 1));
        ctx.fillStyle = '#e8ffff';
        for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(gy.x - 8 + ((b.t * 3 + i * 5) % 16)), SURFACE_Y - 2 - ((b.t + i * 3) % 5), 2, 2);
      }
    }
    if (b.arcPreview && (b.t >> 2) & 1) {
      const L = b.arcPreview;
      ctx.fillStyle = '#c8faff';
      for (let k = 0; k <= 24; k++) { const u = k / 24; ctx.fillRect(Math.round(L.x0 + (L.x1 - L.x0) * u), Math.round(L.y0 + (L.y1 - L.y0) * u - 4 * L.h * u * (1 - u) + 20), 2, 2); }
    }
    if (b.boil) {
      const k = clamp(b.boil.k, 0, 1);
      hatch(ctx, b.boil.x - 44, SURFACE_Y - 70 * k - 4, 88, 70 * k + 4, b.t, '#a8f6ff', 0.25 + 0.2 * ((b.t >> 2) & 1));
      ctx.fillStyle = '#e8ffff';
      for (let i = 0; i < 6; i++) { const x = b.boil.x + Math.sin(b.t * 0.7 + i * 2.1) * 30 * k; ctx.fillRect(Math.round(x), SURFACE_Y - 2 - ((b.t * 3 + i * 7) % 8), 2, 2); }
    }
    if (b.wake) {
      ctx.fillStyle = '#c8f6ff';
      for (let i = 0; i < 8; i++) ctx.fillRect(Math.round(b.wake.x + i * 6 * b.f - 20 * b.f), SURFACE_Y - 1 - ((b.t + i * 5) % 4 === 0 ? 1 : 0), 3, 1);
    }
    if (b.wave && b.wave.state === 'run') { const wv = b.wave; hatch(ctx, 0, wv.g0, Math.max(0, Math.round(wv.x)), wv.g1 - wv.g0, b.t, '#c8faff', 0.32); }
    if (b.wave && b.wave.state === 'tell') {
      const wv = b.wave;
      hatch(ctx, 0, wv.g0, W, wv.g1 - wv.g0, b.t, '#c8faff', 0.45 + 0.25 * ((b.t >> 3) & 1));
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = (b.t >> 2) & 1 ? 1 : 0.4;
      for (const yy of [wv.g0, wv.g1 - 1]) for (let x = W - 30; x < W - 4; x += 4) ctx.fillRect(x, Math.round(yy), 3, 1);
      ctx.globalAlpha = 1;
    }
    if (b.rain) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45;
      for (const c of b.rain.cols) { ctx.fillStyle = '#7ad8ff'; ctx.fillRect(Math.round(c - b.rain.sw / 2), 0, b.rain.sw, H); }
      if (b.rain.next && (b.t >> 2) & 1) { ctx.globalAlpha = 0.15; for (const c of b.rain.next) ctx.fillRect(Math.round(c - b.rain.sw / 2), 0, b.rain.sw, H); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    return;
  }
  // mud balls + landing marks
  for (const q of b.mud) {
    const s = q.big ? S.mudBig : S.mud;
    ctx.drawImage(s.img, Math.round(q.x) - s.px, Math.round(q.y) - s.py);
    if (q.mark && q.tx !== undefined && (b.t >> 2) & 1) {
      ctx.fillStyle = '#a8f6ff';
      const x = Math.round(q.tx), y = Math.round(q.ty);
      ctx.fillRect(x - 3, y, 2, 1); ctx.fillRect(x + 2, y, 2, 1); ctx.fillRect(x, y - 3, 1, 2); ctx.fillRect(x, y + 2, 1, 2);
    }
  }
  // geyser columns
  if (b.geysers) for (const gy of b.geysers) {
    if (gy.state !== 'on') continue;
    const x = Math.round(gy.x);
    ctx.fillStyle = '#1e5a82'; ctx.fillRect(x - 11, 0, 22, SURFACE_Y + 4);
    ctx.fillStyle = '#3a8cbc'; ctx.fillRect(x - 7, 0, 14, SURFACE_Y + 4);
    ctx.fillStyle = '#9fe0f6'; ctx.fillRect(x - 3, 0, 5, SURFACE_Y + 4);
    ctx.fillStyle = '#ffffff';
    for (let y = (b.t * 5) % 10; y < SURFACE_Y; y += 10) ctx.fillRect(x - 9 + ((y * 7) % 15), y, 2, 3);
    ctx.fillRect(x - 13, SURFACE_Y - 3, 26, 3);
  }
  // flak shells blink before bursting
  for (const q of b.mud) {
    if (!q.flak) continue;
    const left = q.vy < 0 ? -q.vy / q.g : 0; // frames until the burst
    ctx.fillStyle = '#9ef6ff';
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + b.t * 0.2; ctx.fillRect(Math.round(q.x + Math.cos(a) * 8), Math.round(q.y + Math.sin(a) * 8), 1, 1); }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 8, 2, 3); // fuse spark
    if (left < 20 && (b.t >> (left < 8 ? 0 : 1)) & 1) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(S.tellGlow, Math.round(q.x) - 8, Math.round(q.y) - 8); ctx.globalCompositeOperation = 'source-over'; }
  }
  // shockwaves: foam crests running along the surface
  for (const q of b.shocks) {
    const x = Math.round(q.x);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 3, SURFACE_Y - 12, 6, 2);
    ctx.fillStyle = '#bff2ff';
    ctx.fillRect(x - 6, SURFACE_Y - 10, 12, 4);
    ctx.fillStyle = '#5fb8e0';
    ctx.fillRect(x - 9, SURFACE_Y - 6, 18, 6);
  }
  // tidal wave: a curling wall of water (WAVE_W px, all of it dangerous) with a tunnel
  if (b.wave && b.wave.state === 'run') {
    const wv = b.wave, x = Math.round(wv.x), g0 = Math.round(wv.g0), g1 = Math.round(wv.g1);
    const band = (y0, y1) => {
      if (y1 <= y0) return;
      const cols = ['#0e2c46', '#16405e', '#205a7c', '#2c7298', '#4a98bc'];
      for (let i = 0; i < 5; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(x + WAVE_W - (i + 1) * (WAVE_W / 5), y0, WAVE_W / 5, y1 - y0); }
      ctx.fillStyle = '#9fe0f6'; ctx.fillRect(x, y0, 3, y1 - y0);
      ctx.fillStyle = '#e8fbff';
      for (let y = y0 + ((b.t * 3) % 9); y < y1; y += 9) ctx.fillRect(x + 2 + ((y * 7) % 11), y, 2, 4);
      for (let y = y0 + ((b.t * 2) % 13); y < y1; y += 13) ctx.fillRect(x + 18 + ((y * 5) % 23), y, 1, 6);
    };
    band(0, g0);
    band(g1, H);
    // curling crest overhanging to the left + foam lips around the tunnel
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 6; k++) ctx.fillRect(x - 14 + k * 3, wv.top + 10 - k * 2 + (k > 3 ? (k - 3) * 3 : 0), WAVE_W - k * 4 + 14, 2);
    ctx.fillStyle = '#c8f4ff';
    ctx.fillRect(x - 10, wv.top + 12, 16, 6);
    for (const yy of [g0 - 3, g1]) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 4, yy, WAVE_W + 4, 3); }
    ctx.fillStyle = '#e8fbff';
    for (let i = 0; i < 10; i++) ctx.fillRect(x - 6 - ((b.t * 2 + i * 17) % 24), wv.top + 10 + ((i * 37 + b.t) % (H - wv.top - 10)), 2, 2);
  }

}
