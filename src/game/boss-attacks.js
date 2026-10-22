// Boss attack patterns, lasers and spectacle hazards. Owned by the boss agent.
// Each attack is a function (world, b, atk, pose) → true when finished; atk.t
// counts frames from 0. Attacks drive pose channels (b.jawT, b.tailCurlT,
// atk.flare, b.mawGlow, b.portGlow) for anticipation, then fire through
// bullets.fire. Every number that sets difficulty comes from DIFFICULTY (boss.js).
//
// Every hazard carries a cause id (bullets: spec.cause; lasers/rocks/contact:
// player.hurt source.cause). CAUSES[id] = { name, hint } for the death screen.
// While an attack runs, b.safeHint = { cause, rects:[{x,y,w,h}], text } (else null).
import { W, H } from '../config.js';
import { easeInOutSine, clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { child, sfx, aimAt, aimLead, hurtPlayer, fxCall } from './boss-util.js';
import { heat, DIFFICULTY } from './boss-axolotl.js';
import { TAIL } from './boss-parts.js';
const TAILR = TAIL.r;

// ---- death attribution ------------------------------------------------------
export const CAUSES = {
  gillBurst: { name: 'GILL VOLLEY', hint: 'Gill tips flash before each burst: drift one way, reverse after the last burst' },
  jawSpread: { name: 'JAW SPREAD', hint: 'Jaw opens = fans incoming: step sideways into a gap between volleys' },
  tailSweep: { name: 'TAIL NEEDLES', hint: 'Tail lights race up: move low and left before the whip' },
  coreNeedles: { name: 'CORE NEEDLES', hint: 'Core glows = 3 fast aimed trios: one short sidestep per trio' },
  eggCluster: { name: 'LARVA SWARM', hint: 'Shoot the eggs right away; larvae home in slowly - keep moving' },
  bubbleWall: { name: 'BUBBLE WALL', hint: 'Blue arrows mark the next gap: be in it before the wall arrives' },
  rings: { name: 'SPIRAL RINGS', hint: 'Back off left as the jaw opens; weave through the ring gaps' },
  laser: { name: 'MOUTH LASER', hint: 'When the red line stops blinking, move to the marked side - it sweeps away' },
  gigaLaser: { name: 'GIGA LASER', hint: 'Screen darkens + stripes: get above or below the striped band' },
  rockRain: { name: 'CEILING COLLAPSE', hint: 'Stand in a lit column; switch only when the arrows move' },
  dashCharge: { name: 'BODY CHARGE', hint: 'Striped band = its path: fly to the other half before it lunges' },
  flameRings: { name: 'FLAME RINGS', hint: 'Keep far left; slip through the missing wedge of each ring' },
  contact: { name: 'BODY CONTACT', hint: 'Keep left of the head - the boss body kills on touch' },
  fry: { name: 'FRY SCHOOL', hint: 'Shoot the school, or leave its lane before it reaches you' },
  gillSnipe: { name: 'GILL SNIPE', hint: 'A gill tip flashes white, then fires at where you are going: change direction then' },
  fryShot: { name: 'GUNNER FRY', hint: 'Red-glowing fry fire once when they pass: sidestep then' },
};
export const BIG = new Set(['gigaLaser', 'rockRain', 'dashCharge']);
// strong attacks: schools don't spawn and gunner fry hold fire while these run
export const STRONG = new Set(['laser', 'bubbleWall', 'rings', 'eggCluster', 'gigaLaser', 'rockRain', 'dashCharge', 'flameRings']);

export const POOLS = {
  1: ['gillBurst', 'jawSpread', 'tailSweep', 'coreNeedles'],
  2: ['gillBurst', 'jawSpread', 'eggCluster', 'bubbleWall', 'tailSweep', 'coreNeedles'],
  3: ['rings', 'jawSpread', 'eggCluster', 'bubbleWall', 'gillBurst', 'tailSweep', 'coreNeedles'],
  4: ['rockRain', 'dashCharge', 'flameRings', 'gillBurst', 'jawSpread', 'coreNeedles'],
};

const D = (b) => DIFFICULTY[b.phase] || DIFFICULTY[3];
// id of the attack instance currently creating hazards (stamped on bullets, hints, hurts)
let ATK = 0;
export function setAtk(id) { ATK = id; }
const shoot = (world, x, y, a, spd, type, extra) =>
  bullets.fire(world, { x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, type, atk: ATK, ...extra });
const clampRect = (q) => { const x = Math.max(0, q.x), y = Math.max(0, q.y); const w = Math.min(W, q.x + q.w) - x, h = Math.min(H, q.y + q.h) - y; return w > 1 && h > 1 ? { x, y, w, h } : null; };
// surge: bullets leave slow and accelerate to (1 + surge/2) x their nominal speed
const surge = (spd, d) => (d.surge ? { accel: spd * d.surge * 0.03, maxSpd: spd * (1 + d.surge * 0.5) } : {});
const hint = (b, cause, text, rects = []) => { b.safeHint = { cause, atk: ATK, rects: rects.map(clampRect).filter(Boolean), text }; };

// the outermost tail segment that is on screen (tail sweep fires/telegraphs from here)
export function tailFirePoint(P) {
  for (let i = P.tail.length - 1; i >= 0; i--) {
    const s = child(P.tail[i], TAIL.len * 0.5, 0);
    if (s.x < W - 8 && s.y > 8 && s.y < H - 8) return s;
  }
  return child(P.tail[0], 4, 0);
}

export const ATTACKS = {
  // gills flare + tips glow (36f), then aimed volleys from every live gill tip.
  gillBurst(world, b, atk, P) {
    const d = D(b), n = d.gillVolleys, step = d.gillStep;
    atk.flare = atk.t < 36 + n * step ? 1 : 0;
    if (atk.t === 0) hint(b, 'gillBurst', n + ' aimed bursts: drift one way, reverse after the last one');
    // readable cadence: gill tips flash white 10f before each burst
    const k0 = atk.t - 26;
    atk.tell = k0 >= 0 && k0 < n * step && (k0 % step) < 10 ? 1 - (k0 % step) / 10 : 0;
    if (atk.t >= 36 && atk.t < 36 + n * step && (atk.t - 36) % step === 0) {
      const spd = d.spd * (b.phase === 1 ? 1.35 + 0.2 * heat(b) : 1.5);
      b.gills.forEach((g, i) => {
        if (g.state !== 'alive') return;
        const tip = P.gills[i].tip;
        shoot(world, tip.x, tip.y, aimLead(world, tip.x, tip.y, spd, d.lead) + ((i % 3) - 1) * 0.06, spd * (1 - d.surge), 'orb', { color: b.phase === 4 ? 'orange' : 'pink', cause: 'gillBurst', ...surge(spd, d) });
      });
    }
    return atk.t >= 36 + n * step + 24;
  },
  // jaw opens (32f) with a red maw glow, then aimed n-way spreads.
  jawSpread(world, b, atk, P) {
    const d = D(b);
    const vol = b.phase === 1 ? (heat(b) < 0.5 ? 2 : 3) : d.spreadVolleys;
    const iv = d.spreadEvery;
    const end = 32 + vol * iv;
    b.jawT = atk.t < end + 4 ? 1 : 0;
    b.mawGlow = atk.t < end ? Math.min(0.8, atk.t / 30) : 0;
    if (atk.t === 0) hint(b, 'jawSpread', vol + ' fans from the jaw: sidestep into a gap after each fan');
    if (atk.t >= 32 && atk.t < end && (atk.t - 32) % iv === 0) {
      const v = (atk.t - 32) / iv;
      const n = d.spreadN, st = d.spreadStep;
      const m = P.mouth;
      const a0 = aimAt(world, m.x, m.y) + (d.spreadAlt && v % 2 ? st / 2 : 0);
      const spd = d.spd * (b.phase === 1 ? 1.5 + 0.2 * heat(b) : 1.6);
      for (let k = 0; k < n; k++) shoot(world, m.x, m.y, a0 + (k - (n - 1) / 2) * st, spd * (1 - d.surge), 'orb', { r: 4, color: 'orange', cause: 'jawSpread', ...surge(spd, d) });
    }
    return atk.t >= end + 24;
  },
  // tail rears over the back (70f, tip glows), whips forward spitting a needle curtain (30f), settles.
  tailSweep(world, b, atk, P) {
    const d = D(b);
    b.tailCurlT = atk.t < 70 ? 1 : atk.t < 100 ? -0.2 : 0;
    b.headDip = atk.t < 70 ? -0.06 * Math.min(1, atk.t / 30) : atk.t < 100 ? 0.04 : 0; // rear up, then lunge
    atk.tipGlow = atk.t < 100 ? Math.min(1, atk.t / 50) : 0;
    if (atk.t === 0) hint(b, 'tailSweep', CAUSES.tailSweep.hint);
    if (atk.t >= 70 && atk.t < 100 && atk.t % 3 === 0) {
      const tip = tailFirePoint(P);
      const u = (atk.t - 70) / 30;
      const a = Math.PI + (-0.5 + u * 1.0);
      shoot(world, tip.x, tip.y, a, d.needleSpd, 'needle', { color: 'magenta', cause: 'tailSweep' });
      if (b.phase >= 2) shoot(world, tip.x, tip.y, a + 0.18, d.needleSpd * 0.87, 'needle', { color: 'magenta', cause: 'tailSweep' });
    }
    return atk.t >= 140;
  },
  // flank core charges (30f) then fires 3 bursts of 3 fast aimed needles.
  coreNeedles(world, b, atk, P) {
    const d = D(b);
    const nb = d.coreBursts || 3, end = 30 + nb * 14;
    b.portGlow = atk.t < 30 ? atk.t / 30 : atk.t < end ? 0.8 : 0;
    if (atk.t === 0) hint(b, 'coreNeedles', CAUSES.coreNeedles.hint);
    if (atk.t >= 30 && atk.t < end && (atk.t - 30) % 14 === 0) {
      const c = P.port;
      const a = aimLead(world, c.x - 10, c.y, d.coreSpd, d.lead);
      for (let k = -1; k <= 1; k++) shoot(world, c.x - 10, c.y, a + k * 0.13, d.coreSpd * (1 - d.surge), 'needle', { color: 'red', cause: 'coreNeedles', ...surge(d.coreSpd, d) });
    }
    return atk.t >= end + 18;
  },
  // jaw opens and spits a cluster of drifting eggs that hatch into slow homing larvae.
  eggCluster(world, b, atk, P) {
    const d = D(b);
    b.jawT = atk.t < 60 ? 1 : 0;
    b.mawGlow = atk.t < 40 ? atk.t / 50 : 0;
    if (atk.t === 0) hint(b, 'eggCluster', CAUSES.eggCluster.hint);
    if (atk.t === 34) {
      const m = P.mouth;
      for (let k = 0; k < d.eggN; k++) {
        const a = Math.PI + (k - (d.eggN - 1) / 2) * 0.32 + world.rng.range(-0.08, 0.08);
        shoot(world, m.x, m.y, a, world.rng.range(1.2, 1.7), 'egg', {
          r: 5, hatch: 70 + k * 10, color: 'pink', cause: 'eggCluster',
          onHatch: (w2, egg, id = egg.atk) => {
            const base = aimAt(w2, egg.x, egg.y);
            for (let q = 0; q < d.larvaN; q++) {
              const aa = base + (q - (d.larvaN - 1) / 2) * 0.45;
              bullets.fire(w2, { type: 'larva', x: egg.x, y: egg.y, ang: aa, spd: d.larvaSpd, homing: true, homeFrames: 50, turn: 0.03, color: 'pink', cause: 'eggCluster', atk: id });
            }
          },
        });
      }
      sfx('missile');
    }
    return atk.t >= 80;
  },
  // gills flare (40f) and release walls of bubbles from the right edge, each with a gap.
  bubbleWall(world, b, atk) {
    const d = D(b);
    const walls = d.walls;
    atk.flare = atk.t < 40 ? 1 : 0;
    if (atk.t === 0) {
      const p = world.player;
      const py = p && p.alive ? p.y : H / 2;
      atk.gaps = [Math.max(34, Math.min(H - 34, py + world.rng.range(-40, 40)))];
      for (let w = 1; w < walls; w++) atk.gaps.push(Math.max(34, Math.min(H - 34, atk.gaps[w - 1] + world.rng.sign() * world.rng.range(36, 56))));
    }
    // telegraph the gap of the next wall for 36f before it spawns (right-edge arrows)
    atk.tell = null;
    for (let w = 0; w < walls; w++) { const s = 40 + w * 64; if (atk.t >= s - 36 && atk.t < s) atk.tell = atk.gaps[w]; }
    for (let w = 0; w < walls; w++) {
      if (atk.t !== 40 + w * 64) continue;
      const gy = atk.gaps[w];
      let above = -99, below = 999;
      for (let y = 6; y <= H - 4; y += 12) {
        if (Math.abs(y - gy) < d.wallGap) continue;
        if (y < gy) above = Math.max(above, y); else below = Math.min(below, y);
        bullets.fire(world, { x: W + 6, y, vx: -d.wallSpd, vy: 0, type: 'bubble', r: 5, cause: 'bubbleWall', atk: ATK });
      }
      // the real opening between the nearest bubbles (bubble r 5, hit r ~3.5)
      b.walls.push({ x: W + 6, vx: -d.wallSpd, y0: above + 7, y1: below - 7, gy, atk: ATK });
    }
    return atk.t >= 40 + (walls - 1) * 64 + 30;
  },
  // P3: dense rotating rings from the maw (alternating spin, curving bullets).
  rings(world, b, atk, P) {
    const d = D(b);
    const n = d.ringN, cnt = d.rings, iv = 17;
    b.jawT = atk.t < 30 + cnt * iv + 20 ? 1 : 0;
    b.mawGlow = atk.t < 30 ? atk.t / 30 : atk.t < 30 + cnt * iv ? 0.7 : 0;
    if (atk.dir === undefined) { atk.dir = world.rng.sign(); hint(b, 'rings', CAUSES.rings.hint); }
    if (atk.t >= 30 && atk.t < 30 + cnt * iv && (atk.t - 30) % iv === 0) {
      const k = (atk.t - 30) / iv;
      const m = P.mouth;
      const off = k * 0.11 * atk.dir;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        bullets.fire(world, { atk: ATK, x: m.x + 6, y: m.y, ang: a, spd: d.ringSpd, angVel: 0.0035 * atk.dir * (k % 2 ? -1 : 1), type: 'orb', color: k % 2 ? 'violet' : 'pink', cause: 'rings' });
      }
    }
    return atk.t >= 30 + cnt * iv + 30;
  },
  // P4: flame rings - faster fire rings with a missing wedge (the gap) that rotates ring to ring.
  flameRings(world, b, atk, P) {
    const d = D(b);
    const cnt = d.rings, iv = 20;
    atk.flare = 1;
    b.jawT = atk.t < 30 + cnt * iv + 20 ? 1.1 : 0;
    b.mawGlow = atk.t < 30 + cnt * iv ? Math.min(1, atk.t / 30) : 0;
    if (atk.dir === undefined) { atk.dir = world.rng.sign(); atk.g0 = world.rng.range(0, 6.28); hint(b, 'flameRings', CAUSES.flameRings.hint); }
    if (atk.t >= 30 && atk.t < 30 + cnt * iv && (atk.t - 30) % iv === 0) {
      const k = (atk.t - 30) / iv;
      const m = P.mouth;
      const gapA = atk.g0 + k * 0.35 * atk.dir;
      for (let i = 0; i < d.ringN; i++) {
        const a = (i / d.ringN) * Math.PI * 2;
        const da = (((a - gapA) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        if (Math.abs(da) < 0.42) continue; // the gap
        bullets.fire(world, { atk: ATK, x: m.x + 6, y: m.y, ang: a, spd: d.ringSpd * 1.25, type: 'orb', r: 4, color: 'orange', cause: 'flameRings' });
      }
    }
    return atk.t >= 30 + cnt * iv + 30;
  },
  // P3: mouth laser. 100f wind-up (jaw gapes, energy converges, flickering aim line
  // that tracks the player for 70f then locks), 110f beam sweeping away from
  // the screen centre, 30f cool-down. The boss holds still throughout.
  laser(world, b, atk, P) {
    atk.hold = true;
    const m = P.mouth;
    b.jawT = atk.t < 220 ? 1.15 : 0;
    b.mawGlow = atk.t < 100 ? atk.t / 100 : atk.t < 210 ? 1 : 0;
    if (atk.t === 0) sfx('laserCharge');
    if (atk.t < 70) atk.aim = aimAt(world, m.x, m.y);
    if (atk.t === 70) atk.dir = Math.sin(atk.aim) < 0 ? 1 : -1; // sweep toward the nearer edge
    // safe: outside the beam over its whole sweep, per 24px column band (conservative)
    if (atk.t < 70) hint(b, 'laser', CAUSES.laser.hint);
    else if (atk.t === 70 || atk.t % 10 === 0) {
      const a0 = atk.aim, a1 = atk.aim + atk.dir * 0.3, rects = [];
      for (let x = 0; x < m.x - 8; x += 24) {
        let lo = 1e9, hi = -1e9;
        for (const a of [a0, a1, (a0 + a1) / 2]) for (const xx of [x, Math.min(m.x, x + 24)]) {
          const yy = m.y + Math.tan(a) * (xx - m.x);
          lo = Math.min(lo, yy); hi = Math.max(hi, yy);
        }
        // sweeping toward the top (dir>0) leaves the area below safe, and vice versa
        rects.push(atk.dir > 0 ? { x, y: hi + 10, w: 24, h: H } : { x, y: 0, w: 24, h: lo - 10 });
      }
      hint(b, 'laser', CAUSES.laser.hint, rects);
    }
    const fire = atk.t >= 100 && atk.t < 210;
    if (atk.t === 100) { sfx('laserFire'); world.flash = Math.max(world.flash, 0.25); }
    const ang = fire ? atk.aim + atk.dir * 0.3 * easeInOutSine((atk.t - 100) / 110) : atk.aim;
    b.laser = atk.t < 100 ? { x: m.x, y: m.y, a: ang, w: 10, state: atk.t < 70 ? 'aim' : 'lock', t: atk.t, atk: ATK }
      : fire ? { x: m.x, y: m.y, a: ang, w: 10, state: 'fire', t: atk.t - 100, atk: ATK } : null;
    return atk.t >= 240;
  },

  // ---------------------------------------------------------------- spectacle
  // GIGA LASER (P4): ~2 s charge (energy gathers, screen darkens, warning
  // stripes along the beam band), ~2 s beam ≥ 1/3 screen tall at the locked
  // height, erasing bullets in its path. Safe: above or below the band.
  gigaLaser(world, b, atk, P) {
    const d = D(b);
    atk.hold = true; atk.ctrl = true;
    const CH = d.gigaCharge, FI = d.gigaFire;
    if (atk.t === 0) sfx('laserCharge');
    if (atk.t < CH - 20) { b.y += (106 - b.y) * 0.05; b.x += (b.restX + 14 - b.x) * 0.05; }
    b.jawT = atk.t < CH + FI + 10 ? 1.3 : 0;
    b.mawGlow = Math.min(1, atk.t / CH);
    const m = P.mouth;
    if (atk.t === CH - 20) atk.cy = m.y;
    const cy = atk.cy ?? m.y, hh = d.gigaHalf;
    const state = atk.t < CH ? 'charge' : atk.t < CH + FI ? 'fire' : atk.t < CH + FI + 18 ? 'fade' : null;
    b.giga = state ? { x: m.x, y: cy, hh, state, t: atk.t, k: Math.min(1, atk.t / CH), atk: ATK } : null;
    if (state === 'fire' && atk.t === CH + 30) b.gigaFired = true; // the P4 opener has landed
    hint(b, 'gigaLaser', CAUSES.gigaLaser.hint, [{ x: 0, y: 0, w: W, h: Math.max(0, cy - hh - 8) }, { x: 0, y: cy + hh + 8, w: W, h: Math.max(0, H - cy - hh - 8) }]);
    if (atk.t === CH) { sfx('gigaFire'); world.flash = Math.max(world.flash, 0.6); world.hitstop = Math.max(world.hitstop, 4); }
    if (state === 'fire') {
      if (atk.t % 4 === 0) fxCall('addShake', world, 3);
      // the beam erases bullets in its path (cancelled into score)
      if (atk.t % 3 === 0 && typeof bullets.vortex === 'function') for (let x = m.x - 20; x > -20; x -= hh * 1.4) bullets.vortex(world, x, cy, hh, 0, hh);
      if (b.laserCd <= 0) {
        const hb = player.playerHitbox(world);
        if (hb && hb.x < m.x && Math.abs(hb.y - cy) < hh - 3 + hb.r) { b.laserCd = 20; hurtPlayer(world, { kind: 'laser', cause: 'gigaLaser', atk: ATK, x: m.x, y: cy }); }
      }
    }
    return atk.t >= CH + FI + 40;
  },
  // CEILING COLLAPSE (P4): the boss rams the cavern roof; rocks rain in waves
  // over the left 2/3 of the screen except two lit SAFE COLUMNS per wave
  // (light shafts telegraph them ~50f before each wave).
  rockRain(world, b, atk) {
    const d = D(b);
    atk.hold = true;
    const WAVES = d.rockWaves, IV = d.rockEvery, T0 = 56;
    if (atk.t === 0) {
      atk.cols = [];
      // each wave's columns sit far from the previous wave's (forces a real move; next columns are pre-announced)
      for (let w = 0; w < WAVES; w++) {
        let a, c, tries = 0;
        do {
          a = world.rng.range(26, 110); c = world.rng.range(a + 64, 220);
          tries++;
        } while (w > 0 && tries < 12 && Math.min(...atk.cols[w - 1].map((p) => Math.min(Math.abs(p - a), Math.abs(p - c)))) < d.rockJump);
        atk.cols.push([a, c]);
      }
      atk.rocks = [];
      sfx('bossRoar');
    }
    b.headDip = atk.t < 40 ? -0.1 * Math.min(1, atk.t / 25) : atk.t < 56 ? 0.08 : 0;
    if (atk.t === T0 - 6) { sfx('rumble'); fxCall('screenRumble', world, 40, 3); fxCall('addShake', world, 7); world.flash = Math.max(world.flash, 0.2); }
    const SW = d.rockSafe;
    for (let w = 0; w < WAVES; w++) {
      if (atk.t !== T0 + w * IV) continue;
      const [ca, cb] = atk.cols[w];
      for (let x = 6; x < 272; x += d.rockStep) {
        if (Math.abs(x - ca) < SW / 2 + 4 || Math.abs(x - cb) < SW / 2 + 4) continue;
        atk.rocks.push({ w, x: x + world.rng.range(-3, 3), y: -10 - world.rng.range(0, 30), vy: 0.4, s: world.rng.int(0, 2), a: world.rng.range(0, 6.28), atk: ATK });
      }
      fxCall('addShake', world, 4);
    }
    const hb = player.playerHitbox(world);
    for (let i = atk.rocks.length - 1; i >= 0; i--) {
      const q = atk.rocks[i];
      q.vy = Math.min(d.rockSpd, q.vy + 0.09); q.y += q.vy; q.a += 0.08;
      if (hb && Math.abs(hb.x - q.x) < 5 + hb.r && Math.abs(hb.y - q.y) < 5 + hb.r) { hurtPlayer(world, { kind: 'bullet', cause: 'rockRain', atk: q.atk, x: q.x, y: q.y }); atk.rocks.splice(i, 1); continue; }
      if (q.y > H + 8) { if ((i & 3) === 0) fxCall('explode', world, q.x, H - 4, 'small', { debris: ['#3a4250', '#56606e'] }); atk.rocks.splice(i, 1); }
    }
    // authoritative safe columns: the OLDEST wave still falling (its columns stay
    // valid until all of its rocks are gone); the next wave's columns only take
    // over once the screen is clear of the previous wave.
    let oldest = WAVES;
    for (const q of atk.rocks) oldest = Math.min(oldest, q.w);
    const spawned = Math.max(-1, Math.floor((atk.t - T0) / IV));
    const hw = oldest < WAVES ? oldest : Math.min(WAVES - 1, spawned + 1);
    const cols = atk.cols[hw];
    // the upcoming wave (if different) is pre-announced faintly
    const nextW = spawned + 1 < WAVES && atk.t >= T0 + (spawned + 1) * IV - 50 && spawned + 1 !== hw ? spawned + 1 : -1;
    hint(b, 'rockRain', 'Stand in a lit column' + (nextW >= 0 ? ' - next columns flicker in' : ''), cols.map((c) => ({ x: c - SW / 2 + 2, y: 0, w: SW - 4, h: H })));
    b.rocks = atk.rocks;
    const done = atk.t >= T0 + (WAVES - 1) * IV && !atk.rocks.length;
    b.rockTell = done ? null : { cols, sw: SW, next: nextW >= 0 ? atk.cols[nextW] : null };
    return done && atk.t >= T0 + (WAVES - 1) * IV + 20;
  },
  // BODY CHARGE (P4): the boss dives to the player's half (tell: eye flares,
  // warning band across its path), rears back, then dashes the full width.
  // Safe: the other half. It re-enters from the right afterwards.
  dashCharge(world, b, atk) {
    const d = D(b);
    atk.ctrl = true; atk.hold = true;
    if (atk.t === 0) {
      const p = world.player;
      atk.top = !(p && p.alive && p.y > H / 2);
      atk.ly = atk.top ? 72 : 146;
      sfx('bossRoar');
    }
    const band = { y0: atk.ly - 46, y1: atk.ly + 50 };
    hint(b, 'dashCharge', CAUSES.dashCharge.hint, [atk.top ? { x: 0, y: band.y1 + 6, w: W, h: H - band.y1 - 6 } : { x: 0, y: 0, w: W, h: band.y0 - 6 }]);
    const TELL = d.dashTell;
    b.dashBand = atk.back ? null : band;
    if (atk.t < TELL) { b.y += (atk.ly - b.y) * 0.08; b.x += (b.restX + 20 - b.x) * 0.06; b.eyeFlare = (atk.t >> 2) & 1; }
    else if (atk.t < TELL + 12) { b.x += 2; b.eyeFlare = 1; }
    else if (b.x > -300 && !atk.back) { b.x -= d.dashSpd; if (atk.t % 3 === 0) fxCall('addShake', world, 2); b.eyeFlare = 1; }
    else {
      if (!atk.back) { atk.back = atk.t; b.x = W + 210; b.y = 106; b.eyeFlare = 0; }
      const k = Math.min(1, (atk.t - atk.back) / 90);
      b.x = W + 210 + (b.restX - W - 210) * (1 - (1 - k) ** 3);
      if (k >= 1) return true;
    }
    return false;
  },
};

// ------------------------------------------------------------ laser physics
export function updateLaser(world, b) {
  // charge particles converging on the maw (cosmetic, fxRng)
  const ch = b.charge;
  const L = b.laser, G = b.giga;
  const src = L && L.state !== 'fire' ? L : G && G.state === 'charge' ? G : null;
  if (src && ch.length < (G ? 80 : 40)) {
    for (let k = 0; k < (G ? 4 : 2); k++) {
      const a = world.fxRng.range(0, Math.PI * 2), r = world.fxRng.range(30, G ? 110 : 60);
      ch.push({ x: src.x + Math.cos(a) * r, y: src.y + Math.sin(a) * r, t: 0 });
    }
  }
  for (let i = ch.length - 1; i >= 0; i--) {
    const q = ch[i];
    q.t++;
    if (!src) { ch.splice(i, 1); continue; }
    q.x += (src.x - q.x) * 0.09; q.y += (src.y - q.y) * 0.09;
    if (q.t > 26) ch.splice(i, 1);
  }
  if (b.laserCd > 0) b.laserCd--;
  if (!L || L.state !== 'fire' || L.t < 4) return;
  const hb = player.playerHitbox(world);
  if (!hb || b.laserCd > 0) return;
  const dx = Math.cos(L.a), dy = Math.sin(L.a);
  const rx = hb.x - L.x, ry = hb.y - L.y;
  const along = rx * dx + ry * dy;
  if (along < 0) return;
  const perp = Math.abs(rx * dy - ry * dx);
  if (perp < 5 + hb.r) {
    b.laserCd = 30;
    hurtPlayer(world, { kind: 'laser', cause: 'laser', atk: L.atk, x: L.x, y: L.y });
  }
}

export function drawLaser(ctx, world, b, S) {
  const L = b.laser;
  // tail-sweep telegraph: glowing tail tip
  if (b.atk && b.atk.tipGlow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = b.atk.tipGlow * (0.6 + 0.4 * Math.sin(b.t * 0.6));
    const tp = tailFirePoint(b.pose);
    ctx.drawImage(S.tipGlow, Math.round(tp.x - S.tipGlow.width / 2), Math.round(tp.y - S.tipGlow.height / 2));
    // on-screen tell: warning lights race up the visible tail segments
    b.pose.tail.forEach((sg, i) => {
      if (sg.x > W + 6 || sg.y < -6) return;
      ctx.globalAlpha = b.atk.tipGlow * (0.5 + 0.5 * Math.sin(b.t * 0.5 - i * 0.9));
      ctx.drawImage(S.redLight, Math.round(sg.x - 4), Math.round(sg.y - 4));
      ctx.drawImage(S.tipGlow, Math.round(sg.x - 6), Math.round(sg.y - TAILR[i] - 4));
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  // bubble-wall telegraph: a pair of blinking chevrons marking the gap at the right edge
  if (b.atk && b.atk.name === 'bubbleWall' && b.atk.tell !== null && b.atk.tell !== undefined && (b.t >> 2) % 2) {
    ctx.fillStyle = '#9ef0ff';
    const gy = Math.round(b.atk.tell), half = DIFFICULTY[b.phase].wallGap - 4;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) ctx.fillRect(W - 10 + k, gy + s * (half - k) - (s < 0 ? 1 : 0), 6 - k * 2, 1);
  }
  // the wall that will reach the ship next: arrows riding just ahead of it
  const nw = b.walls && b.walls.find((q) => q.next);
  if (nw && (b.t >> 2) % 2) {
    ctx.fillStyle = '#c8faff';
    const x = Math.round(nw.x - 14);
    for (const yy of [nw.y0, nw.y1]) ctx.fillRect(x, Math.round(yy), 8, 1);
  }
  drawSpectacle(ctx, world, b, S);
  if (b.charge.length) {
    ctx.fillStyle = b.giga ? '#fff0d0' : '#ffd0dc';
    for (const q of b.charge) ctx.fillRect(Math.round(q.x), Math.round(q.y), q.t % 4 < 2 ? 2 : 1, 1);
  }
  if (!L) return;
  ctx.save();
  ctx.translate(Math.round(L.x), Math.round(L.y));
  ctx.rotate(L.a);
  const len = W + 120;
  if (L.state === 'aim' || L.state === 'lock') {
    const on = L.state === 'lock' ? (L.t >> 2) % 2 : (L.t >> 3) % 2;
    ctx.globalAlpha = L.state === 'lock' ? (on ? 0.95 : 0.4) : 0.35 + 0.2 * on;
    ctx.drawImage(S.beamThin, 0, -1, len, L.state === 'lock' ? 3 : 2);
  } else {
    const grow = Math.min(1, L.t / 6);
    const wob = 1 + 0.12 * Math.sin(L.t * 1.3);
    const h = Math.round(13 * wob * (L.t > 104 ? Math.max(0.2, (110 - L.t) / 6) : 1));
    ctx.globalAlpha = 1;
    ctx.drawImage(S.beam, 0, -Math.floor(h / 2), len * grow, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(S.bigGlow, -S.bigGlow.width / 2 + 4, -S.bigGlow.height / 2);
  }
  ctx.restore();
}

// warning stripes: scrolling diagonal hatch inside a band (cheap fillRects)
function hatch(ctx, x0, y0, w, h, t, color, alpha) {
  if (w <= 0 || h <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x0, Math.round(y0), w, 1);
  ctx.fillRect(x0, Math.round(y0 + h - 1), w, 1);
  const off = (t >> 1) % 16;
  for (let x = x0 - h + off; x < x0 + w; x += 16) {
    for (let k = 0; k < h; k += 2) {
      const px = Math.round(x + k * 0.5 + h * 0.5);
      if (px >= x0 && px < x0 + w) ctx.fillRect(px, Math.round(y0 + k), 3, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSpectacle(ctx, world, b, S) {
  // GIGA LASER
  const G = b.giga;
  if (G) {
    const top = G.y - G.hh, h = G.hh * 2;
    if (G.state === 'charge') {
      hatch(ctx, 0, top, Math.max(0, Math.round(G.x - 10)), h, b.t, '#a8f6ff', 0.14 + 0.24 * G.k * (0.6 + 0.4 * Math.sin(b.t * 0.4)));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, G.k * 1.2);
      const sz = Math.round(20 + G.k * 56);
      ctx.drawImage(S.bigGlow, Math.round(G.x + 6 - sz / 2), Math.round(G.y - sz / 2), sz, sz);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      const wob = 1 + 0.06 * Math.sin(b.t * 1.7);
      const hh = Math.round(G.hh * wob * (G.state === 'fade' ? 0.45 : 1));
      ctx.drawImage(S.gigaBeam, 0, Math.round(G.y - hh), Math.round(G.x + 4), hh * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(b.t * 0.9);
      ctx.drawImage(S.beam, 0, Math.round(G.y - hh * 0.45), Math.round(G.x), Math.round(hh * 0.9));
      ctx.globalAlpha = 0.9;
      ctx.drawImage(S.bigGlow, Math.round(G.x - 40), Math.round(G.y - 40), 80, 80);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
  // CEILING COLLAPSE: light shafts on the safe columns, dust elsewhere, rocks
  if (b.atk && b.atk.name === 'rockRain') {
    const T = b.rockTell;
    if (T) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(b.t * 0.3);
      for (const c of T.cols) { ctx.drawImage(S.shaft, Math.round(c - T.sw / 2), 0, T.sw, H); ctx.drawImage(S.shaft, Math.round(c - T.sw / 4), 0, T.sw / 2, H); }
      if (T.next && (b.t >> 2) & 1) { ctx.globalAlpha = 0.22; for (const c of T.next) ctx.drawImage(S.shaft, Math.round(c - T.sw / 2), 0, T.sw, H); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#9a8f7c';
      for (let x = 8; x < 272; x += 9) {
        if (T.cols.some((c) => Math.abs(x - c) < T.sw / 2 + 4)) continue;
        ctx.fillRect(x, (b.t * 2 + x * 7) % 70, 1, 2);
      }
    }
    for (const r of b.rocks || []) {
      const s = S.rocks[r.s];
      ctx.save();
      ctx.translate(Math.round(r.x), Math.round(r.y));
      ctx.rotate(r.a);
      ctx.drawImage(s.img, -s.px, -s.py);
      ctx.restore();
    }
  }
  // BODY CHARGE warning band
  if (b.dashBand && b.atk && b.atk.name === 'dashCharge') {
    const B = b.dashBand;
    hatch(ctx, 0, B.y0, W, B.y1 - B.y0, b.t, '#c8faff', 0.3 + 0.18 * ((b.t >> 3) & 1));
  }
}
