import { W, H } from '../config.js';
import { clamp, makeSprite } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, hurtPlayer } from './boss-util.js';
import { emit } from './world.js';
import { getMudSprites } from './boss-mudskipper-parts.js';
import { splash } from './boss-mudskipper.js';
import { updateHazards as updateMud, drawHazards as drawMud } from './boss-mudskipper-attacks.js';
import { initHoppers, updateHoppers, drawHoppers, hitHopper, damageHopper, hopperBodyHit, killAllHoppers } from './boss-mudskipper-hoppers.js';
import { REX_ATTACKS, REX_POOLS, REX_STRONG, updateRexHazards, drawRexHazards } from './boss-mudflat-attacks.js';

export const ZONE_INFO = { letter: 'M', name: 'PERIOPHTHALMUS REX', title: 'AMPHIBIOUS SIEGE BEHEMOTH', area: 'MUDFLAT FRONT' };
export const SURFACE_Y = Math.round(H * 0.66);
export const REX_K = 1.3;          // rig scale (bigger than G)
export const MAX_HP = 3000;
export const STAND_Y = SURFACE_Y - 46, PRONE_Y = SURFACE_Y + 40, STAND_A = 0.2;
export const HOME_X = 300;
const P2_FRAC = 0.7, P3_FRAC = 0.4, P4_FRAC = 0.15;

// ---- DIFFICULTY (per phase) --------------------------------------------------
//  armor: damage mult on the hull (break parts!), sailHp/finHp: part HP, flipT: belly-up frames,
//  coreMult: belly core damage mult, standN/proneN: attacks per stance before switching.
export const DIFFICULTY = {
  1: { gap: 46, spd: 1.0, dmgTaken: 1.28, armor: 0.35, sailHp: 34, finHp: 40, flipT: 260, coreMult: 3.0, standN: 3, proneN: 2,
       stompN: 3, mawN: 4, mawVol: 2, eyeBursts: 2, sailFanN: 4, sailFanVol: 3, crawlSpd: 1.1, mortarN: 3, beamTell: 60, beamTime: 50, grav: 0.07, flopEvery: 0 },
  2: { gap: 36, spd: 1.15, dmgTaken: 1.0, armor: 0.3, sailHp: 40, finHp: 46, flipT: 240, coreMult: 2.8, standN: 2, proneN: 3,
       stompN: 4, mawN: 5, mawVol: 3, eyeBursts: 3, sailFanN: 5, sailFanVol: 4, crawlSpd: 1.3, mortarN: 4, beamTell: 54, beamTime: 60, grav: 0.075, flopEvery: 0 },
  3: { gap: 28, spd: 1.3, dmgTaken: 1.0, armor: 0.3, sailHp: 46, finHp: 52, flipT: 220, coreMult: 2.6, standN: 2, proneN: 2,
       stompN: 4, mawN: 5, mawVol: 3, eyeBursts: 3, sailFanN: 6, sailFanVol: 4, crawlSpd: 1.5, mortarN: 5, beamTell: 50, beamTime: 70, grav: 0.08, flopEvery: 0 },
  4: { gap: 24, spd: 1.4, dmgTaken: 1.0, armor: 0.3, sailHp: 50, finHp: 56, flipT: 200, coreMult: 2.4, standN: 1, proneN: 2,
       stompN: 4, mawN: 6, mawVol: 3, eyeBursts: 3, sailFanN: 6, sailFanVol: 5, crawlSpd: 1.7, mortarN: 5, beamTell: 46, beamTime: 70, grav: 0.08, flopEvery: 3,
       flopTell: 110, surgeSpd: 2.2, surgeGap: 56 },
};

export const CAUSES = {
  mfBody: { name: 'BEHEMOTH BODY', hint: 'Do not touch the behemoth' },
  mfCrawl: { name: 'BELLY CRAWL', hint: 'When it lies flat it sweeps the low lane: rise above its sails as it crawls in' },
  mfStomp: { name: 'STOMP', hint: 'Each stomp splashes: stay off the water line while it walks' },
  mfMaw: { name: 'MAW FAN', hint: 'The maw glows, then fans: slip between the orbs after each fan' },
  mfEye: { name: 'EYE VOLLEY', hint: 'Turret eyes flash cyan, then fire aimed bursts: sidestep each burst' },
  mfSail: { name: 'SAIL SPINES', hint: 'Lying flat, its sails fire spines upward: stay low-left of its head or between the fans' },
  mfMortar: { name: 'MUD MORTAR', hint: 'Mortars arc up and fall on the cyan marks: step aside' },
  mfBeam: { name: 'EYE BEAM', hint: 'A cyan aim line locks before the beam fires: leave the line when it stops blinking' },
  mfSlam: { name: 'BODY SLAM', hint: 'The striped bottom band is where it crashes down: get above it' },
  mfFlop: { name: 'BELLY FLOP', hint: 'Its huge shadow marks the impact: get clear, then ride the tunnel in the surge' },
  mfSurge: { name: 'SURGE WALL', hint: 'Be inside the striped tunnel when the surge passes' },
};

const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

// ---- rig transform: translate → flip x (facing) → rotate → scale K (and y flip when belly-up) ----
export function toWorld(b, lx, ly) {
  const c = Math.cos(b.a), s = Math.sin(b.a), K = REX_K;
  const X = lx * K, Y = ly * K * b.fy;
  return { x: b.x + b.f * (X * c - Y * s), y: b.y + X * s + Y * c };
}

const SAIL_POS = [[-12, -24, -0.22], [14, -26, -0.08], [40, -20, 0.12]];

export function init(world) {
  getMudSprites();
  if (world.bg) world.bg.surfaceY = SURFACE_Y;
  const d = DIFFICULTY[1];
  const b = (world.boss = {
    x: HOME_X + 40, y: SURFACE_Y + 80, hp: MAX_HP, maxHp: MAX_HP, phase: 1,
    active: false, defeated: false, deathDone: false,
    mode: 'wait', modeT: 0, t: 0, deathT: 0, fightT: 0,
    f: 1, fy: 1, a: 0, aT: 0, stance: 'stand', stanceN: 0, step: 0, wrig: 0,
    jaw: 0, jawT: 0, eyeSpin: 0, flame: 0, flush: 0,
    sails: SAIL_POS.map(() => ({ hp: d.sailHp, max: d.sailHp, state: 'ok' })),
    fins: [0, 1].map(() => ({ hp: d.finHp, max: d.finHp, state: 'ok' })),
    atk: null, atkSeq: 0, gap: 40, lastAtk: null, atkCount: 0, calmT: 0, flopFired: false,
    safeHint: null, hazards: [], lasers: [], circles: [], mud: [], shocks: [], splash: [], debris: [], surges: [], beams: [],
    landing: null, flashT: {}, stunned: false, stunT: 0, stunFrames: d.flipT, skimT: 0,
  });
  initHoppers(b);
  b.hopT = 260;
  computeCircles(b);
}

export function debugSetHpFrac(world, f) {
  const b = world.boss;
  b.hp = Math.round(b.maxHp * f);
  b.x = HOME_X; b.y = STAND_Y; b.a = 0.3; b.mode = 'fight'; b.modeT = 0; b.gap = 30;
  if (f <= P2_FRAC) b.phase = 2;
  if (f <= P3_FRAC) { b.phase = 3; b.flush = 0.5; }
  if (f <= P4_FRAC && f > 0) { b.phase = 4; b.flame = 1; b.flush = 0.8; }
  if (b.hp <= 0) { b.hp = 0; startDeath(world); world.hitstop = 0; world.flash = 0; }
  computeCircles(b);
}

// ---- hit circles (local rig coords → world) ------------------------------------
function computeCircles(b) {
  const cs = [];
  const K = REX_K;
  const add = (lx, ly, r, kind, mult, group, id) => { const p = toWorld(b, lx, ly); cs.push({ x: p.x, y: p.y, r: r * K, kind, mult, group, id }); };
  if (b.mode === 'flip') add(6, 20, 20, 'core', 1, 'core');
  b.sails.forEach((s, i) => { if (s.state !== 'broken') { const [x, y] = SAIL_POS[i]; add(x + 10, y - 26, 15, 'sail', 1, 'sail' + i, i); } });
  if (b.fins[0].state !== 'broken') { add(-24, 22, 8, 'fin', 1, 'fin0', 0); add(-32, 38, 8, 'fin', 1, 'fin0', 0); }
  if (b.fins[1].state !== 'broken') add(-14, 34, 9, 'fin', 1, 'fin1', 1);
  if (b.jaw > 0.4) add(-48, 10, 12, 'mouth', 1.6, 'head');
  add(-62, 2, 16, 'head', 1, 'head');
  add(-36, -6, 22, 'head', 1, 'head');
  add(4, 0, 28, 'body', 1, 'torso');
  add(36, 0, 22, 'body', 1, 'torso');
  add(70, 0, 13, 'tail', 0.6, 'tail');
  b.circles = cs;
}

function hittable(b) {
  return b.active && !b.defeated && b.mode !== 'wait' && b.mode !== 'roar' && !(b.mode === 'entry' && b.modeT < 100);
}

export function hitTest(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.active) return null;
  const h = hitHopper(world, x, y, r);
  if (h) return h;
  if (!hittable(b)) return null;
  for (const c of b.circles) {
    const rr = c.r + r;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr * rr) return { kind: c.kind, part: c.kind, id: c.id, mult: c.mult, group: c.group, x, y };
  }
  return null;
}

function contactAt(world, x, y, r) {
  const b = world.boss;
  const h = hopperBodyHit(world, x, y, r);
  if (h) return { kind: 'escort', cause: 'mudHopper', x: h.x, y: h.y };
  if (!hittable(b) || b.mode === 'flip' || b.mode === 'righting') return null;
  for (const c of b.circles) {
    if (c.kind === 'sail' || c.kind === 'mouth') continue;
    const rr = c.r * 0.78 + r;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr * rr) {
      const cause = b.atk && b.atk.name === 'flop' ? 'mfFlop' : b.atk && b.atk.name === 'slam' ? 'mfSlam' : b.stance === 'prone' ? 'mfCrawl' : 'mfBody';
      return { kind: 'body', cause, x: c.x, y: c.y };
    }
  }
  return null;
}
export function bodyHit(world, x, y, r) { return !!contactAt(world, x, y, r); }

export function targets(world) {
  const b = world.boss;
  if (!b || !b.active || b.defeated) return [];
  const out = b.hoppers.filter((h) => h.on && h.y < SURFACE_Y).map((h) => ({ x: h.x, y: h.y, kind: 'escort' }));
  for (const c of b.circles) if (c.kind === 'sail' || c.kind === 'fin' || c.kind === 'core' || c.kind === 'mouth') out.push({ x: c.x, y: c.y, kind: c.kind === 'core' ? 'weak' : c.kind });
  if (!out.some((o) => o.kind !== 'escort') && hittable(b)) { const p = toWorld(b, -40, -4); out.push({ x: p.x, y: p.y, kind: 'body' }); }
  return out;
}

export function applyDamage(world, hit, dmg) {
  const b = world.boss;
  if (!hit || !b) return;
  if (hit.kind === 'escort') { damageHopper(world, hit, dmg); return; }
  if (!hittable(b)) return;
  const d = DIFFICULTY[b.phase];
  let mult = hit.mult ?? 1;
  if (hit.kind === 'body' || hit.kind === 'head' || hit.kind === 'tail') mult *= hit.source === 'burst' ? 1 : d.armor;
  if (hit.kind === 'core') mult = d.coreMult;
  mult *= d.dmgTaken;
  b.flashT[hit.group || 'torso'] = 3;
  if (hit.kind === 'body' || hit.kind === 'head' || hit.kind === 'tail') {
    if ((b.t & 3) === 0) fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.7, 0.7));
    world.score += 3;
  } else world.score += Math.round(10 * mult);
  if ((hit.kind === 'sail' || hit.kind === 'fin' || hit.kind === 'core' || hit.kind === 'mouth') && b.t - (b.weakEmitT || -99) >= 6) {
    b.weakEmitT = b.t;
    emit(world, { type: 'weakHit', x: hit.x, y: hit.y, part: hit.kind });
  }
  if (hit.kind === 'sail') damagePart(world, b.sails[hit.id], 'sail', hit.id, dmg);
  if (hit.kind === 'fin') damagePart(world, b.fins[hit.id], 'fin', hit.id, dmg);
  const floor = b.phase < 4 || b.mode === 'roar' || !b.flopFired ? 1 : 0;
  b.hp = Math.max(Math.min(b.hp, floor), b.hp - dmg * mult);
  b.lastDmgT = b.t;
  checkPhase(world);
}

function partPos(b, kind, i) {
  if (kind === 'sail') { const [x, y] = SAIL_POS[i]; return toWorld(b, x + 10, y - 26); }
  return toWorld(b, i === 0 ? -28 : -14, i === 0 ? 30 : 34);
}

function damagePart(world, p, kind, i, dmg) {
  const b = world.boss;
  if (p.state === 'broken') return;
  p.hp -= dmg;
  if (p.hp < p.max * 0.5 && p.state === 'ok') { p.state = 'cracked'; const q = partPos(b, kind, i); fxCall('explode', world, q.x, q.y, 'small', { debris: ['#8a96a8', '#ff7a30'] }); sfx('hit'); }
  if (p.hp > 0) return;
  p.state = 'broken';
  const pos = partPos(b, kind, i);
  fxCall('explode', world, pos.x, pos.y, 'medium', { debris: ['#8a96a8', '#ff7a30'] });
  sfx('explodeS');
  world.hitstop = Math.max(world.hitstop, 4);
  fxCall('addShake', world, 3);
  world.score += 5000;
  fxCall('scorePopup', world, pos.x, pos.y, 5000);
  const S = getMudSprites();
  b.debris.push({ spr: kind === 'sail' ? S.sails[i] : S.lower, x: pos.x, y: pos.y, a: b.a, vx: world.fxRng.range(-1.2, 0.6), vy: -2.2, va: world.fxRng.range(-0.12, 0.12), t: 0 });
  const list = kind === 'sail' ? b.sails : b.fins;
  const left = list.filter((q) => q.state !== 'broken').length;
  emit(world, { type: 'gillKill', x: pos.x, y: pos.y, part: kind, left, total: list.length });
  // FLIP when every sail is broken, or both fins + all but one sail
  const sailsLeft = b.sails.filter((q) => q.state !== 'broken').length;
  const finsLeft = b.fins.filter((q) => q.state !== 'broken').length;
  if (b.mode === 'fight' && (sailsLeft === 0 || (finsLeft === 0 && sailsLeft <= 1))) startFlip(world);
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
  b.mud.length = 0; b.shocks.length = 0; b.surges.length = 0; b.beams.length = 0; b.landing = null; b.slamBand = null; b.flopShadow = null;
}

export function endAttack(b) {
  b.atk = null; b.jawT = 0; b.landing = null; b.safeHint = null; b.slamBand = null; b.flopShadow = null; b.beams.length = 0;
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

function startFlip(world) {
  const b = world.boss;
  if (b.atk) endAttack(b);
  clearField(world, b);
  b.mode = 'flip'; b.modeT = 0; b.stunned = true; b.stunFrames = DIFFICULTY[b.phase].flipT; b.stunT = b.stunFrames;
  b.stance = 'prone';
  world.hitstop = Math.max(world.hitstop, 12);
  world.flash = Math.max(world.flash, 0.35);
  fxCall('addShake', world, 7);
  sfx('explodeL');
  splash(b, b.x, 60, world, 5);
  stats(world).stuns++;
  emit(world, { type: 'stunStart', x: b.x, y: b.y, frames: b.stunFrames, reason: 'flipped' });
}

function startDeath(world) {
  const b = world.boss;
  b.hp = 0; b.defeated = true; b.mode = 'death'; b.modeT = 0; b.deathT = 0;
  if (b.stunned) { b.stunned = false; emit(world, { type: 'stunEnd', x: b.x, y: b.y }); }
  if (b.atk) endAttack(b);
  clearField(world, b);
  killAllHoppers(world, b);
  world.hitstop = Math.max(world.hitstop, 30);
  world.flash = Math.max(world.flash, 0.7);
  fxCall('addShake', world, 8);
  sfx('explodeL');
}

// ---- update -------------------------------------------------------------------
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
      // rears up out of the sea on the right
      const u = clamp((b.modeT - 20) / 110, 0, 1);
      b.x = HOME_X + 30 * (1 - u); b.y = SURFACE_Y + 80 + (STAND_Y - SURFACE_Y - 80) * (1 - (1 - u) ** 3);
      b.aT = STAND_A; b.stance = 'stand';
      if (b.modeT === 20) { splash(b, b.x - 40, 70, world, 5); sfx('bossRoar'); fxCall('addShake', world, 6); }
      if (b.modeT % 6 === 0 && u < 1) splash(b, b.x - 60 + world.fxRng.range(-30, 60), 6, world, 3);
      b.jawT = b.modeT > 130 && b.modeT < 175 ? 1 : 0;
      if (b.modeT >= 185) { b.mode = 'fight'; b.modeT = 0; b.gap = 30; b.calmT = 40; }
      break;
    }
    case 'fight':
      b.fightT++;
      if (!b.atk) {
        idle(world, b);
        if (--b.gap <= 0) pickAttack(world, b);
      } else {
        const done = REX_ATTACKS[b.atk.name](world, b, b.atk);
        if (b.atk) b.atk.t++;
        if (done === true) { endAttack(b); b.gap = d.gap; }
      }
      break;
    case 'roar':
      b.jawT = b.modeT < 80 ? 1 : 0;
      if (b.phase === 4) { b.flame = Math.min(1, b.modeT / 60); b.flush = 0.8 * b.flame; }
      if (b.phase === 3) b.flush = Math.min(0.5, b.modeT / 80);
      if (b.modeT % 10 === 0 && b.modeT < 80) fxCall('explode', world, b.x + world.fxRng.range(-60, 60), b.y + world.fxRng.range(-40, 20), 'small', { debris: ['#8a96a8', '#ff7a30'] });
      if (b.modeT >= 110) { b.mode = 'fight'; b.modeT = 0; b.gap = 24; b.calmT = 80; b.atkCount = 0; checkPhase(world); }
      break;
    case 'flip': {
      // belly-up: flailing, eyes spinning, the belly core exposed
      b.stunT = Math.max(0, b.stunFrames - b.modeT);
      b.fy += (-1 - b.fy) * 0.18;
      b.y += (SURFACE_Y + 10 - b.y) * 0.1; b.aT = Math.sin(b.t * 0.3) * 0.08;
      b.eyeSpin += 0.4; b.jawT = 0.35 + 0.3 * Math.sin(b.t * 0.4);
      if (b.modeT % 20 === 0) splash(b, b.x + world.fxRng.range(-80, 80), 10, world, 3);
      if (b.modeT >= b.stunFrames) { b.mode = 'righting'; b.modeT = 0; b.stunned = false; b.stunT = 0; emit(world, { type: 'stunEnd', x: b.x, y: b.y }); }
      break;
    }
    case 'righting':
      b.fy += (1 - b.fy) * 0.15;
      b.jawT = 0;
      if (b.modeT === 20) { splash(b, b.x, 50, world, 4); sfx('bossRoar'); fxCall('addShake', world, 4); }
      if (b.modeT >= 44) {
        b.fy = 1; b.eyeSpin = 0;
        for (const s of b.sails) { s.max = d.sailHp; s.hp = s.max; s.state = 'ok'; }
        for (const s of b.fins) { s.max = d.finHp; s.hp = s.max; s.state = 'ok'; }
        b.mode = 'fight'; b.modeT = 0; b.gap = 20; b.calmT = 80; b.stance = 'prone'; b.stanceN = 99; // rears up next
        checkPhase(world);
      }
      break;
    case 'death':
      updateDeath(world, b);
      break;
  }

  b.jaw += ((b.jawT || 0) - b.jaw) * 0.15;
  b.a += ((b.aT || 0) - b.a) * 0.12;
  if (b.phase === 4 && b.mode !== 'death') b.flame = 1;
  computeCircles(b);
  const sh = b.shocks; b.shocks = [];
  updateMud(world, b); // G physics for mud orbs; stomp shocks handled in updateRexHazards (mfStomp)
  b.shocks = sh;
  updateRexHazards(world, b);
  if (b.atk && REX_STRONG.has(b.atk.name)) b.hopT = Math.max(b.hopT, 30); // no packs during big moves
  updateHoppers(world, b);
  updateCosmetics(b);

  b.hazards.length = 0;
  for (const m of b.mud) b.hazards.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, g: m.g, cause: m.cause, atk: m.atk });
  for (const s of b.shocks) b.hazards.push({ x: s.x, y: SURFACE_Y - 5, vx: s.vx, vy: 0, r: 8, g: 0, cause: 'mfStomp', atk: s.atk });
  for (const h of b.hoppers) if (h.on && h.air) b.hazards.push({ x: h.x, y: h.y, vx: h.vx, vy: h.vy, r: 6, g: h.g, cause: 'mudHopper', atk: 0 });
  for (const s of b.surges) for (let y = 4; y < H; y += 12) if (y < s.g0 - 4 || y > s.g1 + 4) for (const dx of [6, 24, 42]) b.hazards.push({ x: s.x + dx * -s.dir, y, vx: s.dir * s.spd, vy: 0, r: 10, g: 0, cause: 'mfSurge', atk: s.atk, pending: s.state === 'tell' });

  if (b.mode === 'fight' || (b.mode === 'entry' && b.modeT > 120)) {
    const hb = player.playerHitbox(world);
    const c = hb && contactAt(world, hb.x, hb.y, hb.r);
    if (c) hurtPlayer(world, { ...c, atk: b.atk ? b.atk.id : 0 });
  }
  if (world.bg) {
    if (b.phase === 4 && b.mode !== 'death') { world.bg.tint = { r: 150, g: 40, b: 0, a: 0.14 }; world.bg.darken = 0.14 + (b.flopShadow ? 0.25 : 0); }
    else if (b.mode === 'death' && b.deathT === 150) { world.bg.tint = 0; world.bg.darken = 0; }
  }
}

// idle: STAND sways and faces the player; PRONE wriggles in place
function idle(world, b) {
  const p = world.player;
  if (p && p.alive) b.f = p.x < b.x ? 1 : -1;
  if (b.stance === 'stand') {
    b.y += (STAND_Y + Math.sin(b.t * 0.05) * 2 - b.y) * 0.08;
    b.aT = STAND_A + Math.sin(b.t * 0.04) * 0.03;
  } else {
    b.y += (PRONE_Y + Math.sin(b.t * 0.12) * 1.5 - b.y) * 0.1;
    b.aT = Math.sin(b.t * 0.12) * 0.05;
    b.wrig += 0.1;
  }
  b.x += (clamp(b.x, 150, HOME_X + 10) - b.x) * 0.05;
}

function pickAttack(world, b) {
  if (b.calmT > 0) { b.gap = b.calmT; return; }
  const d = DIFFICULTY[b.phase];
  const finsLeft = b.fins.filter((q) => q.state !== 'broken').length;
  let name;
  if (b.phase === 4 && d.flopEvery && b.atkCount % d.flopEvery === 0 && b.lastAtk !== 'flop') name = 'flop';
  else if (b.stance === 'stand' && b.stanceN >= d.standN) name = 'slam';
  else if (b.stance === 'prone' && b.stanceN >= d.proneN && finsLeft > 0) name = 'rise';
  else name = world.rng.pick(REX_POOLS[b.stance].filter((n) => n !== b.lastAtk));
  if (REX_STRONG.has(name) && world.eShots.length + b.mud.length >= 12) { b.gap = 20; return; }
  b.atkSeq++;
  b.atk = { name, t: 0, id: b.atkSeq };
  b.lastAtk = name;
  b.atkCount++;
  if (name !== 'slam' && name !== 'rise' && name !== 'flop') b.stanceN++;
  emit(world, { type: 'attackStart', cause: name, name, big: name === 'flop' || name === 'slam', atk: b.atkSeq });
}

function updateCosmetics(b) {
  const s = b.splash;
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i];
    q.t++; q.vy += 0.12; q.x += q.vx - 0.15; q.y += q.vy;
    if (q.y > SURFACE_Y + 2 || q.t > 90) { s[i] = s[s.length - 1]; s.pop(); }
  }
  const dd = b.debris;
  for (let i = dd.length - 1; i >= 0; i--) {
    const q = dd[i];
    q.t++; q.vy += 0.07; q.x += q.vx; q.y += q.vy; q.a += q.va;
    if (q.y > H + 60 || q.t > 300) { dd[i] = dd[dd.length - 1]; dd.pop(); }
  }
}

function updateDeath(world, b) {
  const T = ++b.deathT;
  const rng = world.fxRng;
  b.jawT = 1; b.eyeSpin += 0.2;
  b.aT = Math.min(0.5, T * 0.004);
  b.y += (SURFACE_Y + 60 - b.y) * 0.015;
  b.flush = 0.4 + 0.3 * Math.sin(T * 0.4);
  if (T < 150 && T % 6 === 0 && b.circles.length) {
    const c = b.circles[rng.int(0, b.circles.length - 1)];
    fxCall('explode', world, c.x + rng.range(-c.r, c.r) * 0.6, c.y + rng.range(-c.r, c.r) * 0.4, T % 30 === 0 ? 'large' : T % 12 === 0 ? 'medium' : 'small', { debris: ['#8a96a8', '#c8f0ff'] });
    if (T % 24 === 0) sfx('explodeS');
  }
  if (T % 16 === 0 && T < 150) splash(b, b.x + rng.range(-90, 90), 16, world, 4);
  if (T === 150) {
    fxCall('explode', world, b.x - 30, b.y - 20, 'huge', { debris: ['#8a96a8', '#c8f0ff'] });
    splash(b, b.x, 140, world, 6);
    world.flash = 1;
    world.hitstop = Math.max(world.hitstop, 14);
    fxCall('addShake', world, 8);
    sfx('explodeL');
    world.score += 1500000;
    fxCall('scorePopup', world, Math.min(W - 80, Math.max(40, b.x - 60)), SURFACE_Y - 60, 1500000);
  }
  if (T >= 214) b.deathDone = true;
}

// ---- draw ---------------------------------------------------------------------
let _ctx, _b;
function part(s, x, y, a, group, opt) {
  if (!s) return;
  const ctx = _ctx;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (a) ctx.rotate(a);
  const far = opt && opt.far;
  const img = far && s.farImg ? s.farImg : s.img, ds = s.detailScale || 1;
  ctx.drawImage(img, -s.px, -s.py, img.width / ds, img.height / ds);
  const red = far ? s.farRed : s.red;
  if (_b.flush > 0.02 && red) { ctx.globalAlpha = _b.flush * (0.55 + 0.25 * Math.sin(_b.t * 0.15)); ctx.drawImage(red, -s.px, -s.py, red.width / ds, red.height / ds); }
  if (group && _b.flashT[group] > 0 && (_b.t & 1)) { ctx.globalAlpha = 0.45; ctx.drawImage(s.white, -s.px, -s.py, s.white.width / ds, s.white.height / ds); }
  ctx.restore();
}

// crack lines drawn over a damaged part (rig-local, cheap)
function cracks(ctx, x, y, n, seed) {
  ctx.fillStyle = '#120a06';
  for (let k = 0; k < n; k++) {
    let cx = x + ((seed * 7 + k * 11) % 13) - 6, cy = y + ((seed * 5 + k * 17) % 21) - 10;
    for (let s = 0; s < 6; s++) { ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1); cx += ((s + k) % 3) - 1; cy += 1; }
  }
}

// belly plate exposed when flipped: riveted hatch ring around a reactor iris (cached; art pending)
let _belly = null;
function bellySprite() {
  if (_belly) return _belly;
  const w = 96, h = 34;
  _belly = makeSprite(w, h, (c) => {
    const cx = w / 2, cy = h / 2;
    const ell = (rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
    ell(47, 16, '#1c1a1c'); ell(45, 15, '#6a5a44'); ell(42, 13, '#a88c5c'); ell(40, 12, '#7a6648');
    c.fillStyle = '#3a3028';
    for (let i = -4; i <= 4; i++) { if (i === 0) continue; const x = cx + i * 9; const ry = 12 * Math.sqrt(1 - (i * 9 / 41) ** 2); c.fillRect(Math.round(x), Math.round(cy - ry + 1), 2, Math.round(ry * 2 - 2)); }
    c.fillStyle = '#d8c08a';
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; c.fillRect(Math.round(cx + Math.cos(a) * 43) - 1, Math.round(cy + Math.sin(a) * 14) - 1, 2, 2); }
    ell(17, 10, '#140c0a'); ell(15, 9, '#5a1408'); ell(12, 7, '#c03a10'); ell(8, 5, '#ff8a2a'); ell(4, 3, '#fff0b0');
    c.strokeStyle = '#140c0a'; c.lineWidth = 1;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 3); c.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 9); c.stroke(); }
  });
  return _belly;
}

function drawRig(ctx, b, S) {
  const t = b.t;
  const prone = b.stance === 'prone' || b.mode === 'flip' || b.mode === 'righting';
  const flail = b.mode === 'flip' ? Math.sin(t * 0.5) * 0.9 : 0;
  const step = b.step || 0;
  // arm pose: STAND = down to the water (counter-rotated) with stepping; PRONE = splayed and paddling
  const armNear = prone ? -0.9 + Math.sin(b.wrig) * 0.3 + flail : -b.a - 0.05 + Math.max(0, Math.sin(step)) * -0.5;
  const armFar = prone ? 0.7 + Math.sin(b.wrig + 2) * 0.3 - flail : -b.a + 0.1 + Math.max(0, -Math.sin(step)) * -0.5;
  if (b.fins[1].state !== 'broken') {
    part(S.upper, -12, 14, armFar + 0.1, 'fin1', { far: true });
    part(S.lower, -18, 31, armFar * 0.6 - 0.1, 'fin1', { far: true });
  }
  const ta = Math.sin(t * (prone ? 0.16 : 0.08)) * (prone ? 0.25 : 0.1);
  part(S.tailA, 50, 0, ta, 'tail');
  part(S.tailB, 50 + Math.cos(ta) * 30, Math.sin(ta) * 30, ta * 2.4, 'tail');
  const sway = Math.sin(t * 0.07) * 0.06;
  SAIL_POS.forEach(([x, y, a0], i) => {
    const sl = b.sails[i];
    if (sl.state === 'broken') {
      // torn spar stumps: jagged dark metal with a molten edge (art pending)
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a0);
      const J = [[-2, 2], [-1, -9], [2, -14], [4, -8], [7, -17], [10, -9], [13, -12], [16, -4], [18, 2]];
      ctx.fillStyle = '#231e1c'; ctx.beginPath(); J.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6a5c50'; ctx.fillRect(-1, -2, 18, 3);
      ctx.fillStyle = (t >> 2) & 1 ? '#ffb040' : '#ff6a20';
      for (let k = 1; k < J.length - 1; k++) ctx.fillRect(J[k][0] - 1, J[k][1], 2, 2);
      ctx.restore();
      return;
    }
    const a = a0 + sway * (i + 1) * 0.6;
    if (b.flame > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = b.flame * (0.6 + 0.3 * Math.sin(t * 0.3 + i));
      ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a);
      const g = S.sailGlow[i]; ctx.drawImage(g.img, -g.px, -g.py);
      ctx.restore();
    }
    part(S.sails[i], x, y, a, 'sail' + i);
    if (sl.state === 'cracked') { ctx.save(); ctx.translate(x, y); ctx.rotate(a); cracks(ctx, 14, -26, 4, i + 1); ctx.restore(); }
  });
  part(S.torso, 0, 0, 0, 'torso');
  [[-52, -40], [-28, -44]].forEach(([ex, ey], i) => part(S.eye, ex, ey, b.eyeSpin ? b.eyeSpin + i : 0, null));
  if (b.jaw > 0.05) part(S.maw, -34, -4, 0, null);
  part(S.jaw, -44, 6, -b.jaw * 0.36, 'head');
  part(S.head, -34, -4, 0, 'head');
  if (b.fins[0].state !== 'broken') {
    part(S.upper, -22, 16, armNear, 'fin0');
    part(S.lower, -28, 33, armNear * 0.6 - 0.25, 'fin0');
    if (b.fins[0].state === 'cracked') cracks(ctx, -26, 30, 3, 9);
  } else { ctx.fillStyle = '#2a2420'; ctx.fillRect(-26, 14, 8, 8); }
}

export function draw(ctx, world) {
  const b = world.boss;
  if (!b || !b.active) return;
  const S = getMudSprites();
  _ctx = ctx; _b = b;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawMud(ctx, world, b, S, 'under');
  drawRexHazards(ctx, world, b, S, 'under');
  drawHoppers(ctx, world, b, S);
  const gone = b.deathDone || b.mode === 'wait' || (b.mode === 'death' && b.deathT >= 151);
  if (!gone) {
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    ctx.scale(b.f, 1);
    ctx.rotate(b.a);
    ctx.scale(REX_K, REX_K * b.fy);
    drawRig(ctx, b, S);
    ctx.restore();
    // belly core when flipped (procedural plate on the upturned belly — art pending)
    if (b.mode === 'flip' || (b.mode === 'righting' && b.fy < 0)) {
      const p = toWorld(b, 6, 20);
      const bs = bellySprite();
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(b.a); ctx.drawImage(bs, -bs.width / 2, -bs.height / 2); ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(b.t * 0.4);
      ctx.drawImage(S.bellyGlow, Math.round(p.x) - 14, Math.round(p.y) - 16, 28, 28);
      ctx.drawImage(S.sailFire, Math.round(p.x) - 26, Math.round(p.y) - 28);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    [[-52, -42], [-28, -46]].forEach(([ex, ey]) => {
      const p = toWorld(b, ex - 3, ey);
      const tell = b.atk && b.atk.eyeTell ? b.atk.eyeTell : 0;
      ctx.globalAlpha = Math.min(1, 0.55 + 0.25 * Math.sin(b.t * 0.2) + tell);
      ctx.drawImage(tell ? S.tellGlow : S.eyeGlow, Math.round(p.x) - 11, Math.round(p.y) - 11, 22, 22);
    });
    if (b.jaw > 0.3) { const p = toWorld(b, -50, 8); ctx.globalAlpha = b.jaw * 0.7; ctx.drawImage(S.mawGlow, Math.round(p.x) - 16, Math.round(p.y) - 16, 32, 32); }
    if (b.flame > 0.05) { const p = toWorld(b, 14, -52); ctx.globalAlpha = b.flame * (0.45 + 0.2 * Math.sin(b.t * 0.2)); ctx.drawImage(S.sailFire, Math.round(p.x) - 34, Math.round(p.y) - 34, 68, 68); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  for (const q of b.debris) {
    const s = q.spr, ds = s.detailScale || 1;
    ctx.save(); ctx.translate(Math.round(q.x), Math.round(q.y)); ctx.rotate(q.a); ctx.scale(REX_K, REX_K);
    ctx.drawImage(s.img, -s.px, -s.py, s.img.width / ds, s.img.height / ds); ctx.restore();
  }
  // hoppers are drawn behind the rex (they pour out from under it, like the reference)
  drawMud(ctx, world, b, S, 'over');
  drawRexHazards(ctx, world, b, S, 'over');
  for (const q of b.splash) {
    ctx.fillStyle = q.c ? '#ffffff' : '#9fe6ff';
    const s = q.t < 20 ? 2 : 1;
    ctx.fillRect(Math.round(q.x), Math.round(q.y), s, s);
  }
  ctx.restore();
}
