import { drawSpray } from './boss-skipper-art.js';
import { paintedCell, paintedCurtain, paintedSurface } from './g-painted-fx.js';
import { visualAssets } from './g-visual-assets.js';
import { W, H } from '../config.js';
import { clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, hurtPlayer, aimLead } from './boss-util.js';
import { emit } from './world.js';
import { SURFACE_Y, DIFFICULTY, SEGS, SEG_DX, EYE_POS, EYE_UP, SAIL_POS, CHASE_X, CHASE_Y, toWorld, hint, rampParams } from './boss-skipper-core.js';
import { getWallArt, getBeamArt } from './boss-skipper-art.js';

const D = (b) => DIFFICULTY[b.phase];
const tgt = (world) => { const p = world.player; return p && p.alive ? { x: p.x, y: p.y } : { x: 60, y: 100 }; };
export const STRONG = new Set(['sail', 'slap', 'bigskip', 'cannon', 'gigaCannon']);
export const CANNONS = new Set(['cannon', 'gigaCannon']);

export function eyePos(b, i) { const [x, y] = EYE_POS[i]; return toWorld(b, x, y - EYE_UP[i] * b.eyes[i].up); }
export function sailTop(b, i) { const [x, y] = SAIL_POS[i]; return toWorld(b, x + 10, y - 26); }
export const segsLeft = (b) => b.segs.filter((s) => s.state !== 'broken').length;
export const outerSeg = (b) => { for (let i = b.segs.length - 1; i >= 0; i--) if (b.segs[i].state !== 'broken') return i; return -1; };
export const segX = (b, i) => 62 + SEG_DX * (1 - 0.3 * b.coil) * (i + 0.5);
export function nozzlePos(b) { const o = Math.max(0, outerSeg(b)); return toWorld(b, segX(b, o) + SEG_DX * 0.9 + 4, 4); }

// eye barrage ramp 0..1: eye damage dealt + duel time (smooth; replaces the old eyeLate step)
export function eyeRampK(b) {
  const rp = DIFFICULTY[1].eyeRamp;
  if (!rp) return 0;
  const max = b.eyes.reduce((s, e) => s + e.max, 0), hp = b.eyes.reduce((s, e) => s + Math.max(0, e.hp), 0);
  return clamp(rp.eyeW * (1 - hp / max) + rp.timeW * Math.min(1, b.fightT / rp.timeF), 0, 1);
}

function lob(world, b, atk, x0, y0, tx, ty, T, cause, r = 4) {
  const g = D(b).grav;
  b.mud.push({ x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - 0.5 * g * T * T) / T, g, r, cause, atk: atk.id, tx, ty, mark: 1 });
}
export function splash(b, world, x, n, up = 3, mud = false) {
  for (let i = 0; i < n; i++) b.splash.push({ x: x + world.fxRng.range(-10, 10), y: SURFACE_Y - 1, vx: world.fxRng.range(-1.4, 1.4), vy: -world.fxRng.range(up * 0.4, up), t: 0, c: mud ? 2 : i & 1 });
}

// ---- MUD WALL geometry --------------------------------------------------------------------------
const WALL_STEP = 9, CLOD_HIT = 3.6; // clod spacing (no squeezing between clods) / hit radius (< visual 5)
const wallShift = (w) => (w.amp ? w.amp * Math.sin(w.ph + w.t * w.om) : 0);
function makeWall(world, b, atk, x, plan, d) {
  const clods = [];
  for (let y = -4; y <= H + 4; y += WALL_STEP) {
    const inGap = Math.abs(y - plan.gy) < plan.gh / 2;
    if (inGap && plan.kind !== 'soft') continue;
    clods.push({ y0: y, soft: inGap, dead: false });
  }
  const gateLo = clods.filter((c) => c.y0 < plan.gy).pop(), gateHi = clods.find((c) => c.y0 > plan.gy);
  if (plan.kind !== 'soft') { if (gateLo) gateLo.gate = 1; if (gateHi) gateHi.gate = 1; }
  b.walls.push({ kind: plan.kind, x, px: x, vx: -d.wallSpd, gy: plan.gy, gh: plan.gh, amp: plan.amp || 0, ph: plan.ph || 0, om: plan.om || 0, t: 0,
    atk: atk.id, clods, softHp: plan.kind === 'soft' ? d.softHp : 0, softMax: d.softHp, open: plan.kind !== 'soft', flash: 0 });
}
function planWall(world, b, kind, d, near) {
  // gates always open ABOVE the surface (the wall still spans the water: campers must come up), so a
  // wall never drives you into the underwater shock rings
  const gh = d.wallGap, lo = 18 + gh / 2, hi = SURFACE_Y - 2 - gh / 2;
  // the gate is never quite where you are: 24..56 px above or below (a real move to thread it; may dive)
  const off = world.rng.range(24, 56) * (world.rng.next() < 0.5 ? -1 : 1);
  let gy = near + off;
  if (gy < lo || gy > hi) gy = near - off;
  gy = clamp(gy, lo, hi);
  const p = { kind, gy, gh };
  if (kind === 'drift') { p.amp = Math.min(d.wallDrift, gy - lo + 4, hi - gy + 4); p.ph = world.rng.next() < 0.5 ? 0 : Math.PI; p.om = 0.045; }
  if (kind === 'soft') p.gh = gh + 6;
  return p;
}
// gap centre + the band you can pass through right now (soft walls only once opened)
const gapNow = (w) => w.gy + wallShift(w);

export const ATTACKS = {
  // ---- DUEL --------------------------------------------------------------------
  // eye pops up (flinging mud), glows, fires aimed shots, stays up the full window
  eye(world, b, atk) {
    if (atk.t === 0) {
      const d0 = D(b), k = eyeRampK(b);
      atk.d = d0.eyeRamp ? { ...d0, ...rampParams(d0.eyeRamp, k) } : d0; // fixed for this attack
      b.eyeK = k;
      if (atk.both) {
        const easy = (atk.dualN || 1) <= 2;
        atk.d = { ...atk.d, eyeN: Math.max(3, atk.d.eyeN - (easy ? 2 : 1)), eyeSpd: atk.d.eyeSpd * (easy ? 0.85 : 0.95), eyeIv: atk.d.eyeIv + (easy ? 4 : 2), eyeUp: atk.d.eyeUp + 18 };
      }
    }
    if (atk.both && atk.t === 18) sfx('laserCharge');
    const d = atk.d;
    const ids = atk.both ? [0, 1].filter((i) => b.eyes[i].state === 'ok') : [atk.eye];
    if (atk.t === 0) {
      for (const i of ids) b.eyes[i].upT = 1;
      hint(b, atk, 'skEye', 'Shoot the lit eye; sidestep its aimed shots');
      b.safeHint.rects = [];
      sfx('laserCharge');
    }
    if (atk.t === 6) for (const i of ids) { const p = eyePos(b, i); for (let k = 0; k < 4; k++) b.splash.push({ x: p.x, y: p.y, vx: world.fxRng.range(-1.2, 1.2), vy: -world.fxRng.range(0.6, 2), t: 0, c: 2, free: 1 }); }
    const T0 = atk.both ? 52 : 34;
    if (atk.t >= T0 && (atk.t - T0) % d.eyeIv === 0 && (atk.t - T0) / d.eyeIv < d.eyeShots) {
      ids.forEach((i, j) => {
        if (b.eyes[i].state !== 'ok' || (atk.both && ((atk.t - T0) / d.eyeIv + j) % 2)) return;
        const p = eyePos(b, i), a0 = aimLead(world, p.x, p.y, d.eyeSpd, d.eyeLead || 0), n = d.eyeN;
        const off = ((atk.t - T0) / d.eyeIv) % 2 ? (d.eyeSpread || 0.18) / 2 : 0;
        for (let k = 0; k < n; k++) bullets.fire(world, { x: p.x - 4, y: p.y, ang: a0 + off + (k - (n - 1) / 2) * (d.eyeSpread || 0.18), spd: d.eyeSpd, type: 'orb', color: 'red', cause: 'skEye', atk: atk.id });
        sfx('missile');
      });
    }
    atk.tell = atk.t < T0 ? 1 : 0;
    if (atk.t >= d.eyeUp || ids.every((i) => b.eyes[i].state !== 'ok')) for (const i of ids) b.eyes[i].upT = 0;
    return atk.t >= d.eyeUp + 18 || (atk.t > 10 && ids.every((i) => b.eyes[i].state !== 'ok') && atk.t > T0);
  },
  // sail raised = threat display; panels lit while raised; then a clod fan (−1/3 per broken panel)
  sail(world, b, atk) {
    const d = D(b), alive = b.panels.filter((q) => q.state === 'ok').length;
    if (atk.t === 0) {
      b.sailUpT = 1; sfx('bossRoar');
      hint(b, atk, 'skSail', 'Raised sail = mud fan coming: shoot the lit panels to weaken it, then dodge the cyan marks');
      b.safeHint.rects = [];
    }
    if (atk.t === d.sailTell) {
      const n = Math.round((d.sailN * alive) / 3);
      if (!n) { fxCall('explode', world, sailTop(b, 1).x, sailTop(b, 1).y, 'small', { debris: false }); sfx('hit'); atk.fizzle = true; }
      else {
        const p = tgt(world);
        for (let k = 0; k < n; k++) {
          const i = k % 3, src = b.panels[i].state === 'ok' ? sailTop(b, i) : sailTop(b, 1);
          const tx = clamp(p.x + (k - (n - 1) / 2) * 22, 10, W - 120), ty = clamp(p.y + (k % 2 ? -12 : 12) + (k % 3 - 1) * 6, 20, SURFACE_Y - 10);
          lob(world, b, atk, src.x, src.y, tx, ty, 64 + (k % 3) * 6, 'skSail', 4);
        }
        sfx('missile');
        hint(b, atk, 'skSail', 'Dodge the clods: stay clear of the cyan marks');
        const ys = b.mud.filter((q) => q.atk === atk.id).map((q) => q.ty);
        const top = Math.min(...ys) - 24, bot = Math.max(...ys) + 24;
        b.safeHint.rects = [{ x: 0, y: 0, w: W, h: top }, { x: 0, y: bot, w: W, h: SURFACE_Y - bot }];
      }
    }
    if (atk.t >= d.sailTell + 50) b.sailUpT = 0;
    return atk.t >= d.sailTell + 70;
  },
  // arm-fin slap → one bright mud-wave crest rolls along the flat (stay above it)
  slap(world, b, atk) {
    const d = D(b), TELL = 42, top = SURFACE_Y - d.waveH;
    if (atk.t === 0) { b.armT = 1; hint(b, atk, 'skWave', 'Arm-fin slap: a mud wave rolls along the flat - stay above the crest', [{ x: 0, y: 0, w: W, h: top - 10 }]); }
    if (atk.t < TELL) { atk.tell = 1; return false; }
    if (atk.t === TELL) {
      b.armT = -0.4; atk.tell = 0;
      const fx0 = toWorld(b, -40, 40).x;
      splash(b, world, fx0, 30, 4.5, true);
      fxCall('addShake', world, 4); sfx('explodeS');
      fxCall('mudWake', world, fx0, SURFACE_Y);
      b.mwave = { x: fx0 - 10, top, spd: d.waveSpd, atk: atk.id, cause: 'skWave', mud: true };
    }
    if (atk.t === TELL + 16) b.armT = 0;
    return atk.t > TELL + 10 && !b.mwave;
  },

  // ---- CHASE -------------------------------------------------------------------
  // the outermost tail segment coils + glows at a stable height (window) → skip → landing spray
  skip(world, b, atk) { return skipCore(world, b, atk, false); },
  bigskip(world, b, atk) { return skipCore(world, b, atk, true); },
  // MUD WALL: preview (ghost wall + glowing gate at the boss) → the wall is thrown; double = 2 walls
  volley(world, b, atk) {
    const d = D(b), TELL = atk.isSub ? 34 : 44, IV2 = 36;
    if (atk.t === 0) {
      const kind = atk.kind || world.rng.pick(d.wallKinds);
      const p = tgt(world);
      atk.plans = [planWall(world, b, kind === 'double' ? 'gate' : kind, d, p.y)];
      if (kind === 'double') {
        const g0 = atk.plans[0].gy, dir = g0 > H / 2 ? -1 : 1;
        const p2 = planWall(world, b, 'gate', d, g0 + dir * world.rng.range(52, 74));
        atk.plans.push(p2);
      }
      atk.kind = kind; atk.n = 0;
      b.armT = 0.8;
      // the wall rises out of the water in front of the boss (left of its tail spring)
      atk.x0 = Math.min(W - 40, b.x - 70);
      b.wallPrev = { x: atk.x0, plans: atk.plans, t: 0, T: TELL, atk: atk.id };
      sfx('mudLob');
      hint(b, atk, 'skVolley', kind === 'soft' ? 'No gap: shoot open the glowing SOFT part, then slip through' : 'Be in the glowing gate when the mud wall arrives',
        [{ x: 0, y: atk.plans[0].gy - atk.plans[0].gh / 2 + 6, w: W, h: atk.plans[0].gh - 12 }]);
    }
    if (b.wallPrev && b.wallPrev.atk === atk.id) b.wallPrev.t = atk.t;
    const k = atk.t - TELL;
    if (k === 0 || (k === IV2 && atk.plans.length > 1)) {
      const plan = atk.plans[atk.n++];
      makeWall(world, b, atk, atk.x0, plan, d);
      b.armT = -0.5; sfx('missile'); sfx('mudLob'); splash(b, world, atk.x0, 18, 4, true);
      fxCall('mudWake', world, atk.x0, SURFACE_Y);
      fxCall('addShake', world, 1.5);
      if (atk.n >= atk.plans.length) b.wallPrev = null;
      else b.wallPrev.plans = atk.plans.slice(atk.n);
      atk.lastT = atk.t;
    } else if (k > 0 && k < 14) b.armT = -0.5; else if (k >= 14) b.armT = 0;
    // MUD SPIT: aimed fans from the tail nozzle as the (first) wall flies - dodge on the way into the gate
    if (k >= 0 && d.spitN && k % 22 === 6 && (k - 6) / 22 < d.spitFans) {
      const nz = nozzlePos(b), n = d.spitN, a0 = aimLead(world, nz.x, nz.y, d.spitSpd, d.spitLead ?? 0.3);
      for (let i = 0; i < n; i++) bullets.fire(world, { x: nz.x - 4, y: nz.y, ang: a0 + (i - (n - 1) / 2) * (d.spitStep ?? 0.2), spd: d.spitSpd, type: 'orb', color: 'orange', cause: 'skSpit', atk: atk.id });
      sfx('mudLob');
      for (let i = 0; i < 4; i++) b.splash.push({ x: nz.x, y: nz.y, vx: -world.fxRng.range(0.5, 2), vy: world.fxRng.range(-1, 1), t: 0, c: 2, free: 1 });
    }
    atk.tell = k < 0 ? 1 : 0;
    return atk.n >= atk.plans.length && atk.t - atk.lastT > (atk.isSub ? 20 : 46);
  },
  cannon(world, b, atk) { return cannonCore(world, b, atk, false); },
  gigaCannon(world, b, atk) { return cannonCore(world, b, atk, true); },
};

// ---- HYDRO CANNON ---------------------------------------------------------------------------------
// charge (aim tracks the ship; dim striped band + gathering spray + darkening) → lock (band freezes,
// stripes flash) → FIRE (thick jet erasing bullets, shake) → fade. GIGA: twice, the second lock
// with a mud wall whose gate lies in the safe zone. (If the outer segment breaks during the charge
// — only possible via bare-hull damage — the pressure is lost: CANNON BROKEN bonus, no beam.)
const MAX_TILT = 0.2;
function cannonCore(world, b, atk, giga) {
  const d = D(b), shots = giga ? d.cannonShots : 1, hh = d.cannonHalf + (giga ? 2 : 0);
  if (atk.t === 0) { atk.n = 0; atk.u = 0; atk.ang = Math.PI; if (giga) b.flare = 1; }
  const CH = atk.n === 0 ? d.cannonCharge : d.cannonRe || d.cannonCharge, FI = d.cannonFire, LOCK = CH - (atk.n === 0 ? 28 : 26);
  const u = atk.u++;
  b.y += (CHASE_Y - b.y) * 0.15; b.x += (CHASE_X + 6 - b.x) * 0.06;
  const nz = nozzlePos(b);
  // the segment broke during the charge → pressure lost: no beam
  if (atk.broken) {
    b.cannon = null; b.coilT = 0;
    if (!atk.fizzT) { atk.fizzT = atk.t; for (let k = 0; k < 10; k++) b.splash.push({ x: nz.x, y: nz.y, vx: world.fxRng.range(-2.5, 0.5), vy: -world.fxRng.range(0.5, 2.6), t: 0, c: 1, free: 1 }); fxCall('explode', world, nz.x, nz.y, 'medium', { debris: ['#9fe0f6', '#5a4430'] }); sfx('explodeS'); world.score += 3000; emit(world, { type: 'thread', x: nz.x, y: nz.y, value: 3000, label: 'CANNON BROKEN' }); }
    b.safeHint = null;
    return atk.t - atk.fizzT > 30;
  }
  if (u < CH) {
    b.coilT = 1; atk.phase = 'charge';
    if (u <= LOCK) {
      const p = tgt(world);
      const want = Math.atan2(p.y - nz.y, p.x - nz.x);
      let dev = want - Math.PI; if (dev < -Math.PI) dev += Math.PI * 2;
      atk.ang = Math.PI + clamp(dev, -MAX_TILT, MAX_TILT);
      if (u === LOCK) { sfx('laserCharge'); atk.locked = 1; }
    }
    b.a = (atk.ang - Math.PI) * -0.4;
    if ((b.t & 3) === 0) b.splash.push({ x: nz.x + world.fxRng.range(-30, -12), y: nz.y + world.fxRng.range(-14, 14), vx: world.fxRng.range(1.2, 2.2), vy: world.fxRng.range(-0.4, 0.4), t: 0, c: (b.t >> 2) & 1, free: 1 });
    if (u % 12 === 0) fxCall('addShake', world, 1);
    b.cannon = { x: nz.x, y: nz.y, a: atk.ang, hh, state: u <= LOCK ? 'charge' : 'lock', k: u / CH, u, giga };
  } else if (u < CH + FI) {
    atk.phase = 'fire'; b.coilT = 0.3;
    if (u === CH) {
      sfx('gigaFire'); world.flash = Math.max(world.flash, giga ? 0.55 : 0.4); world.hitstop = Math.max(world.hitstop, 3);
      fxCall('addShake', world, giga ? 6 : 4);
      splash(b, world, nz.x, 20, 4, false);
      // GIGA desperation combo: as the second beam fires, a mud wall is thrown whose gate sits on the
      // ship's own side of the band (decided now, once the ship has dodged; never across the beam)
      if (giga && atk.n === 1) {
        const p = tgt(world), ta = Math.tan(atk.ang), hv = hh / Math.abs(Math.cos(atk.ang));
        const gh = d.wallGap + 4, yAt = (x) => nz.y + (x - nz.x) * ta, above = p.y < yAt(p.x);
        const edge = above ? Math.min(yAt(0), yAt(140)) - hv - 10 : Math.max(yAt(0), yAt(140)) + hv + 10;
        const lo = above ? 18 + gh / 2 : edge + gh / 2, hi = above ? edge - gh / 2 : H - 12 - gh / 2;
        if (hi >= lo) {
          atk.combo = { kind: 'gate', gy: clamp(p.y + (above ? -10 : 10), lo, hi), gh };
          b.wallPrev = { x: Math.min(W - 40, b.x - 70), plans: [atk.combo], t: 0, T: 20, atk: atk.id };
        }
      }
    }
    if (b.wallPrev && b.wallPrev.atk === atk.id) b.wallPrev.t = u - CH;
    if (atk.combo && u === CH + 20) { makeWall(world, b, atk, b.wallPrev ? b.wallPrev.x : b.x - 70, atk.combo, d); b.wallPrev = null; atk.combo = null; sfx('mudLob'); }
    if (u % 4 === 0) fxCall('addShake', world, giga ? 3 : 2);
    const ca = Math.cos(atk.ang), sa = Math.sin(atk.ang);
    // the jet erases bullets in its path
    if (u % 3 === 0 && typeof bullets.vortex === 'function') for (let s = 16; s < 460; s += hh * 1.4) { const x = nz.x + ca * s, y = nz.y + sa * s; if (x < -20) break; bullets.vortex(world, x, y, hh, 0, hh); }
    const hb = player.playerHitbox(world);
    if (hb && !(b.cannonCd > 0)) {
      const rx = hb.x - nz.x, ry = hb.y - nz.y, along = rx * ca + ry * sa, perp = Math.abs(rx * sa - ry * ca);
      if (along > 0 && perp < hh - 3 + hb.r) { b.cannonCd = 20; hurtPlayer(world, { kind: 'laser', cause: 'skCannon', atk: atk.id, x: nz.x, y: nz.y }); }
    }
    if ((b.t & 1) === 0) for (let k = 0; k < 2; k++) { const s = world.fxRng.range(20, 260); b.splash.push({ x: nz.x + ca * s, y: nz.y + sa * s + (k ? hh : -hh) * 0.9, vx: world.fxRng.range(-1.5, 0.5), vy: (k ? 1 : -1) * world.fxRng.range(0.4, 1.6), t: 0, c: 1, free: 1 }); }
    b.cannon = { x: nz.x, y: nz.y, a: atk.ang, hh, state: 'fire', k: 1, u: u - CH, giga };
  } else if (u < CH + FI + 16) {
    b.cannon = { x: nz.x, y: nz.y, a: atk.ang, hh, state: 'fade', k: 1 - (u - CH - FI) / 16, u, giga };
    atk.phase = 'fade';
  } else {
    b.cannon = null; b.a *= 0.8;
    if (atk.n + 1 < shots) { atk.n++; atk.u = 0; atk.locked = 0; return false; }
    if (u > CH + FI + 30) return true;
  }
  if (b.cannonCd > 0) b.cannonCd--;
  // safe zone: above / below the (possibly tilted) band — known once the aim LOCKS (it tracks you before)
  if (b.cannon && b.cannon.state === 'charge') { hint(b, atk, 'skCannon', 'Hydro cannon: it aims at you until the band locks - then get above or below it'); }
  else if (b.cannon) {
    const ta = Math.tan(atk.ang), yAt = (x) => nz.y + (x - nz.x) * ta, hv = hh / Math.abs(Math.cos(atk.ang));
    const ya = yAt(0), yb = yAt(nz.x - 10), top = Math.min(ya, yb) - hv - 8, bot = Math.max(ya, yb) + hv + 8;
    hint(b, atk, 'skCannon', 'Hydro cannon locked: get above or below the striped band', [{ x: 0, y: 0, w: nz.x - 10, h: top }, { x: 0, y: bot, w: nz.x - 10, h: H - bot }]);
  }
  return false;
}

function skipCore(world, b, atk, big) {
  const d = D(b), left = segsLeft(b), frac = left / SEGS;
  const COIL = atk.demo ? d.coilT + 40 : d.coilT;
  const slam = big && d.slamDx ? d.slamDx : 0;
  if (atk.t === 0) {
    atk.seg = outerSeg(b);
    hint(b, atk, 'skSkip', 'The glowing tail segment is open: shoot it before it skips');
    b.safeHint.rects = [];
    if (big) b.flare = 1;
  }
  if (atk.t < COIL) {
    b.coilT = 1;
    b.y += (CHASE_Y - b.y) * 0.2; b.x += (CHASE_X - b.x) * 0.05;
    if ((b.t & 7) === 0) splash(b, world, b.x - 20 + world.fxRng.range(-30, 30), 3, 2);
    // slam: the landing shadow is shown on the water during the whole coil (where NOT to be)
    if (slam) b.landing = { x: CHASE_X - slam, k: 0.25 + 0.5 * atk.t / COIL, slam: 1 };
    return false;
  }
  // airborne: height/time shrink per broken segment (it gets easier to keep up)
  const T = Math.round(d.skipT * (0.6 + 0.4 * frac)), Hh = d.skipH * (0.45 + 0.55 * frac);
  const u = (atk.t - COIL) / T;
  if (atk.t === COIL) {
    b.coilT = 0; b.air = true; b.slam = !!slam; sfx('skip');
    splash(b, world, b.x - 30, 26, 4, true);
    fxCall('mudWake', world, b.x - 30, SURFACE_Y);
    if (slam) { sfx('bossRoar'); fxCall('addShake', world, 3); }
    hint(b, atk, slam ? 'skSlam' : 'skSkip', slam ? 'Body slam: keep clear of the shadow on the water' : 'Stay out from under its arc',
      slam ? [{ x: 0, y: 0, w: Math.max(40, CHASE_X - slam - 150), h: SURFACE_Y - 6 }, { x: 0, y: 0, w: W, h: 26 }] : [{ x: 0, y: 0, w: CHASE_X - 120, h: SURFACE_Y - 6 }]);
  }
  if (u < 1) {
    b.y = CHASE_Y - Hh * 4 * u * (1 - u);
    b.x = slam ? CHASE_X - slam * (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) : CHASE_X + Math.sin(u * Math.PI) * 18;
    b.a = (0.5 - u) * 0.35;
    b.landing = { x: slam ? CHASE_X - slam : b.x, k: slam ? 0.75 + 0.25 * u : u, slam: slam ? 1 : 0 };
    if (atk.t % 4 === 0) fxCall('mudWake', world, b.x - 40, SURFACE_Y);
    return false;
  }
  if (!atk.landed) {
    atk.landed = true; b.air = false; b.slam = false; b.y = CHASE_Y; b.a = 0; b.landing = null;
    splash(b, world, b.x - 10, big ? 60 : 36, big ? 6 : 4.5, true);
    fxCall('addShake', world, big ? 7 : 3); sfx(big ? 'explodeL' : 'explodeS');
    fxCall('mudWake', world, b.x, SURFACE_Y);
    if (slam) { fxCall('mudColumn', world, b.x - 10, SURFACE_Y); world.flash = Math.max(world.flash, 0.25); }
    const p = tgt(world), n = d.sprayN;
    for (let k = 0; k < n; k++) {
      const src = toWorld(b, 30, 10);
      lob(world, b, atk, src.x, Math.min(src.y, SURFACE_Y - 8), clamp(p.x + (k - (n - 1) / 2) * 34, 10, 260), clamp(p.y + (k % 2 ? 16 : -16), 18, SURFACE_Y - 10), 56 + k * 5, 'skSplash', 4);
    }
    b.rings.push({ x: b.x - 20, r: 6, spd: d.ringSpd || 2, atk: atk.id, t: -RING_TELL, n: RING_N, dead: 0 });
    if (big) b.mwave = { x: b.x - 70, top: SURFACE_Y - d.surgeH, spd: d.surgeSpd, atk: atk.id, cause: 'skSurge', mud: false };
    hint(b, atk, big ? 'skSurge' : 'skSplash', big ? 'Stay above the surge crest and clear of the cyan marks' : 'Landing spray: dodge the cyan marks',
      big ? [{ x: 0, y: 0, w: W, h: SURFACE_Y - d.surgeH - 10 }] : []);
    atk.landT = atk.t;
  }
  b.x += (CHASE_X - b.x) * (slam ? 0.045 : 0.06);
  return atk.t - atk.landT >= (big ? 60 : 40) && !(big && b.mwave);
}

// shock ring orbs: RING_N discrete orbs on the lower half-circle (fixed angles → visible gaps)
const RING_N = 17, RING_HIT = 4, RING_TELL = 18;
function ringOrb(g, k) { const a = ((k + 0.5) / g.n) * Math.PI, c = Math.cos(a), s = Math.sin(a); return { x: g.x + c * g.r, y: SURFACE_Y + s * g.r, c, s }; }

// crest profile: full height at the front face, sloping down behind (WAVE_L px long)
const WAVE_L = 56;
export function crestTop(wv, dx) {
  if (dx < -4 || dx > WAVE_L) return H + 10;
  const H0 = SURFACE_Y - wv.top, k = dx <= 8 ? 1 : Math.pow(Math.max(0, 1 - (dx - 8) / (WAVE_L - 8)), 1.3);
  return SURFACE_Y - H0 * k;
}

// ---- wall hit test (player shots): only the lit SOFT section is solid to shots ---------------------
export function hitWall(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.walls) return null;
  for (const w of b.walls) {
    if (w.open || Math.abs(x - w.x) > 6 + r) continue;
    const sh = wallShift(w);
    for (const c of w.clods) if (c.soft && !c.dead && Math.abs(y - (c.y0 + sh)) < 5 + r) return { kind: 'clod', part: 'clod', ref: w, mult: 1, x, y };
  }
  return null;
}
export function damageWall(world, hit, dmg) {
  const b = world.boss, w = hit.ref;
  if (!w || w.open) return;
  w.softHp -= dmg; w.flash = 3; world.score += 5;
  if ((b.t & 1) === 0) fxCall('debris', world, hit.x + 2, hit.y, world.fxRng.range(0.5, 2), -world.fxRng.range(0.3, 1.6), '#8a5a30');
  sfx('mudChip');
  if (w.softHp > 0) return;
  // BREACH: the whole soft section bursts open → your own gate
  w.open = true;
  const sh = wallShift(w);
  for (const c of w.clods) if (c.soft) { c.dead = true; fxCall('mudChunk', world, w.x, c.y0 + sh, world.fxRng.range(-0.5, 2), -world.fxRng.range(0.5, 2)); }
  for (const c of w.clods) if (!c.soft && Math.abs(c.y0 - w.gy) < w.gh / 2 + WALL_STEP + 1) c.gate = 1;
  fxCall('mudBurst', world, w.x, w.gy + sh);
  sfx('mudCrack'); fxCall('addShake', world, 1.5);
  world.score += 800;
  emit(world, { type: 'thread', x: w.x, y: w.gy + sh, value: 800, label: 'BREACH' });
}

// ---- mud clods + walls + crests ---------------------------------------------------------------------
export function updateSkHazards(world, b) {
  const hb = player.playerHitbox(world);
  const m = b.mud;
  for (let i = m.length - 1; i >= 0; i--) {
    const q = m[i];
    q.vy += q.g; q.x += q.vx; q.y += q.vy;
    if (q.mark && q.ty !== undefined && q.vy > 0 && q.y > q.ty + 4) q.mark = 0;
    if (q.vy > 0 && q.y >= SURFACE_Y + 2 && !q.sunk) {
      for (let k = 0; k < 4; k++) b.splash.push({ x: q.x, y: SURFACE_Y - 1, vx: world.fxRng.range(-1, 1), vy: world.fxRng.range(-2, -0.7), t: 0, c: 2 });
      if (b.half !== 2) { m.splice(i, 1); continue; }
      q.sunk = 1; q.vx *= 0.45; q.vy = 0.75; q.g = 0; q.mark = 0; // sinks slowly through the water
    }
    if (hb && (hb.x - q.x) ** 2 + (hb.y - q.y) ** 2 < (q.r * 0.8 + hb.r) ** 2) { hurtPlayer(world, { kind: 'bullet', cause: q.cause, atk: q.atk, x: q.x, y: q.y }); m.splice(i, 1); continue; }
    if (q.y > H + 10 || q.x < -20 || q.x > W + 20) m.splice(i, 1);
  }
  // MUD WALLS: rigid columns of clods; THREAD bonus when one passes you and you are alive
  const pl = world.player;
  let near = null;
  for (let i = b.walls.length - 1; i >= 0; i--) {
    const w = b.walls[i];
    w.t++; w.px = w.x; w.x += w.vx;
    if (w.flash > 0) w.flash--;
    const sh = wallShift(w);
    if (hb && Math.abs(hb.x - w.x) < CLOD_HIT + hb.r) {
      for (const c of w.clods) {
        if (c.dead) continue;
        const y = c.y0 + sh;
        if ((hb.x - w.x) ** 2 + (hb.y - y) ** 2 < (CLOD_HIT + hb.r) ** 2) { w.hitP = true; hurtPlayer(world, { kind: 'bullet', cause: 'skVolley', atk: w.atk, x: w.x, y }); break; }
      }
    }
    if (pl && pl.alive && !pl.entering && w.px >= pl.x && w.x < pl.x && !w.hitP) {
      const v = w.kind === 'soft' ? 600 : w.kind === 'gate' ? 400 : 500;
      world.score += v; sfx('thread');
      emit(world, { type: 'thread', x: pl.x, y: pl.y, value: v, label: 'THREAD' });
      for (let k = 0; k < 6; k++) b.splash.push({ x: w.x, y: gapNow(w) + world.fxRng.range(-w.gh / 3, w.gh / 3), vx: world.fxRng.range(0.5, 2), vy: world.fxRng.range(-1, 1), t: 0, c: 1, free: 1 });
    }
    if (pl && w.x > pl.x - 6 && (!near || w.x < near.x)) near = w;
    if (w.x < -24) b.walls.splice(i, 1);
  }
  // the incoming wall owns the safe-zone hint while it is close
  if (near && pl && near.x - pl.x < 230) {
    const gy = gapNow(near), gh = near.gh;
    b.safeHint = { cause: 'skVolley', atk: near.atk, text: near.open ? 'Be in the glowing gate when the mud wall arrives' : 'Shoot open the glowing SOFT part, then slip through',
      rects: [{ x: 0, y: Math.max(0, gy - gh / 2 + 6), w: Math.min(W, near.x + 6), h: Math.max(3, gh - 12) }] };
  }
  const wv = b.mwave;
  if (wv) {
    wv.x -= wv.spd;
    if (hb && hb.y + hb.r > crestTop(wv, hb.x - wv.x) && !(b.waveCd > 0)) { b.waveCd = 20; hurtPlayer(world, { kind: 'laser', cause: wv.cause, atk: wv.atk, x: wv.x, y: hb.y }); }
    if ((b.t & 3) === 0) splash(b, world, wv.x + 6, 2, 2.4, wv.mud);
    if (wv.x < -30) b.mwave = null;
  }
  if (b.waveCd > 0) b.waveCd--;
  // underwater SHOCK RINGS: after a bulge + flash at the landing point, a half-ring of discrete mud
  // orbs (same orb look/colour as every other enemy bullet) expands under the water. Each orb is its
  // own small hitbox (= its drawn size); the gaps between orbs are visibly safe.
  for (let i = b.rings.length - 1; i >= 0; i--) {
    const g = b.rings[i];
    g.t++;
    if (g.t < 0) continue; // telegraph (bulge + flash), harmless
    g.r += g.spd;
    if (hb && hb.y > SURFACE_Y) for (let k = 0; k < g.n; k++) {
      if (g.dead & (1 << k)) continue;
      const o = ringOrb(g, k);
      if (o.y < SURFACE_Y + 3) continue;
      if ((hb.x - o.x) ** 2 + (hb.y - o.y) ** 2 < (RING_HIT + hb.r) ** 2) { g.dead |= 1 << k; hurtPlayer(world, { kind: 'bullet', cause: 'skRing', atk: g.atk, x: o.x, y: o.y }); break; }
    }
    if (g.r > 330) b.rings.splice(i, 1);
  }}

export function skHazards(b, out) {
  for (const q of b.mud) out.push({ x: q.x, y: q.y, vx: q.vx, vy: q.vy, r: q.r, g: q.g, cause: q.cause, atk: q.atk });
  for (const w of b.walls) {
    const sh = wallShift(w), vy = w.amp ? w.amp * w.om * Math.cos(w.ph + w.t * w.om) : 0;
    for (const c of w.clods) if (!c.dead) out.push({ x: w.x, y: c.y0 + sh, vx: w.vx, vy, r: CLOD_HIT, g: 0, cause: 'skVolley', atk: w.atk });
  }
  for (const g of b.rings) {
    if (g.t < 0) continue;
    for (let k = 0; k < g.n; k++) {
      if (g.dead & (1 << k)) continue;
      const o = ringOrb(g, k);
      if (o.y > SURFACE_Y + 3 && o.y < H + 6) out.push({ x: o.x, y: o.y, vx: o.c * g.spd, vy: o.s * g.spd, r: RING_HIT, g: 0, cause: 'skRing', atk: g.atk });
    }
  }  const wv = b.mwave;
  if (wv) for (let dx = 0; dx <= WAVE_L; dx += 10) for (let y = crestTop(wv, dx) + 6; y < H; y += 12) out.push({ x: wv.x + dx, y, vx: -wv.spd, vy: 0, r: 8, g: 0, cause: wv.cause, atk: wv.atk });
}

// bot/beam contract: the cannon as a laser {x, y, a, w, state}
export function skLasers(b, out) {
  const C = b.cannon;
  if (C && C.state !== 'fade') out.push({ x: C.x, y: C.y, a: C.a, w: C.hh * 2, state: C.state === 'charge' ? 'charge' : C.state === 'lock' ? 'lock' : 'fire', atk: b.atk ? b.atk.id : 0 });
}

// ---- drawing --------------------------------------------------------------------------------------
function drawWallGate(ctx, x, y0, y1, t, a) {
  // Bright cyan brackets and approach chevrons; the aperture stays transparent.
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#9ef6ff';
  const cy = (y0 + y1) / 2, o = (t >> 2) % 3;
  for (let k = 0; k < 2; k++) { const cx = Math.round(x - 16 + k * 5 + o); ctx.fillRect(cx, Math.round(cy - 2), 1, 1); ctx.fillRect(cx + 1, Math.round(cy - 1), 1, 1); ctx.fillRect(cx + 2, Math.round(cy), 1, 1); ctx.fillRect(cx + 1, Math.round(cy + 1), 1, 1); ctx.fillRect(cx, Math.round(cy + 2), 1, 1); }
  ctx.fillStyle = '#9ef6ff'; for(const yy of [y0,y1-4]){ctx.fillRect(x-6,yy,1,4);ctx.fillRect(x+5,yy,1,4);} ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x - 6), Math.round(y0), 12, 1); ctx.fillRect(Math.round(x - 6), Math.round(y1) - 1, 12, 1);
  ctx.globalAlpha = 1;
}

function drawWalls(ctx, b) {
  // preview: ghost wall at the boss with its gate(s) — read the gap BEFORE it is thrown
  const P = b.wallPrev;
  if (P) {
    const blink = (P.t >> 2) & 1, reach = Math.min(1, (P.t + 6) / Math.max(10, (P.T || 40) * 0.7)) * (H * 0.75);
    P.plans.forEach((pl, i) => {
      const x = P.x - i * 10, a = i ? 0.5 : 1;
      ctx.save();ctx.beginPath();const gy=pl.gy+(pl.amp?Math.sin(pl.ph)*pl.amp:0);
      if(pl.kind!=='soft'){ctx.rect(x-22,0,44,gy-pl.gh/2);ctx.rect(x-22,gy+pl.gh/2,44,H-gy-pl.gh/2);}else ctx.rect(x-22,0,44,H);ctx.clip();
      // ghost wall grows out of the water surface (up and down), gate already marked
      ctx.globalAlpha = (0.45 + 0.2 * blink) * a;
      for (let y = -4; y <= H + 4; y += 9) {
        if (Math.abs(y - SURFACE_Y) > reach) continue;
        if (Math.abs(y - pl.gy) < pl.gh / 2 && pl.kind !== 'soft') continue;
        if(!paintedCurtain(ctx,x,y,Math.abs(Math.round((y+4)/9)),false,0,b.t,y>SURFACE_Y)){
          ctx.fillStyle = '#21150c'; ctx.fillRect(Math.round(x - 3), Math.round(y - 3), 6, 6);
          ctx.fillStyle = '#c89a62'; ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
        }
      }
      ctx.restore();ctx.globalAlpha = 1;
      if (pl.kind === 'soft') { ctx.globalAlpha = 0.5 + 0.4 * blink; ctx.fillStyle = '#ffb040'; for (let y = pl.gy - pl.gh / 2; y < pl.gy + pl.gh / 2; y += 9) ctx.fillRect(Math.round(x - 3), Math.round(y), 6, 5); ctx.globalAlpha = 1; }
      else drawWallGate(ctx, x, pl.gy - pl.gh / 2 + (pl.amp ? Math.sin(pl.ph) * pl.amp : 0), pl.gy + pl.gh / 2 + (pl.amp ? Math.sin(pl.ph) * pl.amp : 0), b.t, a * (0.6 + 0.4 * blink));
    });
  }
  for (const w of b.walls) {
    const sh = wallShift(w), x = Math.round(w.x);
    const g0=gapNow(w)-w.gh/2,g1=gapNow(w)+w.gh/2;
    // One moving aperture masks every cosmetic, including droplets and surface spray.
    ctx.save();ctx.beginPath();if(w.open){ctx.rect(x-22,0,44,Math.max(0,g0));ctx.rect(x-22,g1,44,H-g1);}else ctx.rect(x-22,0,44,H);ctx.clip();
    let prev=null;
    for(const c of w.clods){if(c.dead){prev=null;continue;}const y=c.y0+sh;
      if(prev!==null&&y-prev<=10){ctx.globalAlpha=1;ctx.fillStyle=y>SURFACE_Y?'#49372b':'#523622';ctx.beginPath();ctx.moveTo(x-3,prev);ctx.quadraticCurveTo(x-3.8,y-4,x-3,y);ctx.lineTo(x+3,y);ctx.quadraticCurveTo(x+3.6,prev+4,x+3,prev);ctx.fill();ctx.globalAlpha=1;}prev=y;
    }
    for(let ci=0;ci<w.clods.length;ci++){const c=w.clods[ci];if(c.dead)continue;const y=c.y0+sh,index=Math.abs(Math.round(c.y0/9));
      paintedCurtain(ctx,x,y,index,c.soft,0,b.t,y>SURFACE_Y);
      const age=(b.t+index*7)%27,side=index%2?1:-1;
      ctx.globalAlpha=.9*(1-age/40);ctx.fillStyle=y>SURFACE_Y?'#927052':'#b38a59';ctx.beginPath();ctx.ellipse(x+side*(8+age*.25),y-3+age*.25,.85,1.5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      if(c.soft&&w.flash>0&&(b.t&1)){ctx.globalAlpha=.6;ctx.fillStyle='#fff4d0';ctx.fillRect(x-3,y-3,6,6);ctx.globalAlpha=1;}
    }
    for(let k=0;k<5;k++){const age=(b.t+k*5)%24,side=k%2?1:-1;ctx.globalAlpha=.6*(1-age/24);ctx.fillStyle='#c39a6b';ctx.fillRect(x+side*age*.45,SURFACE_Y-Math.sin(age/24*Math.PI)*4,1.4,1);ctx.globalAlpha=1;}
    ctx.strokeStyle='#af8456';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-15,SURFACE_Y+2);ctx.lineTo(x-9,SURFACE_Y-3);ctx.lineTo(x-7,SURFACE_Y+1);ctx.lineTo(x-5,SURFACE_Y-5);ctx.lineTo(x,SURFACE_Y+2);ctx.lineTo(x+7,SURFACE_Y-4);ctx.lineTo(x+10,SURFACE_Y+1);ctx.lineTo(x+15,SURFACE_Y-1);ctx.stroke();
    for(let k=0;k<7;k++){const yy=SURFACE_Y+8+(b.t*.7+k*13)%(H-SURFACE_Y),side=k%2?1:-1;ctx.fillStyle='#8b6847';ctx.fillRect(x+side*(9+k%3*2),yy,1.5,2);ctx.strokeStyle='#adbaa2';ctx.lineWidth=.5;ctx.beginPath();ctx.arc(x-side*11,yy-4,1,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
    if (w.open) drawWallGate(ctx, w.x, gapNow(w) - w.gh / 2 + 2, gapNow(w) + w.gh / 2 - 2, b.t, 1);

  }
}

function hatchLine(ctx, x0, y0, ca, sa, len, off, step, col, alpha) {
  ctx.globalAlpha = alpha; ctx.fillStyle = col;
  for (let s = off % step; s < len; s += step) ctx.fillRect(Math.round(x0 + ca * s), Math.round(y0 + sa * s), 3, 1);
  ctx.globalAlpha = 1;
}
function drawCannon(ctx, b, S) {
  const C = b.cannon;
  if (!C) return;
  const ca = Math.cos(C.a), sa = Math.sin(C.a), len = Math.min(560, (C.x + 30) / Math.max(0.3, -ca));
  const nx = -sa, ny = ca; // band normal
  if (C.state === 'charge' || C.state === 'lock') {
    // striped warning band along the future beam (edges + diagonal hatch), flashes faster once locked
    const lock = C.state === 'lock', f = lock ? (b.t >> 1) & 1 : (b.t >> 3) & 1;
    const edgeCol = lock ? (f ? '#ffffff' : '#ff6a50') : '#a8f6ff', a = lock ? 0.95 : 0.35 + 0.4 * C.k;
    for (const s of [-1, 1]) hatchLine(ctx, C.x + nx * C.hh * s, C.y + ny * C.hh * s, ca, sa, len, b.t * 2, 6, edgeCol, a);
    ctx.globalAlpha = (lock ? 0.26 : 0.12 + 0.12 * C.k) * (f ? 1 : 0.6);
    ctx.fillStyle = lock ? '#ff9070' : '#a8f6ff';
    for (let s = (b.t * 2) % 14; s < len; s += 14) for (let v = -C.hh + 2; v < C.hh - 1; v += 3) ctx.fillRect(Math.round(C.x + ca * (s + v * 0.6) + nx * v), Math.round(C.y + sa * (s + v * 0.6) + ny * v), 2, 1);
    ctx.globalAlpha = 1;
    // gathering water/mud specks converging into the nozzle + growing glow
    ctx.fillStyle = '#d8fbff';
    for (let k = 0; k < 10; k++) { const ph = ((b.t * 0.04 + k * 0.1) % 1), ang = k * 2.4, r = 40 * (1 - ph); ctx.fillRect(Math.round(C.x + Math.cos(ang) * r), Math.round(C.y + Math.sin(ang) * r * 0.7), 2, 2); }
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, 0.3 + C.k);
    const sz = Math.round(14 + C.k * (C.giga ? 46 : 34));
    ctx.drawImage(S.tellGlow, Math.round(C.x - sz / 2), Math.round(C.y - sz / 2), sz, sz);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    return;
  }
  const B = getBeamArt(C.hh);
  const wob = C.state === 'fade' ? 0.35 + 0.6 * C.k : 1 + 0.07 * Math.sin(b.t * 1.7);
  const hh = C.hh * wob;
  ctx.save();
  ctx.translate(Math.round(C.x), Math.round(C.y)); ctx.rotate(C.a);
  const off = (b.t * 7) % B.L;
  for (let s = -off; s < len; s += B.L) ctx.drawImage(B.img, Math.round(s), Math.round(-hh), B.L, Math.round(hh * 2));
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + 0.25 * Math.sin(b.t * 0.9);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, Math.round(-hh * 0.25), Math.round(len), Math.max(2, Math.round(hh * 0.5)));
  ctx.globalAlpha = 0.9;
  ctx.drawImage(S.tellGlow, -26, -26, 52, 52);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

export function drawSkHazards(ctx, world, b, S, layer) {
  if (layer === 'under') {
    if (b.landing) {
      const k = clamp(b.landing.k, 0, 1), LW = b.landing.slam ? 150 * (0.5 + 0.5 * k) : 120 * (0.6 + 0.4 * Math.sin(k * Math.PI));
      ctx.globalAlpha = b.landing.slam ? 0.55 + 0.2 * ((b.t >> 2) & 1) : 0.45;
      ctx.drawImage(S.shadow, Math.round(b.landing.x - LW / 2), SURFACE_Y - 5, Math.round(LW), 10); ctx.globalAlpha = 1;
      if (b.landing.slam && (b.t >> 3) & 1) { ctx.fillStyle = '#ff6a50'; ctx.fillRect(Math.round(b.landing.x - LW / 2), SURFACE_Y - 7, Math.round(LW), 1); }
    }
    return;
  }
  // shock rings: telegraph = water bulge + flash at the source; then a half-ring of real orbs
  for (const g of b.rings) {
    if (g.t < 0) {
      const u = 1 + g.t / RING_TELL, x = Math.round(g.x), w = Math.round(10 + 26 * u);
      paintedSurface(ctx,x,SURFACE_Y,Math.floor(u*15),w*1.5);
      ctx.fillStyle='#427f96';ctx.beginPath();ctx.ellipse(x,SURFACE_Y,w/2,2+u*4,0,Math.PI,Math.PI*2);ctx.fill();ctx.strokeStyle='#c5e5e5';ctx.lineWidth=1;ctx.stroke();for(let j=0;j<7;j++){const a=j/6*Math.PI;ctx.fillStyle=j%2?'#f0dcc3':'#9ef6ff';ctx.fillRect(Math.round(x+Math.cos(a)*w*.5),Math.round(SURFACE_Y-Math.sin(a)*(2+u*4)),2,1);}
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ((g.t >> 1) & 1) ? 0.9 : 0.4;
      ctx.drawImage(S.orbGlow, x - 10, SURFACE_Y + 2, 20, 20); ctx.drawImage(S.tellGlow, x - 8, SURFACE_Y - 6, 16, 16);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      continue;
    }
    for (let k = 0; k < g.n; k++) {
      if (g.dead & (1 << k)) continue;
      const o = ringOrb(g, k);
      if (o.y < SURFACE_Y + 3 || o.y > H + 6 || o.x < -8 || o.x > W + 8) continue;
      const x = Math.round(o.x), y = Math.round(o.y);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.drawImage(S.orbGlow, x - 10, y - 10);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(S.orbM, x - (S.orbM.width >> 1), y - (S.orbM.height >> 1));
    }
  }  drawWalls(ctx, b);
  drawCannon(ctx, b, S);
  for (const q of b.mud) {
    for(let j=1;j<4;j++){ctx.globalAlpha=.35/j;ctx.fillStyle=j&1?'#b28a5b':'#61442e';ctx.fillRect(Math.round(q.x-q.vx*j*1.3),Math.round(q.y-q.vy*j*1.3),2,1);}ctx.globalAlpha=1;
    const o = q.r <= 3 ? S.orbS : q.r >= 6 ? S.orbL : S.orbM;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
    ctx.drawImage(S.orbGlow, Math.round(q.x) - 10, Math.round(q.y) - 10);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if(!paintedCell(ctx,'clods',Math.abs(Math.round(q.tx+q.ty))%8,q.x-q.r*1.5,q.y-q.r*1.5,q.r*3,q.r*3))ctx.drawImage(o, Math.round(q.x) - (o.width >> 1), Math.round(q.y) - (o.height >> 1));
    // Orange danger core stays above the painted, splattering silhouette.
    ctx.fillStyle='#ff963b';ctx.fillRect(Math.round(q.x)-1,Math.round(q.y)-1,2,2);
    if (q.mark && q.tx !== undefined) {
      const x = Math.round(q.tx), y = Math.round(q.ty);
      ctx.fillStyle = '#06121a'; ctx.fillRect(x - 6, y - 2, 13, 4); ctx.fillRect(x - 2, y - 6, 4, 13);
      ctx.fillStyle = '#9ef6ff'; ctx.fillRect(x - 5, y - 1, 4, 2); ctx.fillRect(x + 2, y - 1, 4, 2); ctx.fillRect(x - 1, y - 5, 2, 4); ctx.fillRect(x - 1, y + 2, 2, 4);
    }
  }
  const wv = b.mwave;
  if (wv) {
    // one bright, readable crest: a curling wall with a sloping back; churned mud below the surface
    const x0 = Math.round(wv.x);
    const pal = wv.mud ? ['#2a1c12', '#3e2c1c', '#5a4430', '#7a6040', '#a08460'] : ['#0a2238', '#123a58', '#1e5878', '#3a86ae', '#8ad0ee'];
    for (let dx = -4; dx <= WAVE_L; dx += 2) {
      const top = Math.round(crestTop(wv, dx)), x = x0 + dx;
      const face = dx < 6 ? 3 : dx < 16 ? 2 : dx < 34 ? 1 : 0;
      ctx.fillStyle = pal[face]; ctx.fillRect(x, top, 2, H - top);
      ctx.fillStyle = pal[Math.min(4, face + 1)]; ctx.fillRect(x, top, 2, 2);
      if (((dx + (b.t >> 1)) & 6) === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, top - 1, 2, 1); }
    }
    // the whole crest body is damaging: hot danger tint + a bright front face down to the sea floor
    // (reads clearly under the water too, matching the hit area)
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22 + 0.08 * ((b.t >> 2) & 1); ctx.fillStyle = '#ff7a30';
    for (let dx = -4; dx <= WAVE_L; dx += 2) { const tp = Math.round(crestTop(wv, dx)); ctx.fillRect(x0 + dx, tp, 2, H - tp); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = (b.t >> 2) & 1 ? '#ffffff' : '#ffb040'; ctx.fillRect(x0 - 4, Math.round(wv.top) + 2, 2, H - Math.round(wv.top));
    const top = Math.round(wv.top);
    paintedCell(ctx,'water',8+((b.t>>3)%4),x0-15,top-24,48,32,.7);
    for(let j=0;j<18;j++){const age=(b.t+j*7)%26,vx=-.5-j%3*.3,vy=-2.4+j%4*.23;drawSpray(ctx,x0+12+j%5*3+vx*age,top+3+vy*age+.065*age*age,vx,vy+.13*age,age*2,wv.mud,j);}
    // curling lip overhanging the front + bright rim (the readable edge)
    ctx.fillStyle = pal[3]; ctx.fillRect(x0 - 8, top + 1, 12, 4); ctx.fillRect(x0 - 9, top + 4, 4, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 - 8, top - 1, 24, 2); ctx.fillRect(x0 - 10, top + 2, 2, 6);
    ctx.fillStyle = '#9ef6ff'; ctx.fillRect(x0 + 16, top, 10, 1);
    ctx.fillStyle = pal[4];
    for (let y = top + 10 + ((b.t * 3) % 9); y < H; y += 9) ctx.fillRect(x0 - 2 + ((y * 7) % 5), y, 2, 3);
  }
}
