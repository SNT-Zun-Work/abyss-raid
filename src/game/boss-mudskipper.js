// ZONE G boss: PERIOPHTHALMUS — amphibious assault carrier (mechanical mudskipper).
// Owned by the boss agent. Same API as boss-axolotl.js (dispatched by boss.js):
//   init update draw hitTest applyDamage bodyHit targets debugSetHpFrac CAUSES ZONE_INFO
// world.boss: { x, y, hp, maxHp, phase, active, defeated, deathDone, safeHint, circles,
//   hazards (gravity projectiles + wave points for bots: {x,y,vx,vy,r,g}), lasers, fightT,
//   stunT/stunFrames (BLINDED crash window), eyes, mode }
//
// Play feel (vs the axolotl): an ACROBAT. It hops and lobs mud on its perch, makes
// big parabolic LEAPS across the screen (landing on the LEFT behind the player,
// telegraphed by a landing shadow), DIVES under the sea surface and BURSTS out,
// sends SHOCKWAVES along the surface, exposes its BELLY mid-leap (big damage),
// raises turret EYES (destroy both → BLINDED → it crashes = damage window), and
// releases HOPPER packs that leap in arcs (wipe a pack → item). FINAL FORM: the
// sails ignite, it glides, mud rains, and a TIDAL WAVE sweeps the screen (ride the gap).
//
// Space is split by the water surface at SURFACE_Y (shared with the background).
import { W, H } from '../config.js';
import { clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, hurtPlayer } from './boss-util.js';
import { emit } from './world.js';
import { getMudSprites } from './boss-mudskipper-parts.js';
import { MATTACKS, MPOOLS, MBIG, updateHazards, drawHazards } from './boss-mudskipper-attacks.js';
import { initHoppers, updateHoppers, drawHoppers, hitHopper, damageHopper, hopperBodyHit, killAllHoppers } from './boss-mudskipper-hoppers.js';

export const ZONE_INFO = { letter: 'G', name: 'PERIOPHTHALMUS', title: 'AMPHIBIOUS ASSAULT CARRIER', area: 'SUNSET TIDELANDS' };
export const SURFACE_Y = Math.round(H * 0.66);
export const MAX_HP = 2400;
export const HOME_R = 322, HOME_L = 66;
export const PERCH_Y = SURFACE_Y - 30;
const P2_FRAC = 0.7, P3_FRAC = 0.4, P4_FRAC = 0.15;

// ---- DIFFICULTY (one table, per phase) --------------------------------------
//  gap: frames between attacks, spd: bullet speed scale, grav: mud gravity (px/f²),
//  dmgTaken: damage the boss receives, eyeHp: per-eye HP, eyeRegen: frames until a
//  destroyed eye is rebuilt, blindMult: damage multiplier while crashed.
export const DIFFICULTY = {
  1: { gap: 54, spd: 1.0, grav: 0.07, dmgTaken: 1.25, eyeHp: 22, eyeRegen: 900, blindMult: 2.5, lobN: 3, lobVolleys: 2, eyeBursts: 2, eyeN: 3,
       hopEvery: [480, 600], hopN: [6, 8], hopGunners: 0, shock: 0, shockSpd: 2.0, leapT: 96, diveTell: 50 },
  2: { gap: 40, spd: 1.15, grav: 0.075, dmgTaken: 1.15, eyeHp: 26, eyeRegen: 780, blindMult: 2.2, lobN: 4, lobVolleys: 3, eyeBursts: 3, eyeN: 3,
       hopEvery: [540, 660], hopN: [7, 9], hopGunners: 1, shock: 0, shockSpd: 2.2, leapT: 90, diveTell: 46 },
  3: { gap: 28, spd: 1.3, grav: 0.08, dmgTaken: 1.05, eyeHp: 30, eyeRegen: 660, blindMult: 2.0, lobN: 5, lobVolleys: 3, eyeBursts: 3, eyeN: 4,
       hopEvery: [600, 720], hopN: [8, 10], hopGunners: 2, shock: 1, shockSpd: 2.4, leapT: 90, diveTell: 42 },
  4: { gap: 26, spd: 1.4, grav: 0.08, dmgTaken: 1.0, eyeHp: 34, eyeRegen: 600, blindMult: 1.8, lobN: 5, lobVolleys: 3, eyeBursts: 3, eyeN: 4,
       hopEvery: [700, 820], hopN: [8, 10], hopGunners: 2, shock: 1, shockSpd: 2.5, leapT: 110, diveTell: 42,
       tideEvery: 3, tideTell: 120, tideSpd: 2.4, tideGap: 46, rainWaves: 3, rainSafe: 26, rainEvery: 80 },
};

export const CAUSES = {
  mudLob: { name: 'MUD LOB', hint: 'Lobbed balls arc and fall: watch the cyan landing marks and step aside' },
  mudEye: { name: 'EYE TURRETS', hint: 'Raised eyes glow, then fire aimed bursts: sidestep each burst - and shoot the eyes' },
  mudLeap: { name: 'LEAP CRUSH', hint: 'A shadow marks where it lands: leave the shadow and stay under the arc' },
  mudBody: { name: 'BODY CONTACT', hint: 'Do not touch the mudskipper' },
  mudShock: { name: 'SURFACE SHOCKWAVE', hint: 'Landings send waves along the water line: stay above the surface' },
  mudBurst: { name: 'DIVE BURST', hint: 'Boiling water marks where it bursts out: move away sideways' },
  mudSpray: { name: 'MUD SPRAY', hint: 'The burst throws mud up and around: keep your distance' },
  mudHopper: { name: 'HOPPER', hint: 'Hoppers leap in arcs: shoot them at the top of the jump or slip under' },
  mudHopShot: { name: 'HOPPER SHOT', hint: 'Glowing hoppers fire once at the top of their leap' },
  mudRain: { name: 'MUD RAIN', hint: 'Stand in a lit column while the mud falls' },
  mudTide: { name: 'TIDAL WAVE', hint: 'The striped band is the tunnel in the wave: be inside it when the wave hits' },
};

const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

// ---- local → world transform (one root transform: translate, flip, rotate) ---
export function toWorld(b, lx, ly) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return { x: b.x + b.f * (lx * c - ly * s), y: b.y + lx * s + ly * c };
}

export function init(world) {
  getMudSprites();
  if (world.bg) world.bg.surfaceY = SURFACE_Y;
  const b = (world.boss = {
    x: W + 120, y: SURFACE_Y + 50, hp: MAX_HP, maxHp: MAX_HP, phase: 1,
    active: false, defeated: false, deathDone: false,
    mode: 'wait', modeT: 0, t: 0, deathT: 0, fightT: 0,
    f: 1, a: 0, vx: 0, vy: 0, air: false, home: 'R',
    jaw: 0, jawT: 0, eyeUp: 0, eyeUpT: 0, sailFlare: 0, flush: 0, headA: 0,
    eyes: [{ hp: DIFFICULTY[1].eyeHp, state: 'ok', t: 0 }, { hp: DIFFICULTY[1].eyeHp, state: 'ok', t: 0 }],
    atk: null, atkSeq: 0, gap: 40, lastAtk: null, atkCount: 0, calmT: 0, tideFired: false,
    safeHint: null, hazards: [], lasers: [], circles: [], mud: [], shocks: [], splash: [], wave: null, rain: null,
    landing: null, boil: null, flashT: {}, stunned: false, stunT: 0, stunFrames: 240, debris: [],
  });
  initHoppers(b);
  computeCircles(b);
}

export function debugSetHpFrac(world, f) {
  const b = world.boss;
  b.hp = Math.round(b.maxHp * f);
  b.x = HOME_R; b.y = PERCH_Y; b.mode = 'fight'; b.modeT = 0; b.gap = 30;
  if (f <= P2_FRAC) b.phase = 2;
  if (f <= P3_FRAC) { b.phase = 3; b.flush = 0.6; }
  if (f <= P4_FRAC && f > 0) { b.phase = 4; b.sailFlare = 1; b.flush = 1; }
  if (b.hp <= 0) { b.hp = 0; startDeath(world); world.hitstop = 0; world.flash = 0; }
  computeCircles(b);
}

// ---- hit circles ----------------------------------------------------------------
export function eyePos(b, i) {
  return toWorld(b, i === 0 ? -55 : -31, (i === 0 ? -33 : -37) - b.eyeUp * 12);
}
function computeCircles(b) {
  const cs = [];
  const add = (lx, ly, r, kind, mult, group, id) => { const p = toWorld(b, lx, ly); cs.push({ x: p.x, y: p.y, r, kind, mult, group, id }); };
  if (b.eyeUp > 0.6) b.eyes.forEach((e, i) => { if (e.state === 'ok') { const p = eyePos(b, i); cs.push({ x: p.x, y: p.y - 2, r: 9, kind: 'eye', mult: 1, group: 'eye' + i, id: i }); } });
  if (b.air) add(6, 22, 16, 'belly', 2.0, 'torso');
  if (b.jaw > 0.4) add(-48, 10, 12, 'mouth', 1.6, 'head');
  add(-62, 2, 16, 'head', 0.8, 'head');
  add(-38, -6, 22, 'head', 0.8, 'head');
  add(4, 0, 28, 'body', 0.6, 'torso');
  add(34, 0, 22, 'body', 0.6, 'torso');
  add(70, 0, 13, 'tail', 0.4, 'tail');
  b.circles = cs;
}

function hittable(b) {
  return b.active && !b.defeated && b.mode !== 'wait' && b.mode !== 'roar' && !(b.mode === 'entry' && b.modeT < 90) && b.y < SURFACE_Y + 20;
}

export function hitTest(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.active) return null;
  const h = hitHopper(world, x, y, r);
  if (h) return h;
  if (!hittable(b)) return null;
  for (const c of b.circles) {
    if (c.y > SURFACE_Y + 6 && c.kind !== 'eye') continue; // submerged parts are covered by water
    const rr = c.r + r;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr * rr) return { kind: c.kind, part: c.kind, id: c.id, mult: c.mult, group: c.group, x, y };
  }
  return null;
}

function contactAt(world, x, y, r) {
  const b = world.boss;
  const h = hopperBodyHit(world, x, y, r);
  if (h) return { kind: 'escort', cause: 'mudHopper', x: h.x, y: h.y };
  if (!hittable(b) || b.mode === 'crash') return null;
  for (const c of b.circles) {
    if (c.kind === 'eye' || c.kind === 'mouth') continue;
    if (c.y > SURFACE_Y + 4) continue; // submerged parts can't be shot, so they don't kill either
    const rr = c.r * 0.75 + r;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr * rr) return { kind: 'body', cause: b.air ? 'mudLeap' : b.atk && b.atk.name === 'dive' ? 'mudBurst' : 'mudBody', x: c.x, y: c.y };
  }
  return null;
}
export function bodyHit(world, x, y, r) { return !!contactAt(world, x, y, r); }

export function targets(world) {
  const b = world.boss;
  if (!b || !b.active || b.defeated) return [];
  const out = b.hoppers.filter((h) => h.on && h.y < SURFACE_Y).map((h) => ({ x: h.x, y: h.y, kind: 'escort' }));
  for (const c of b.circles) if ((c.kind === 'eye' || c.kind === 'belly' || c.kind === 'mouth') && c.y < SURFACE_Y) out.push({ x: c.x, y: c.y, kind: c.kind === 'eye' ? 'weak' : c.kind });
  if (!out.some((o) => o.kind !== 'escort') && hittable(b)) { const p = toWorld(b, -40, -4); out.push({ x: p.x, y: p.y, kind: 'body' }); }
  return out;
}

export function applyDamage(world, hit, dmg) {
  const b = world.boss;
  if (!hit || !b) return;
  if (hit.kind === 'escort') { damageHopper(world, hit, dmg); return; }
  if (!hittable(b)) return;
  const d = DIFFICULTY[b.phase];
  const mult = (hit.source === 'burst' ? Math.max(1, hit.mult) : hit.mult ?? 1) * (b.stunned ? d.blindMult : 1) * d.dmgTaken;
  b.flashT[hit.group || 'torso'] = 3;
  if (hit.kind === 'body' || hit.kind === 'tail') {
    if ((b.t & 3) === 0) fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.7, 0.7));
    world.score += 4;
  } else world.score += Math.round(10 * mult);
  if ((hit.kind === 'eye' || hit.kind === 'belly' || hit.kind === 'mouth') && b.t - (b.weakEmitT || -99) >= 6) {
    b.weakEmitT = b.t;
    emit(world, { type: 'weakHit', x: hit.x, y: hit.y, part: hit.kind });
  }
  if (hit.kind === 'eye') damageEye(world, hit.id, dmg);
  // HP gates: no skipping a phase; death only in the final form after the first tidal wave
  const floor = b.phase < 4 || b.mode === 'roar' || !b.tideFired ? 1 : 0;
  b.hp = Math.max(Math.min(b.hp, floor), b.hp - dmg * mult);
  checkPhase(world);
}

function damageEye(world, i, dmg) {
  const b = world.boss, e = b.eyes[i];
  if (e.state !== 'ok') return;
  e.hp -= dmg;
  if (e.hp > 0) return;
  e.state = 'dead'; e.t = 0;
  const p = eyePos(b, i);
  fxCall('explode', world, p.x, p.y, 'medium', { debris: ['#8a96a8', '#ff5030'] });
  sfx('explodeS');
  world.hitstop = Math.max(world.hitstop, 4);
  world.score += 4000;
  fxCall('scorePopup', world, p.x, p.y, 4000);
  const left = b.eyes.filter((q) => q.state === 'ok').length;
  emit(world, { type: 'gillKill', x: p.x, y: p.y, left, total: 2, regrowIn: DIFFICULTY[b.phase].eyeRegen, part: 'eye' });
  if (left === 0 && b.mode === 'fight') startBlind(world);
}

function checkPhase(world) {
  const b = world.boss;
  if (b.mode !== 'fight') return;
  const f = b.hp / b.maxHp;
  if (b.phase === 1 && f <= P2_FRAC) toPhase(world, 2);
  else if (b.phase === 2 && f <= P3_FRAC) toPhase(world, 3);
  else if (b.phase === 3 && f <= P4_FRAC) toPhase(world, 4);
  else if (b.phase === 4 && b.hp <= 0 && !b.defeated) startDeath(world);
}

function clearField(world, b) {
  bullets.clearAll(world, true);
  b.mud.length = 0; b.shocks.length = 0; b.wave = null; b.rain = null; b.landing = null; b.boil = null;
}

function endAttack(b) {
  b.atk = null; b.arcPreview = null; b.bellyTell = 0; b.jawT = 0; b.eyeUpT = b.phase === 1 ? 1 : 0; b.landing = null; b.boil = null; b.safeHint = null;
}

function toPhase(world, to) {
  const b = world.boss;
  const from = b.phase;
  if (b.atk) endAttack(b);
  clearField(world, b);
  b.mode = 'roar'; b.modeT = 0;
  world.hitstop = Math.max(world.hitstop, 18);
  world.flash = Math.max(world.flash, to === 4 ? 1 : 0.5);
  fxCall('addShake', world, to === 4 ? 8 : 5);
  sfx(to === 4 ? 'explodeL' : 'bossRoar');
  if (to === 4) { fxCall('screenRumble', world, 120, 3); sfx('rumble'); }
  b.phase = to;
  emit(world, { type: 'phaseChange', from, to });
}

function startBlind(world) {
  const b = world.boss;
  if (b.atk) endAttack(b);
  b.mode = 'blind'; b.modeT = 0; b.blindHops = 0; b.hopA = null;
  sfx('bossRoar');
}

function startCrash(world) {
  const b = world.boss;
  b.mode = 'crash'; b.modeT = 0; b.stunned = true; b.stunT = b.stunFrames;
  b.air = false; b.vx = 0; b.vy = 0;
  clearField(world, b);
  fxCall('explode', world, b.x, SURFACE_Y - 4, 'large', { debris: ['#c8f0ff', '#8a96a8'] });
  splash(b, b.x, 40, world);
  world.hitstop = Math.max(world.hitstop, 10);
  fxCall('addShake', world, 6);
  stats(world).stuns++;
  emit(world, { type: 'stunStart', x: b.x, y: b.y, frames: b.stunFrames, reason: 'blinded' });
}

function startDeath(world) {
  const b = world.boss;
  b.hp = 0; b.defeated = true; b.mode = 'death'; b.modeT = 0; b.deathT = 0;
  if (b.stunned) { b.stunned = false; emit(world, { type: 'stunEnd', x: b.x, y: b.y }); }
  if (b.atk) endAttack(b);
  clearField(world, b);
  killAllHoppers(world, b);
  b.vy = -4.5; b.vx = b.f * -0.6; b.air = true;
  world.hitstop = Math.max(world.hitstop, 30);
  world.flash = Math.max(world.flash, 0.7);
  fxCall('addShake', world, 8);
  sfx('explodeL');
}

// cosmetic water droplets (splash columns / wakes)
export function splash(b, x, n, world, up = 3.2) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + world.fxRng.range(-0.9, 0.9), s = world.fxRng.range(0.8, up);
    b.splash.push({ x: x + world.fxRng.range(-14, 14), y: SURFACE_Y - 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, c: (i & 3) === 0 ? 1 : 0 });
  }
}

// ---- update -----------------------------------------------------------------
export function update(world) {
  const b = world.boss;
  if (!b.active) return;
  b.t++; b.modeT++;
  if (b.calmT > 0 && b.mode === 'fight') b.calmT--;
  for (const k in b.flashT) if (b.flashT[k] > 0) b.flashT[k]--;
  const d = DIFFICULTY[b.phase];
  const pl = world.player;
  if (pl) { const px = b.pv ? b.pv.px : pl.x, py = b.pv ? b.pv.py : pl.y; b.pv = { x: (b.pv ? b.pv.x * 0.7 : 0) + (pl.x - px) * 0.3, y: (b.pv ? b.pv.y * 0.7 : 0) + (pl.y - py) * 0.3, px: pl.x, py: pl.y }; }

  switch (b.mode) {
    case 'wait':
      b.mode = 'entry'; b.modeT = 0;
      break;
    case 'entry': {
      // bursts out of the sea on the right and lands on its perch
      const T = 110;
      if (b.modeT === 30) { splash(b, HOME_R, 50, world, 4); sfx('bossRoar'); fxCall('addShake', world, 4); }
      if (b.modeT < 30) { b.x = HOME_R + 40; b.y = SURFACE_Y + 50; }
      else if (b.modeT <= T) {
        const u = Math.min(1, (b.modeT - 30) / (T - 30));
        b.x = HOME_R + 40 * (1 - u); b.y = SURFACE_Y + 50 + (PERCH_Y - SURFACE_Y - 50) * u - 4 * 90 * u * (1 - u);
        b.air = u < 1; b.a = (1 - 2 * u) * 0.5;
      }
      b.jawT = b.modeT > 110 && b.modeT < 160 ? 1 : 0;
      if (b.modeT === T) { splash(b, b.x, 30, world); b.a = 0; b.air = false; }
      if (b.modeT >= 170) { b.mode = 'fight'; b.modeT = 0; b.gap = 30; b.calmT = 40; b.eyeUpT = 1; }
      break;
    }
    case 'fight':
      b.fightT++;
      if (!b.atk) {
        idle(world, b);
        if (--b.gap <= 0) pickAttack(world, b);
      } else {
        const done = MATTACKS[b.atk.name](world, b, b.atk);
        if (b.atk) b.atk.t++;
        if (done === true) { endAttack(b); b.gap = d.gap; }
      }
      regenEyes(world, b);
      break;
    case 'roar':
      b.jawT = b.modeT < 80 ? 1 : 0;
      b.air = false; b.a *= 0.9;
      b.y += (PERCH_Y - b.y) * 0.1;
      if (b.phase === 4) { b.sailFlare = Math.min(1, b.modeT / 60); b.flush = b.sailFlare; }
      if (b.phase === 3) b.flush = Math.min(0.6, b.modeT / 80);
      if (b.modeT % 10 === 0 && b.modeT < 80) fxCall('explode', world, b.x + world.fxRng.range(-50, 50), b.y + world.fxRng.range(-26, 20), 'small', { debris: ['#8a96a8', '#ff7a30'] });
      if (b.modeT >= 110) { b.mode = 'fight'; b.modeT = 0; b.gap = 24; b.calmT = 90; b.atkCount = 0; checkPhase(world); }
      break;
    case 'blind': {
      // BLINDED: two erratic low hops, then a crash into the shallows
      b.eyeUpT = 0;
      if (!b.hopA || b.hopA.done) {
        if (b.blindHops >= 2) { startCrash(world); break; }
        const tx = clamp(b.x + world.rng.sign() * world.rng.range(40, 90), 110, HOME_R);
        b.hopA = { x0: b.x, y0: b.y, x1: tx, y1: PERCH_Y + 6, h: 34, T: 46, t: 0 };
        b.blindHops++;
      }
      stepLeap(world, b, b.hopA);
      b.a += Math.sin(b.t * 0.7) * 0.05;
      break;
    }
    case 'crash':
      b.stunT = Math.max(0, b.stunFrames - b.modeT);
      b.a += (0.42 - b.a) * 0.1; // lies tilted in the shallows
      b.y += (SURFACE_Y - 8 - b.y) * 0.1;
      b.jawT = 1;
      if (b.modeT % 30 === 0) { const p = toWorld(b, -40, -30); fxCall('spark', world, p.x, p.y, -Math.PI / 2 + world.fxRng.range(-1, 1)); }
      if (b.modeT >= b.stunFrames) {
        b.stunned = false; b.stunT = 0;
        emit(world, { type: 'stunEnd', x: b.x, y: b.y });
        for (const e of b.eyes) { e.state = 'ok'; e.hp = d.eyeHp; }
        b.mode = 'fight'; b.modeT = 0; b.gap = 20; b.calmT = 90; b.a = 0; b.y = PERCH_Y;
        // hop back to the nearer home
        b.atkSeq++; b.atk = { name: 'leap', t: 0, id: b.atkSeq, to: b.x < W / 2 ? 'L' : 'R', quiet: true };
        sfx('bossRoar');
        checkPhase(world);
      }
      break;
    case 'death':
      updateDeath(world, b);
      break;
  }

  b.jaw += ((b.jawT || 0) - b.jaw) * 0.15;
  b.eyeUp += ((b.mode === 'crash' || b.mode === 'blind' ? 0 : b.eyeUpT) - b.eyeUp) * 0.12;
  if (b.phase === 4 && b.mode !== 'death') b.sailFlare = 1;
  computeCircles(b);
  updateHazards(world, b);
  updateHoppers(world, b);
  updateCosmetics(b);

  // bots: gravity projectiles and wave points
  b.hazards.length = 0;
  for (const m of b.mud) b.hazards.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, g: m.g, cause: m.cause });
  for (const s of b.shocks) b.hazards.push({ x: s.x, y: SURFACE_Y - 5, vx: s.vx, vy: 0, r: 8, g: 0, cause: 'mudShock' });
  for (const h of b.hoppers) if (h.on && h.air) b.hazards.push({ x: h.x, y: h.y, vx: h.vx, vy: h.vy, r: 6, g: h.g, cause: 'mudHopper' });
  if (b.wave && b.wave.state === 'run') for (let y = 4; y < H; y += 12) if (y < b.wave.g0 - 4 || y > b.wave.g1 + 4) for (const dx of [8, 28, 48]) b.hazards.push({ x: b.wave.x + dx, y, vx: -b.wave.spd, vy: 0, r: 10, g: 0, cause: 'mudTide' });

  if (b.mode !== 'death' && b.mode !== 'entry' && b.mode !== 'roar') {
    const hb = player.playerHitbox(world);
    const c = hb && contactAt(world, hb.x, hb.y, hb.r);
    if (c) hurtPlayer(world, { ...c, atk: b.atk ? b.atk.id : 0 });
  }
  // mood
  if (world.bg) {
    world.bg.surfaceY = b.wave && b.wave.recede ? SURFACE_Y + b.wave.recede : SURFACE_Y;
    if (b.phase === 4 && b.mode !== 'death') { world.bg.tint = { r: 140, g: 40, b: 0, a: 0.14 }; world.bg.darken = 0.12 + (b.wave && b.wave.state === 'tell' ? 0.25 : 0); }
    else if (b.mode === 'death' && b.deathT === 150) { world.bg.tint = 0; world.bg.darken = 0; }
  }
}

// perched idle: bob, face the player
function idle(world, b) {
  const p = world.player;
  if (p && p.alive) b.f = p.x < b.x ? 1 : -1;
  const homeX = b.home === 'L' ? HOME_L : HOME_R;
  b.x += (homeX - b.x) * 0.05;
  b.y += (PERCH_Y + Math.sin(b.t * 0.06) * 2 - b.y) * 0.1;
  b.a += (Math.sin(b.t * 0.05) * 0.03 - b.a) * 0.1;
  b.air = false;
  if (b.phase === 1) b.eyeUpT = 1;
}

// one parabolic leap step: L = {x0,y0,x1,y1,h,T,t}
export function stepLeap(world, b, L) {
  L.t++;
  const u = Math.min(1, L.t / L.T);
  const nx = L.x0 + (L.x1 - L.x0) * u;
  const ny = L.y0 + (L.y1 - L.y0) * u - 4 * L.h * u * (1 - u);
  b.vx = nx - b.x; b.vy = ny - b.y; b.x = nx; b.y = ny;
  if (Math.abs(L.x1 - L.x0) > 4) b.f = L.x1 < L.x0 ? 1 : -1;
  const tilt = Math.atan2(-b.vy, Math.abs(b.vx) + 0.5) * 0.7;
  b.a += (clamp(tilt, -0.75, 0.75) - b.a) * 0.3;
  b.air = u > 0.04 && u < 0.97;
  if (u >= 1 && !L.done) {
    L.done = true;
    b.air = false;
    splash(b, b.x, 34, world);
    fxCall('addShake', world, 3);
    sfx('explodeS');
  }
  return L.done;
}

function regenEyes(world, b) {
  const d = DIFFICULTY[b.phase];
  b.eyes.forEach((e, i) => {
    if (e.state !== 'dead') return;
    if (++e.t >= d.eyeRegen) { e.state = 'ok'; e.hp = d.eyeHp; const p = eyePos(b, i); emit(world, { type: 'gillRegrow', x: p.x, y: p.y, part: 'eye', total: 2, left: b.eyes.filter((q2) => q2.state === 'ok').length }); }
  });
}

function pickAttack(world, b) {
  if (b.calmT > 0) { b.gap = b.calmT; return; }
  const d = DIFFICULTY[b.phase];
  let name;
  if (b.phase === 4 && d.tideEvery && b.atkCount % d.tideEvery === 0 && b.lastAtk !== 'tidalWave') name = 'tidalWave';
  else if (b.home === 'L' && b.leftAtks >= 1) name = b.phase === 4 ? 'glideLeap' : 'leap';
  else if (b.home === 'L') name = world.rng.pick(['lob', 'eyeShot']);
  else name = world.rng.pick(MPOOLS[b.phase].filter((n) => n !== b.lastAtk));
  b.leftAtks = b.home === 'L' ? (b.leftAtks || 0) + 1 : 0;
  if (MBIG.has(name) && world.eShots.length + b.mud.length >= 12) { b.gap = 20; return; }
  b.atkSeq++;
  b.atk = { name, t: 0, id: b.atkSeq };
  b.lastAtk = name;
  b.atkCount++;
  emit(world, { type: 'attackStart', cause: name, name, big: MBIG.has(name), atk: b.atkSeq });
}

function updateCosmetics(b) {
  const s = b.splash;
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i];
    q.t++; q.vy += 0.12; q.x += q.vx - 0.15; q.y += q.vy;
    if (q.y > SURFACE_Y + 2 || q.t > 90) { s[i] = s[s.length - 1]; s.pop(); }
  }
}

function updateDeath(world, b) {
  const T = ++b.deathT;
  const rng = world.fxRng;
  b.jawT = 1; b.eyeUpT = 0;
  if (b.y < SURFACE_Y + 70) { b.vy += 0.12; b.x += b.vx; b.y += b.vy; }
  b.a += (0.6 - b.a) * 0.03;
  b.flush = 0.4 + 0.3 * Math.sin(T * 0.4);
  if (b.y > SURFACE_Y - 10 && !b.splashed) { b.splashed = true; splash(b, b.x, 80, world, 5); fxCall('addShake', world, 6); sfx('explodeL'); }
  if (T < 150 && T % 6 === 0 && b.circles.length) {
    const c = b.circles[rng.int(0, b.circles.length - 1)];
    fxCall('explode', world, c.x + rng.range(-c.r, c.r) * 0.6, Math.min(c.y, SURFACE_Y) + rng.range(-c.r, c.r) * 0.4, T % 30 === 0 ? 'large' : T % 12 === 0 ? 'medium' : 'small', { debris: ['#8a96a8', '#c8f0ff'] });
    if (T % 24 === 0) sfx('explodeS');
  }
  if (T % 20 === 0 && T < 150) splash(b, b.x + rng.range(-50, 50), 14, world, 4);
  if (T === 150) {
    fxCall('explode', world, b.x, SURFACE_Y - 10, 'huge', { debris: ['#8a96a8', '#c8f0ff'] });
    splash(b, b.x, 120, world, 6);
    world.flash = 1;
    world.hitstop = Math.max(world.hitstop, 14);
    fxCall('addShake', world, 8);
    sfx('explodeL');
    world.score += 1000000;
    fxCall('scorePopup', world, Math.min(W - 70, Math.max(40, b.x - 40)), SURFACE_Y - 50, 1000000);
  }
  if (T >= 210) b.deathDone = true;
}

// ---- draw -------------------------------------------------------------------
let _ctx, _b;
function part(s, x, y, a, group, opt) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (a) ctx.rotate(a);
  const far = opt && opt.far;
  ctx.drawImage(far && s.farImg ? s.farImg : s.img, -s.px, -s.py);
  const red = far ? s.farRed : s.red;
  if (_b.flush > 0.02 && red) { ctx.globalAlpha = _b.flush * (0.55 + 0.25 * Math.sin(_b.t * 0.15)); ctx.drawImage(red, -s.px, -s.py); }
  if (group && _b.flashT[group] > 0 && (_b.t & 1)) { ctx.globalAlpha = 0.45; ctx.drawImage(s.white, -s.px, -s.py); }
  ctx.restore();
}

function drawBody(ctx, b, S) {
  const t = b.t;
  const armA = b.air ? 1.1 : -0.1 + Math.sin(t * 0.06) * 0.08;
  const sway = Math.sin(t * 0.07) * 0.08 * (1 + b.sailFlare);
  // far arm
  part(S.upper, -12, 14, armA + 0.15, 'torso', { far: true });
  part(S.lower, -18, 31, armA * 0.6 - 0.2, 'torso', { far: true });
  // tail chain
  const ta = Math.sin(t * 0.09) * 0.12 + (b.air ? -b.vy * 0.03 : 0);
  part(S.tailA, 50, 0, ta, 'tail');
  part(S.tailB, 50 + Math.cos(ta) * 30, Math.sin(ta) * 30, ta * 2.2, 'tail');
  // sails behind the body top
  const sails = [[-12, -24, -0.22], [14, -26, -0.08], [40, -20, 0.12]];
  sails.forEach(([x, y, a0], i) => {
    const a = a0 + sway * (i + 1) * 0.6;
    if (b.sailFlare > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = b.sailFlare * (0.6 + 0.3 * Math.sin(t * 0.3 + i));
      ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a);
      const g = S.sailGlow[i]; ctx.drawImage(g.img, -g.px, -g.py);
      ctx.restore();
    }
    part(S.sails[i], x, y, a, 'torso');
  });
  part(S.torso, 0, 0, 0, 'torso');
  // eyes rise out of the top of the head (drawn behind it)
  b.eyes.forEach((e, i) => {
    const ex = i === 0 ? -52 : -28, ey = (i === 0 ? -28 : -32) - b.eyeUp * 12;
    part(e.state === 'ok' ? S.eye : S.eyeDead, ex, ey, 0, 'eye' + i);
  });
  if (b.jaw > 0.05) part(S.maw, -34, -4, 0, null);
  part(S.jaw, -44, 6, -b.jaw * 0.5, 'head');
  part(S.head, -34, -4, 0, 'head');
  // near arm
  part(S.upper, -22, 16, armA, 'torso');
  part(S.lower, -28, 33, armA * 0.6 - 0.25, 'torso');
}

export function draw(ctx, world) {
  const b = world.boss;
  if (!b || !b.active) return;
  const S = getMudSprites();
  _ctx = ctx; _b = b;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawHazards(ctx, world, b, S, 'under');
  const gone = b.deathDone || b.mode === 'wait' || (b.mode === 'death' && b.deathT >= 151);
  if (!gone) {
    const draw1 = () => {
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      ctx.scale(b.f, 1);
      ctx.rotate(b.a);
      drawBody(ctx, b, S);
      ctx.restore();
    };
    // above the surface: normal; below: a dim submerged silhouette
    ctx.save(); ctx.beginPath(); ctx.rect(-20, -40, W + 40, SURFACE_Y + 40); ctx.clip(); draw1(); ctx.restore();
    if (b.y + 60 > SURFACE_Y) {
      ctx.save(); ctx.beginPath(); ctx.rect(-20, SURFACE_Y, W + 40, H); ctx.clip();
      ctx.globalAlpha = 0.4; draw1();
      ctx.restore();
    }
    // glows
    ctx.globalCompositeOperation = 'lighter';
    if (b.eyeUp > 0.3) b.eyes.forEach((e, i) => {
      if (e.state !== 'ok') return;
      const p = eyePos(b, i);
      if (p.y > SURFACE_Y) return;
      const tell = b.atk && b.atk.name === 'eyeShot' && b.atk.tell ? b.atk.tell : 0;
      ctx.globalAlpha = Math.min(1, b.eyeUp * (0.5 + 0.3 * Math.sin(b.t * 0.2)) + tell);
      ctx.drawImage(tell ? S.tellGlow : S.eyeGlow, Math.round(p.x - 2 * b.f - 10), Math.round(p.y - 12), 20, 20);
    });
    if ((b.air && b.y < SURFACE_Y - 20) || b.bellyTell) {
      const p = toWorld(b, 6, 22);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(b.t * 0.5);
      ctx.drawImage(S.bellyGlow, Math.round(p.x - 14), Math.round(p.y - 14));
    }
    if (b.jaw > 0.3) { const p = toWorld(b, -50, 8); if (p.y < SURFACE_Y) { ctx.globalAlpha = b.jaw * 0.6; ctx.drawImage(S.mawGlow, Math.round(p.x - 14), Math.round(p.y - 14)); } }
    if (b.sailFlare > 0.05) { const p = toWorld(b, 18, -48); ctx.globalAlpha = b.sailFlare * (0.4 + 0.2 * Math.sin(b.t * 0.2)); ctx.drawImage(S.sailFire, Math.round(p.x - 26), Math.round(p.y - 26)); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  drawHoppers(ctx, world, b, S);
  drawHazards(ctx, world, b, S, 'over');
  for (const q of b.splash) {
    ctx.fillStyle = q.c ? '#ffffff' : '#9fe6ff';
    const s = q.t < 20 ? 2 : 1;
    ctx.fillRect(Math.round(q.x), Math.round(q.y), s, s);
  }
  ctx.restore();
}
