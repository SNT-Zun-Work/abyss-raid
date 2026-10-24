
import { W, H } from '../config.js';
import { clamp, lerp, easeOutCubic } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { getSprites, TAIL, BANDS } from './boss-parts.js';
import { ATTACKS, POOLS, BIG, updateLaser, drawLaser, setAtk } from './boss-attacks.js';
import { initEscorts, updateEscorts, drawEscorts, hitEscort, damageEscort, escortBodyHit, killAllEscorts } from './boss-escorts.js';
import { child, sfx, fxCall, hurtPlayer, HULL_DEBRIS, aimLead, atkLogInit, atkStarted, atkCompleted, atkCancelled, bagLeft, bagDraw } from './boss-util.js';
import { emit } from './world.js';
const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

export const ZONE_INFO = { letter: 'V', name: 'AMBYSTOMA ROSEA', title: 'GIGANTIC AMPHIBIOUS BATTLESHIP', area: 'ABYSSAL TRENCH' };
export const MAX_HP = 3000;

// ---- DIFFICULTY (one table for tuning; per phase 1-4) -----------------------
//  gap: frames between attacks (P1 ramps 90 -> gap with heat), spd: bullet speed scale,
//  dmgTaken: damage multiplier the boss receives (P4 is tougher), plus per-pattern knobs.
export const DIFFICULTY = {
  1: { surge: 0, snipe: 0, gunners: [1, 3], lead: 0, coreBursts: 3, gap: 50, spd: 1.0, dmgTaken: 2.15, stunMult: 2.5, gillHp: 16, gillRegrow: 1200, gillVolleys: 2, gillStep: 20, spreadVolleys: 3, spreadEvery: 16, spreadN: 5, spreadStep: 0.28, spreadAlt: false,
       needleSpd: 2.3, coreSpd: 2.6, eggN: 4, larvaN: 2, larvaSpd: 0.9, walls: 2, wallSpd: 1.1, wallGap: 26, ringN: 14, rings: 4, ringSpd: 1.15, laserEvery: 0 },
  2: { surge: 0.3, snipe: 0, gunners: [1, 3], lead: 0.3, coreBursts: 4, gap: 18, spd: 1.4, dmgTaken: 1.1, stunMult: 2.0, gillHp: 26, gillRegrow: 900, gillVolleys: 4, gillStep: 14, spreadVolleys: 5, spreadEvery: 14, spreadN: 7, spreadStep: 0.26, spreadAlt: true,
       needleSpd: 3.2, coreSpd: 3.6, eggN: 6, larvaN: 3, larvaSpd: 1.0, walls: 3, wallSpd: 1.25, wallGap: 22, ringN: 20, rings: 5, ringSpd: 1.35, laserEvery: 0 },
  3: { surge: 0.4, snipe: 76, gunners: [2, 4], lead: 0.4, coreBursts: 4, gap: 24, spd: 1.5, dmgTaken: 0.36, stunMult: 1.6, gillHp: 30, gillRegrow: 540, gillVolleys: 5, gillStep: 12, spreadVolleys: 5, spreadEvery: 12, spreadN: 7, spreadStep: 0.24, spreadAlt: true,
       needleSpd: 3.2, coreSpd: 4, eggN: 6, larvaN: 4, larvaSpd: 1.15, walls: 3, wallSpd: 1.55, wallGap: 20, ringN: 26, rings: 6, ringSpd: 1.6, laserEvery: 4 },
  4: { surge: 0.45, snipe: 64, gunners: [2, 4], lead: 0.45, coreBursts: 4, gap: 24, spd: 1.6, dmgTaken: 0.46, stunMult: 1.5, gillHp: 34, gillRegrow: 420, gillVolleys: 4, gillStep: 12, spreadVolleys: 4, spreadEvery: 12, spreadN: 7, spreadStep: 0.24, spreadAlt: true,
       needleSpd: 3.2, coreSpd: 4, eggN: 7, larvaN: 4, larvaSpd: 1.15, walls: 4, wallSpd: 1.4, wallGap: 19, ringN: 24, rings: 5, ringSpd: 1.6,
       gigaEvery: 3, gigaCharge: 110, gigaFire: 120, gigaHalf: 42, rockWaves: 3, rockStep: 11, rockSafe: 26, rockSpd: 3.6, dashTell: 50, dashSpd: 9, rockEvery: 90, rockJump: 50 },
};
export const P4_FRAC = 0.15; // final form below this HP fraction
export { CAUSES } from './boss-attacks.js';
const REST_X = 322;
const REST_Y = 106;
const ENTRY_FRAMES = 170;
const ROAR_FRAMES = 50;
const P2_FRAC = 0.65;
const P3_FRAC = 0.3;
// ---- gill hunt / stun tunables
export const GILL_HP = 16;
// per-phase gill HP / regrow / stun multiplier live in DIFFICULTY (gillHp, gillRegrow, stunMult)
export const GILL_REGROW = Object.fromEntries(Object.entries(DIFFICULTY).map(([k, d]) => [k, d.gillRegrow])); // (HUD compat)
// frames until dead gill i starts regrowing (Infinity while stunned / not dead)
export function gillRegrowLeft(world, i) {
  const b = world.boss, g = b && b.gills[i];
  if (!g || g.state !== 'dead' || b.mode === 'stun') return Infinity;
  return Math.max(0, DIFFICULTY[b.phase].gillRegrow - g.t);
}
export const GILL_STALL = 300; // each gill kill pushes the other stumps' regrowth back by this much
export const STUN_FRAMES = 240;

export const CALM_FRAMES = 120; // release beat after phase transitions and stuns

// gill-fins in head space: base point, base angle (0 = pointing back), near/far
const GILLS = [
  // outer halves must clear the head/torso silhouette so every gill can be shot from the front
  { x: -8, y: -16, a: -1.15, near: true },
  { x: -4, y: -6, a: -0.95, near: true },
  { x: -4, y: 8, a: 0.95, near: true },
  { x: -4, y: -20, a: -1.45, near: false },
  { x: 0, y: -10, a: -1.12, near: false },
  { x: 0, y: 6, a: 1.2, near: false },
]
// fin-blades in root space
const BLADES = [
  { x: -54, y: -32, a: -1.05, s: 'bladeS' },
  { x: -22, y: -36, a: -0.95, s: 'blade' },
  { x: 14, y: -36, a: -0.85, s: 'blade' },
  { x: 48, y: -32, a: -0.75, s: 'blade' },
  { x: -30, y: 34, a: 0.95, s: 'bladeS' },
  { x: 6, y: 35, a: 0.85, s: 'blade' },
  { x: 40, y: 32, a: 0.75, s: 'bladeS' },
];
const ARMOR_KEYS = ['helmet', 'chin', 'band0', 'band1', 'band2', 'band3', 'band4'];
const P2_POP = ['chin', 'band2', 'band1', 'band3'];
const P3_POP = ['helmet', 'band0', 'band4'];
const ARMOR_MULT = 0.25;

// 0 → 1 over the first ~50 s of the fight: early P1 is gentler (player starts weak)
export const heat = (b) => (b.phase > 1 ? 1 : Math.min(1, b.fightT / 3000));

export function init(world) {
  getSprites();
  world.boss = {
    x: W + 210, y: REST_Y, hp: MAX_HP, maxHp: MAX_HP, phase: 1,
    active: false, defeated: false, deathDone: false,
    mode: 'wait', modeT: 0, t: 0, deathT: 0, fightT: 0,
    tilt: 0, sink: 0, headDip: 0,
    jaw: 0, jawT: 0, gillFlare: 0, tailCurl: 0, tailCurlT: 0, flush: 0, shadow: 1, eyeDim: 0, portGlow: 0, mawGlow: 0,
    atk: null, gap: 40, lastAtk: null, atkCount: 0,
    gills: GILLS.map(() => ({ hp: GILL_HP, state: 'alive', t: 0, scale: 1 })),
    armor: Object.fromEntries(ARMOR_KEYS.map((k) => [k, true])),
    restX: REST_X, atkSeq: 0, walls: [], gigaFired: false, safeHint: null, lasers: [], giga: null, rocks: null, dashBand: null, eyeFlare: 0, flame: 0,
    flashT: {}, stunned: false, stunT: 0, stunFrames: STUN_FRAMES, calmT: 0, weakEmitT: -99, gillKills: 0, itemN: 0,
    laser: null, charge: [], tracked: [], debris: [],
    pose: null, circles: [], aimY: REST_Y, tinkCd: 0, laserCd: 0, chunkT: 0,
  };
  initEscorts(world.boss);
  atkLogInit(world.boss);
  computePose(world.boss);
}

export function debugSetHpFrac(world, f) {
  const b = world.boss;
  b.hp = Math.round(b.maxHp * f);
  b.x = REST_X;
  b.mode = 'fight'; b.modeT = 0; b.shadow = 0; b.gap = 30;
  if (f <= P2_FRAC) { b.phase = 2; for (const k of P2_POP) b.armor[k] = false; }
  if (f <= P3_FRAC) { b.phase = 3; b.flush = 1; for (const k of P3_POP) b.armor[k] = false; }
  if (f <= P4_FRAC && f > 0) { b.phase = 4; b.flame = 1; b.restX = REST_X + 30; }
  if (b.hp <= 0) { b.hp = 0; startDeath(world); world.hitstop = 0; world.flash = 0; }
  computePose(b);
}

// every attack of a phase (incl. the cadence specials) = that phase's first-rotation bag
export const BAGS = { 1: POOLS[1], 2: POOLS[2], 3: [...POOLS[3], 'laser'], 4: [...POOLS[4], 'gigaLaser'] };

// shared item drops (escorts + gills): kinds cycle so the player powers up evenly
const ITEM_CYCLE = ['laser', 'shield', 'laser', 'wave', 'homing', 'laser', 'shield', 'wave', 'laser', 'homing', 'wave', 'bomb'];
export function dropItem(world, x, y) {
  const b = world.boss;
  if (typeof player.spawnItem !== 'function') return;
  player.spawnItem(world, x, y, ITEM_CYCLE[b.itemN++ % ITEM_CYCLE.length]);
}

// ---------------------------------------------------------------- pose ---
function computePose(b) {
  const t = b.t;
  const P = {};
  const roll = Math.sin(t / 70) * 0.022;
  // stun: convulsions that fade out
  const jit = b.mode === 'stun' ? Math.max(0, 1 - b.modeT / 90) * 1.6 : 0;
  const root = { x: b.x + Math.sin(t * 2.1) * jit, y: b.y + b.sink + Math.cos(t * 2.9) * jit, a: b.tilt + roll + Math.sin(t * 1.7) * jit * 0.01 };
  P.root = root;
  P.head = child(root, -56, -4, Math.sin(t / 47) * 0.03 + b.headDip);
  P.jaw = child(P.head, -14, 10, -b.jaw * 0.36);
  P.gills = GILLS.map((g, i) => {
    const ph = t * (0.05 + b.gillFlare * 0.05) + i * 1.3;
    const spread = g.a * 0.3 * b.gillFlare;
    const droop = b.mode === 'stun' ? Math.min(1, b.modeT / 40) * (g.a < 0 ? 0.55 : 0.25) : 0;
    const a0 = g.a + spread + Math.sin(ph) * (0.08 + b.gillFlare * 0.06) + b.headDip * 1.5 + droop;
    const base = child(P.head, g.x, g.y, a0);
    const sc = b.gills[i].scale;
    const mid = child(base, 29 * sc, 0, Math.sin(ph - 0.9) * 0.2 + (g.a < 0 ? 0.18 : -0.12));
    const tip = child(mid, 34 * sc, 0);
    return { base, mid, tip, sc };
  });
  P.blades = BLADES.map((d, i) => child(root, d.x, d.y, d.a + Math.sin(t * 0.06 - i * 0.7) * 0.12 * (1 + b.gillFlare)));
  const leg = (hx, hy, ph) => {
    const hip = child(root, hx, hy, 0.25 + Math.sin(t * 0.045 + ph) * 0.28);
    const knee = child(hip, -3, 15, -0.35 + Math.sin(t * 0.045 + ph - 1.1) * 0.32);
    return { hip, knee };
  };
  P.legs = { fn: leg(-40, 24, 0), hn: leg(48, 24, 2.2), ff: leg(-28, 18, 3.1), hf: leg(58, 18, 5.0) };
  P.tail = [];
  let seg = child(root, 68, -2, -0.05 + Math.sin(t * 0.03) * 0.06 - b.tailCurl * 0.2);
  for (let i = 0; i < TAIL.n; i++) {
    const amp = 0.05 + i * 0.018;
    const bend = Math.sin(t * 0.045 - i * 0.6) * amp - b.tailCurl * 0.36;
    seg = { x: seg.x, y: seg.y, a: seg.a + bend };
    P.tail.push(seg);
    seg = child(seg, TAIL.len, 0);
  }
  P.tailTip = seg;
  P.mouth = child(P.head, -84, 13);
  P.throat = child(P.jaw, -6, 14);
  P.eye = child(P.head, -58, -9);
  P.port = child(root, 2, 2);
  b.pose = P;
  b.aimY = Math.round(P.throat.y + 4);
  buildCircles(b);
}

function buildCircles(b) {
  const P = b.pose, cs = [];
  const add = (p, r, kind, mult, group, id) => cs.push({ x: p.x, y: p.y, r, kind, mult, group, id });
  const A = b.armor;
  b.gills.forEach((g, i) => {
    if (g.state !== 'alive') return;
    const q = P.gills[i];
    // hit zones on the feathery outer half (the part that sticks out)
    add(child(q.mid, 4, 0), 7, 'gill', 1, 'gill' + i, i);
    add(child(q.mid, 20, 0), 7, 'gill', 1, 'gill' + i, i);
  });
  add(P.throat, 8, 'weak', 1.6, 'jaw');
  if (b.jaw > 0.4) add(child(P.head, -50, 14), 12, 'mouth', 2, 'head');
  const head = (lx, ly, r) => add(child(P.head, lx, ly), r, A.helmet ? 'armor' : 'head', A.helmet ? ARMOR_MULT : 0.8, A.helmet ? 'helmet' : 'head');
  head(-80, 2, 13); head(-54, -8, 19); head(-24, -8, 19);
  const jaw = (lx, ly, r) => add(child(P.jaw, lx, ly), r, A.chin ? 'armor' : 'jaw', A.chin ? ARMOR_MULT : 0.8, A.chin ? 'chin' : 'jaw');
  jaw(-64, 3, 8); jaw(-40, 3, 8);
  add(P.port, 11, 'weak', 1.3, 'core');
  BANDS.forEach(([xa, xb], i) => {
    const on = A['band' + i];
    const cx = (xa + xb) / 2;
    for (const cy of [-17, 15]) add(child(P.root, cx, cy), 17, on ? 'armor' : 'body', on ? ARMOR_MULT : 1, on ? 'band' + i : 'torso');
  });
  // (legs have no hit circles: they would shield the lower gill-fins)
  P.tail.forEach((s, i) => add(child(s, TAIL.len / 2, 0), TAIL.r[i] * 0.9, 'tail', 0.3, 'tail'));
  b.circles = cs;
}

// Live weak points + escorts for homing weapons: [{x, y, kind}]
export function targets(world) {
  const b = world.boss;
  if (!b || !b.active || b.defeated || !b.pose) return [];
  const out = b.escorts.filter((e) => e.on && e.x > 0).map((e) => ({ x: e.x, y: e.y, kind: 'escort' }));
  if (b.mode === 'entry' && b.x > W - 40) return out;
  const seen = new Set();
  for (const c of b.circles) {
    if (c.kind === 'gill') { if (seen.has(c.id)) continue; seen.add(c.id); out.push({ x: c.x, y: c.y, kind: 'gill', id: c.id }); }
    else if (c.kind === 'weak' || c.kind === 'mouth') out.push({ x: c.x, y: c.y, kind: c.kind });
  }
  return out;
}

// ------------------------------------------------------------ hit API ---
function hittable(b) {
  return b.active && !b.defeated && b.mode !== 'wait' && b.mode !== 'finalForm' && !(b.mode === 'entry' && b.x > W - 40);
}

export function hitTest(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.active) return null;
  const e = hitEscort(world, x, y, r);
  if (e) return e;
  if (!hittable(b)) return null;
  for (const c of b.circles) {
    const rr = c.r + r;
    if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < rr * rr) return { part: c.kind, kind: c.kind, id: c.id, mult: c.mult, group: c.group, x, y };
  }
  return null;
}

export function bodyHit(world, x, y, r) {
  return !!contactAt(world, x, y, r);
}

// what the player touched: { kind: 'body'|'escort', x, y } (contact source point) or null
function contactAt(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.active) return null;
  const e = escortBodyHit(world, x, y, r);
  if (e) return { kind: 'escort', x: e.x, y: e.y };
  if (!hittable(b)) return null;
  for (const c of b.circles) {
    if (c.kind === 'gill' || c.kind === 'mouth') continue;
    const rr = c.r * 0.85 + r;
    if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < rr * rr) return { kind: 'body', x: c.x, y: c.y };
  }
  return null;
}

export function applyDamage(world, hit, dmg) {
  const b = world.boss;
  if (!hit || !b) return;
  if (hit.kind === 'escort') { damageEscort(world, hit, dmg); return; }
  if (!hittable(b)) return;
  // the Abyss Burst shockwave ignores armor (detected by source tag or its big per-tick damage)
  const burst = hit.source === 'burst';
  const base = burst && hit.kind === 'armor' ? 1 : (hit.mult ?? 1);
  const mult = base * (b.stunned ? DIFFICULTY[b.phase].stunMult : 1) * (DIFFICULTY[b.phase].dmgTaken ?? 1);
  if ((hit.kind === 'weak' || hit.kind === 'mouth' || hit.kind === 'gill') && b.t - b.weakEmitT >= 6) {
    b.weakEmitT = b.t;
    emit(world, { type: 'weakHit', x: hit.x, y: hit.y, part: hit.kind === 'weak' ? hit.group : hit.kind });
  }
  b.flashT[hit.group || 'torso'] = 3;
  if (hit.kind === 'armor') {
    if (b.tinkCd <= 0) {
      fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.7, 0.7));
      fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.7, 0.7));
      b.tinkCd = 3;
    }
    world.score += 2;
  } else {
    world.score += Math.round(10 * mult);
  }
  if (hit.kind === 'gill') damageGill(world, hit.id, dmg);
  // phase gates: HP can't skip past a transition while it plays
  const floor = b.phase === 1 ? Math.ceil(b.maxHp * P3_FRAC) + 1 : b.phase < 4 || b.mode === 'enrage' || b.mode === 'finalForm' || !b.gigaFired ? 1 : 0;
  b.hp = Math.max(Math.min(b.hp, floor), b.hp - dmg * mult);
  checkPhase(world);
}

function damageGill(world, i, dmg) {
  const b = world.boss, g = b.gills[i];
  if (g.state !== 'alive') return;
  g.hp -= dmg;
  if (g.hp > 0) return;
  g.state = 'dead';
  g.t = 0;
  const q = b.pose.gills[i];
  const at = q.mid;
  g.flash = 14; // stump flashes
  fxCall('explode', world, at.x, at.y, 'medium', { debris: ['#e07090', '#a8145a', '#f8a0c0'] });
  fxCall('explode', world, q.base.x, q.base.y, 'small', { debris: false });
  sfx('explodeS');
  world.score += 3000;
  world.hitstop = Math.max(world.hitstop, 3);
  fxCall('addShake', world, 2);
  const willStun = b.mode === 'fight' && b.gills.every((q2) => q2 === g || q2.state === 'dead');
  if (!willStun) fxCall('scorePopup', world, at.x, at.y, 3000); // the final gill's feedback merges into the STUN display
  // the whole gill tears off
  spawnDebris(b, getSprites().gillA, q.base, -0.8 + world.fxRng.range(-0.4, 0.4), -1.9, !GILLS[i].near);
  spawnDebris(b, getSprites().gillB, q.mid, -1.3 + world.fxRng.range(-0.4, 0.4), -1.5, !GILLS[i].near);
  for (const q2 of b.gills) if (q2 !== g && q2.state === 'dead') q2.t = Math.max(0, q2.t - GILL_STALL);
  const left = b.gills.filter((q2) => q2.state === 'alive').length;
  emit(world, { type: 'gillKill', x: at.x, y: at.y, left, regrowIn: DIFFICULTY[b.phase].gillRegrow });
  b.gillKills++;
  // all six down at once → the beast is stunned (damage window)
  if (b.mode === 'fight' && b.gills.every((q2) => q2.state === 'dead')) startStun(world);
}

function checkPhase(world) {
  const b = world.boss;
  // combat v2b: a phase transition never cuts the FIRST showing of an attack — it waits (a few seconds
  // at most) until that attack completes; damage keeps applying meanwhile (no gating)
  if (b.mode === 'fight' && b.atk && b.phase < 4 && bagLeft(b, b.atk.ph, BAGS[b.atk.ph]).includes(b.atk.name)) return;
  // a stun is never cut short: transitions wait until it ends (checkPhase runs again at stunEnd)
  if (b.phase === 1 && b.mode === 'fight' && b.hp <= b.maxHp * P2_FRAC) setMode(world, 'armorBreak');
  else if (b.phase === 2 && b.mode === 'fight' && b.hp <= b.maxHp * P3_FRAC) setMode(world, 'enrage');
  else if (b.phase === 3 && b.mode === 'fight' && b.hp <= b.maxHp * P4_FRAC) setMode(world, 'finalForm');
  else if (b.phase === 4 && b.hp <= 0 && !b.defeated) startDeath(world);
}

function setMode(world, m) {
  const b = world.boss;
  b.mode = m;
  b.modeT = 0;
  if (b.atk) endAttack(b);
  b.stunned = false; b.headDip = 0; b.eyeDim = 0;
  bullets.clearAll(world, true);
  b.walls.length = 0;
  b.tracked.length = 0;
  world.flash = Math.max(world.flash, 0.5);
  fxCall('addShake', world, 6);
  if (m === 'armorBreak') {
    world.hitstop = Math.max(world.hitstop, 18);
    sfx('explodeL');
    emit(world, { type: 'phaseChange', from: 1, to: 2 });
  } else if (m === 'enrage') {
    b.phase = 3;
    world.hitstop = Math.max(world.hitstop, 20);
    sfx('bossRoar');
    emit(world, { type: 'phaseChange', from: 2, to: 3 });
  } else if (m === 'finalForm') {
    b.phase = 4;
    world.hitstop = Math.max(world.hitstop, 30);
    world.flash = 1;
    fxCall('explode', world, b.pose.port.x, b.pose.port.y, 'huge', { debris: HULL_DEBRIS });
    fxCall('screenRumble', world, 150, 3);
    sfx('explodeL'); sfx('rumble');
    emit(world, { type: 'phaseChange', from: 3, to: 4 });
  }
}

function startStun(world) {
  const b = world.boss;
  b.mode = 'stun';
  b.modeT = 0;
  b.stunned = true;
  b.stunT = STUN_FRAMES;
  if (b.atk) endAttack(b);
  bullets.clearAll(world, true);
  b.walls.length = 0;
  world.hitstop = Math.max(world.hitstop, 10);
  world.flash = Math.max(world.flash, 0.3);
  fxCall('addShake', world, 5);
  sfx('bossRoar');
  stats(world).stuns++;
  emit(world, { type: 'stunStart', x: b.pose.head.x, y: b.pose.head.y, frames: STUN_FRAMES });
}

function endStun(world) {
  const b = world.boss;
  if (b.mode !== 'stun') return;
  b.stunned = false;
  b.stunT = 0;
  emit(world, { type: 'stunEnd', x: b.pose.head.x, y: b.pose.head.y });
}

function startDeath(world) {
  const b = world.boss;
  endStun(world);
  b.hp = 0;
  b.defeated = true;
  b.mode = 'death';
  b.modeT = 0;
  b.deathT = 0;
  b.stunned = false;
  if (b.atk) endAttack(b);
  bullets.clearAll(world, true);
  b.walls.length = 0;
  b.tracked.length = 0;
  killAllEscorts(world, b);
  world.hitstop = Math.max(world.hitstop, 30);
  world.flash = Math.max(world.flash, 0.7);
  fxCall('addShake', world, 8);
  sfx('explodeL');
}

function endAttack(b, done = false) {
  if (b.atk && !done) atkCancelled(b, b.atk.ph, b.atk.name);
  b.atk = null;
  b.headDip = 0;
  b.laser = null;
  b.giga = null; b.rocks = null; b.rockTell = null; b.dashBand = null; b.eyeFlare = 0; if (!b.walls.length) b.safeHint = null;
  b.jawT = 0;
  b.tailCurlT = 0;
  b.portGlow = 0;
  b.mawGlow = 0;
}

function spawnDebris(b, spr, at, vx, vy, far = false) {
  b.debris.push({ spr, x: at.x, y: at.y, a: at.a || 0, vx, vy, va: (vx < 0 ? -1 : 1) * 0.06, far, t: 0 });
}

// --------------------------------------------------------------- update ---
export function update(world) {
  const b = world.boss;
  if (!b.active) return;
  b.t++;
  b.modeT++;
  const pl = world.player;
  if (pl) { const px = b.pv ? b.pv.px : pl.x, py = b.pv ? b.pv.py : pl.y; b.pv = { x: (b.pv ? b.pv.x * 0.7 : 0) + (pl.x - px) * 0.3, y: (b.pv ? b.pv.y * 0.7 : 0) + (pl.y - py) * 0.3, px: pl.x, py: pl.y }; }
  if (b.tinkCd > 0) b.tinkCd--;
  if (b.calmT > 0 && b.mode === 'fight') b.calmT--;
  for (const k in b.flashT) if (b.flashT[k] > 0) b.flashT[k]--;
  const p = world.player;
  let flare = 0;

  switch (b.mode) {
    case 'wait':
      b.mode = 'entry'; b.modeT = 0; b.x = W + 210; b.shadow = 1;
      break;
    case 'entry': {
      const k = Math.min(1, b.modeT / ENTRY_FRAMES);
      b.x = lerp(W + 210, REST_X, easeOutCubic(k));
      b.y = REST_Y + Math.sin(b.t / 60) * 6;
      b.shadow = Math.max(0, 1 - b.modeT / (ENTRY_FRAMES * 0.85));
      if (b.modeT === ENTRY_FRAMES) { sfx('bossRoar'); fxCall('addShake', world, 5); }
      const roar = b.modeT > ENTRY_FRAMES && b.modeT < ENTRY_FRAMES + ROAR_FRAMES - 10;
      b.jawT = roar ? 1 : 0;
      flare = roar ? 1 : 0;
      if (b.modeT >= ENTRY_FRAMES + ROAR_FRAMES) { b.mode = 'fight'; b.modeT = 0; b.gap = 20; b.calmT = 60; }
      break;
    }
    case 'fight':
      b.fightT++;
      if (!(b.atk && b.atk.ctrl)) move(world, b, p);
      regrowGills(world, b);
      if (!b.atk) {
        if (--b.gap <= 0) pickAttack(world, b);
      } else {
        setAtk(b.atk.id);
        const done = ATTACKS[b.atk.name](world, b, b.atk, b.pose);
        if (b.atk) b.atk.t++;
        if (done === true) { atkCompleted(b, b.atk.ph, b.atk.name, BAGS[b.atk.ph]); endAttack(b, true); b.gap = b.phase === 1 ? Math.round(90 - (90 - DIFFICULTY[1].gap) * heat(b)) : DIFFICULTY[b.phase].gap; }
      }
      if (b.atk && b.atk.flare) flare = b.atk.flare;
      snipe(world, b);
      break;
    case 'armorBreak':
    case 'enrage': {
      const list = b.mode === 'armorBreak' ? P2_POP : P3_POP;
      b.jawT = b.modeT < 90 ? 1 : 0;
      flare = 1;
      b.headDip = Math.sin(b.modeT * 0.3) * 0.05;
      const i = Math.floor((b.modeT - 8) / 12);
      if ((b.modeT - 8) % 12 === 0 && i >= 0 && i < list.length) popArmor(world, b, list[i]);
      if (b.modeT === 40) sfx('bossRoar');
      if (b.mode === 'enrage') {
        b.flush = Math.min(1, b.modeT / 60);
        if (b.modeT % 10 === 0) fxCall('explode', world, b.x + world.fxRng.range(-60, 40), b.y + world.fxRng.range(-30, 30), 'small', { debris: HULL_DEBRIS });
      }
      if (b.modeT >= 110) {
        if (b.mode === 'armorBreak') {
          b.phase = 2;
        }
        b.mode = 'fight'; b.modeT = 0; b.gap = 24; b.headDip = 0; b.calmT = CALM_FRAMES;
        checkPhase(world);
      }
      break;
    }
    case 'finalForm': {
      // FINAL FORM: the core blows open, the body flushes white-hot, the gills ignite,
      // and the beast backs off toward the right edge.
      b.jawT = b.modeT < 120 ? 1.25 : 0;
      flare = 1;
      b.flame = Math.min(1, b.modeT / 70);
      b.flush = 1;
      b.restX = REST_X + 30;
      b.x += (b.restX - b.x) * 0.03;
      b.y += (REST_Y - b.y) * 0.05;
      b.headDip = Math.sin(b.modeT * 0.5) * 0.06 * Math.max(0, 1 - b.modeT / 120);
      if (b.modeT % 8 === 0 && b.modeT < 110) fxCall('explode', world, b.x + world.fxRng.range(-70, 50), b.y + world.fxRng.range(-34, 34), 'medium', { debris: HULL_DEBRIS });
      if (b.modeT === 60) sfx('bossRoar');
      if (b.modeT >= 160) { b.mode = 'fight'; b.modeT = 0; b.gap = 30; b.headDip = 0; b.calmT = 90; b.atkCount = 0; }
      break;
    }
    case 'stun':
      b.stunT = Math.max(0, STUN_FRAMES - b.modeT); // gameplay-clock countdown for the HUD
      regrowGills(world, b);
      b.jawT = 1.05;
      b.headDip = Math.min(0.16, b.modeT * 0.01) + (b.modeT < 60 ? Math.sin(b.modeT * 1.7) * 0.05 * (1 - b.modeT / 60) : 0);
      b.eyeDim = (b.modeT >> 2) % 3 === 0 ? 0.2 : 0.85;
      b.y += (REST_Y + 14 - b.y) * 0.03;
      if (b.modeT % 24 === 0) fxCall('spark', world, b.pose.eye.x, b.pose.eye.y - 6, -Math.PI / 2 + world.fxRng.range(-1, 1));
      if (b.modeT >= STUN_FRAMES) {
        endStun(world);
        b.mode = 'fight'; b.modeT = 0; b.headDip = 0; b.eyeDim = 0; b.gap = 20; b.calmT = CALM_FRAMES;
        b.gills.forEach((g) => { if (g.state === 'dead') g.t = Math.max(g.t, DIFFICULTY[b.phase].gillRegrow - 40); });
        sfx('bossRoar');
        checkPhase(world); // deferred phase transition
      }
      break;
    case 'death':
      updateDeath(world, b);
      break;
  }

  // smooth animation channels
  b.jaw += ((b.jawT || 0) - b.jaw) * 0.14;
  b.tailCurl += ((b.tailCurlT || 0) - b.tailCurl) * 0.08;
  b.gillFlare += (flare - b.gillFlare) * 0.12;
  if (b.phase === 3 && b.mode !== 'enrage' && b.mode !== 'death') b.flush = 1;
  // P3 mood: the water darkens and reddens (background exposes bg.tint / bg.darken)
  if (world.bg && b.phase >= 3 && b.mode !== 'death') {
    const g = b.giga ? (b.giga.state === 'charge' ? b.giga.k * 0.45 : 0.45) : 0;
    world.bg.tint = { r: 120, g: 0, b: 20, a: (b.phase === 4 ? 0.18 : 0.12) * Math.min(1, b.flush) };
    world.bg.darken = (b.phase === 4 ? 0.22 : 0.15) * Math.min(1, b.flush) + g;
  }
  // bubble walls in flight: the next one to reach the ship drives the safe hint
  if (b.walls.length) {
    const px = world.player && world.player.alive ? world.player.x : 60;
    let found = null;
    for (let i = b.walls.length - 1; i >= 0; i--) {
      const q = b.walls[i];
      q.x += q.vx; q.next = false;
      if (q.x < -14) b.walls.splice(i, 1);
    }
    for (const q of b.walls) if (q.x > px - 8 && (!found || q.x < found.x)) found = q;
    if (found) {
      found.next = true;
      const cur = b.safeHint;
      if (!cur || !cur.rects.length || cur.cause === 'bubbleWall') {
        b.safeHint = { cause: 'bubbleWall', atk: found.atk, text: 'Be inside the next gap (arrows) before the wall arrives', rects: [{ x: 0, y: Math.max(0, found.y0), w: Math.min(W, found.x + 4), h: Math.max(2, Math.min(H, found.y1) - Math.max(0, found.y0)) }] };
      }
    }
  }
  if (!b.atk && !b.walls.length && b.safeHint) b.safeHint = null;
  // beams for bots/HUD: {x, y, a, w, state}
  b.lasers.length = 0;
  if (b.giga) b.lasers.push({ x: b.giga.x, y: b.giga.y, a: Math.PI, w: b.giga.hh * 2, state: b.giga.state === 'charge' ? 'charge' : 'fire', atk: b.giga.atk });
  if (b.giga && b.giga.state === 'fire') fxCall('heatHaze', world, 0, b.giga.y - b.giga.hh - 6, Math.round(b.giga.x), b.giga.hh * 2 + 12, 2);
  else if (world.bg && b.mode === 'death' && b.deathT === 176) { world.bg.tint = 0; world.bg.darken = 0; }
  b.chunkT++;
  if (b.phase >= 2 && b.mode !== 'death' && b.chunkT % 70 === 0) spawnChunk(world, b);

  computePose(b);
  updateLaser(world, b);
  updateEscorts(world, b);
  updateDebris(b);

  // player crashing into the body
  if (b.mode !== 'death' && b.mode !== 'entry') {
    const hb = player.playerHitbox(world);
    const hit = hb && contactAt(world, hb.x, hb.y, hb.r);
    if (hit) hurtPlayer(world, { ...hit, atk: b.atk ? b.atk.id : 0, cause: hit.kind === 'escort' ? 'fry' : b.atk && b.atk.name === 'dashCharge' ? 'dashCharge' : 'contact' });
  }
}

// P3/P4 pressure layer: alternating top/bottom gill tips fire one leading aimed orb
// every DIFFICULTY.snipe frames (a white-cyan tip flash 12f before), except during
// spectacle attacks, release beats and stuns.
function snipe(world, b) {
  const d = DIFFICULTY[b.phase];
  if (!d.snipe || b.calmT > 0 || (b.atk && BIG.has(b.atk.name)) || (b.atk && b.atk.name === 'laser')) { b.snipeT = 0; b.snipeTell = -1; return; }
  b.snipeT = (b.snipeT || 0) + 1;
  const live = b.gills.map((g, i) => i).filter((i) => b.gills[i].state === 'alive');
  if (!live.length) { b.snipeTell = -1; return; }
  const k = (b.snipeN || 0) % live.length, gi = live[k];
  b.snipeTell = d.snipe - b.snipeT <= 12 ? gi : -1;
  if (b.snipeT < d.snipe) return;
  b.snipeT = 0; b.snipeN = (b.snipeN || 0) + 1;
  const tip = b.pose.gills[gi].tip, spd = 1.9 * d.spd;
  const a = aimLead(world, tip.x, tip.y, spd, d.lead);
  bullets.fire(world, { x: tip.x, y: tip.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, type: 'orb', color: b.phase === 4 ? 'orange' : 'violet', cause: 'gillSnipe', atk: 0 });
}

function move(world, b, p) {
  const t = b.t;
  const fast = b.phase >= 3 ? 1.8 : b.phase === 2 ? 1.25 : 1;
  const hold = b.atk && b.atk.hold;
  let ty = REST_Y + Math.sin(t / (90 / fast)) * (14 + 6 * (b.phase - 1));
  if (p && p.alive) ty += clamp(p.y - REST_Y, -40, 40) * 0.25;
  const tx = b.restX + Math.sin(t / (160 / fast)) * (6 + 6 * Math.min(2, b.phase - 1));
  ty = clamp(ty, b.phase === 4 ? 80 : 90, b.phase === 4 ? 134 : 124);
  const k = hold ? 0.004 : 0.02 * fast;
  b.y += (ty - b.y) * k;
  b.x += (tx - b.x) * k;
}

function pickAttack(world, b) {
  if (b.calmT > 0) { b.gap = b.calmT; return; } // release beat: no new attack yet
  const pool = POOLS[b.phase].filter((n) => n !== b.lastAtk);
  const d = DIFFICULTY[b.phase];
  const special = b.phase === 3 && d.laserEvery ? (b.atkCount % d.laserEvery === 0 ? 'laser' : null)
    : b.phase === 4 && d.gigaEvery ? (b.atkCount % d.gigaEvery === 0 ? 'gigaLaser' : null) : null;
  let name;
  // combat v2b first rotation: the scripted P4 opener (GIGA LASER) stays first, then every attack of
  // the phase is drawn once without replacement (until each has COMPLETED), then normal selection
  if (b.phase === 4 && b.atkCount === 0 && special) name = special;
  else if (b.bagHold && b.bagHold.ph === b.phase && bagLeft(b, b.phase, BAGS[b.phase]).includes(b.bagHold.name)) name = b.bagHold.name; // drawn, waiting for a quiet screen
  else if (bagLeft(b, b.phase, BAGS[b.phase]).length) name = bagDraw(world, b, b.phase, BAGS[b.phase]);
  else if (special && b.lastAtk !== special) name = special;
  else name = world.rng.pick(pool);
  // spectacle attacks start only on a near-empty screen so their SAFE zones are really safe
  const quiet = BIG.has(name) || name === 'laser' ? 12 : Infinity;
  if (world.eShots.length >= quiet) { b.gap = 20; b.bagHold = { name, ph: b.phase }; return; }
  b.bagHold = null;
  b.atkSeq++;
  b.atk = { name, t: 0, id: b.atkSeq, ph: b.phase };
  atkStarted(b, b.phase, name);
  emit(world, { type: 'attackStart', cause: name, name, big: BIG.has(name), atk: b.atkSeq });
  b.lastAtk = name;
  b.atkCount++;
}

function regrowGills(world, b) {
  for (const g of b.gills) {
    if (g.flash > 0) g.flash--;
    if (g.state === 'dead') {
      g.scale = 0;
      if (b.mode !== 'stun' && ++g.t >= DIFFICULTY[b.phase].gillRegrow) { g.state = 'regrow'; g.t = 0; }
    } else if (g.state === 'regrow') {
      g.t++;
      g.scale = Math.min(1, g.t / 70);
      if (g.scale >= 1) {
        g.state = 'alive'; g.hp = DIFFICULTY[b.phase].gillHp;
        const q = b.pose.gills[b.gills.indexOf(g)];
        emit(world, { type: 'gillRegrow', x: q.mid.x, y: q.mid.y });
      }
    }
  }
}

function armorParent(b, k) {
  return k === 'helmet' ? b.pose.head : k === 'chin' ? b.pose.jaw : b.pose.root;
}

function popArmor(world, b, k) {
  if (!b.armor[k]) return;
  b.armor[k] = false;
  const s = getSprites().armor[k];
  const parent = armorParent(b, k);
  const at = child(parent, s.ox, s.oy);
  fxCall('explode', world, at.x, at.y, 'medium', { debris: HULL_DEBRIS });
  fxCall('addShake', world, 3);
  sfx('explodeS');
  world.score += 5000;
  fxCall('scorePopup', world, at.x, at.y, 5000);
  const up = at.y < b.y ? -1 : 0.3;
  b.debris.push({ spr: s, x: at.x, y: at.y, a: parent.a, vx: world.fxRng.range(-1.2, 0.8), vy: up * world.fxRng.range(1.2, 2.4), va: world.fxRng.range(-0.06, 0.06), t: 0 });
  for (let i = 0; i < 5; i++) spawnChunk(world, b, at);
}

function spawnChunk(world, b, at) {
  const S = getSprites();
  const src = at || (b.circles.length ? b.circles[world.fxRng.int(0, b.circles.length - 1)] : null);
  if (!src) return;
  const x = src.x + world.fxRng.range(-8, 8), y = src.y + world.fxRng.range(-6, 6);
  b.debris.push({ spr: S.chunks[world.fxRng.int(0, S.chunks.length - 1)], x, y, a: 0, vx: world.fxRng.range(-1, 0.6), vy: world.fxRng.range(-1.5, 0), va: world.fxRng.range(-0.15, 0.15), t: 0 });
}

function updateDebris(b) {
  const d = b.debris;
  for (let i = d.length - 1; i >= 0; i--) {
    const q = d[i];
    q.t++;
    q.vy += 0.05; q.vx *= 0.995;
    q.x += q.vx - 0.2; q.y += q.vy; q.a += q.va;
    if (q.y > H + 80 || q.x < -80 || q.t > 600) { d[i] = d[d.length - 1]; d.pop(); }
  }
}

function updateDeath(world, b) {
  const T = ++b.deathT;
  const rng = world.fxRng;
  b.jawT = T < 140 ? 1 : 0.6;
  b.eyeDim = Math.min(1, T / 120);
  b.tilt = Math.min(0.3, T * 0.002);
  b.sink = T > 30 ? ((T - 30) / 40) ** 2 * 5 : 0;
  b.flush = 0.35 + 0.3 * Math.sin(T * 0.4);
  if (T < 172 && T % 5 === 0 && b.circles.length) {
    const c = b.circles[rng.int(0, b.circles.length - 1)];
    const ex = c.x + rng.range(-c.r, c.r) * 0.6, ey = c.y + rng.range(-c.r, c.r) * 0.6;
    fxCall('explode', world, ex, ey, T % 30 === 0 ? 'large' : T % 10 === 0 ? 'medium' : 'small', { debris: false });
    spawnChunk(world, b, { x: ex, y: ey });
    if (T % 20 === 0) { sfx('explodeL'); fxCall('addShake', world, 3); } else if (T % 10 === 0) sfx('explodeS');
  }
  if (T % 40 === 0 && T < 170) world.flash = Math.max(world.flash, 0.35);
  if (T === 12 || T === 40 || T === 70) {
    const left = ARMOR_KEYS.filter((k) => b.armor[k]);
    for (let i = 0; i < Math.min(3, left.length); i++) popArmor(world, b, left[i]);
  }
  if (T === 30 || T === 55 || T === 80) {
    const wave = (T - 30) / 25;
    for (let i = 0; i < 6; i++) {
      const g = b.gills[i];
      if (i % 3 !== wave) continue;
      if (g.state === 'alive' || g.state === 'regrow') {
        spawnDebris(b, getSprites().gillA, b.pose.gills[i].base, rng.range(-1.5, 0.5), rng.range(-2, -0.8), !GILLS[i].near);
        fxCall('explode', world, b.pose.gills[i].base.x, b.pose.gills[i].base.y, 'medium', { debris: HULL_DEBRIS });
      }
      g.state = 'dead'; g.scale = 0;
    }
  }
  if (T === 110) fxCall('explode', world, b.pose.tail[3].x, b.pose.tail[3].y, 'large', { debris: HULL_DEBRIS });
  if (T === 176) {
    fxCall('explode', world, b.x - 50, b.y + b.sink, 'huge', { debris: HULL_DEBRIS });
    fxCall('explode', world, b.x + 40, b.y + b.sink + 10, 'large', { debris: HULL_DEBRIS });
    world.flash = 1;
    world.hitstop = Math.max(world.hitstop, 14);
    fxCall('addShake', world, 8);
    sfx('explodeL');
    const bonus = 1000000;
    world.score += bonus;
    fxCall('scorePopup', world, Math.min(W - 70, b.x - 70), b.y, bonus);
  }
  if (T >= 236) b.deathDone = true;
}

// ----------------------------------------------------------------- draw ---
let _ctx, _flush, _shadow, _b;
function paintPart(ctx,s,image){const scale=s.detailScale||1;ctx.drawImage(image,-s.px,-s.py,image.width/scale,image.height/scale);}
function part(s, p, ox, oy, group, opt) {
  if (!s) return;
  const ctx = _ctx;
  ctx.save();
  if (ox || oy) {
    const c = Math.cos(p.a), sn = Math.sin(p.a);
    ctx.translate(Math.round(p.x + ox * c - oy * sn), Math.round(p.y + ox * sn + oy * c));
  } else ctx.translate(Math.round(p.x), Math.round(p.y));
  if (Math.abs(p.a) > 0.004) ctx.rotate(p.a);
  const sc = opt && opt.sc;
  if (sc !== undefined && sc !== 1) ctx.scale(sc, sc);
  const far = opt && opt.far;
  paintPart(ctx,s,far && s.farImg ? s.farImg : s.img);
  const red = far ? s.farRed : s.red;
  if (_flush > 0.02 && red) {
    ctx.globalAlpha = _flush;
    paintPart(ctx,s,red);
  }
  const fl = opt && opt.flame > 0.01 ? (far ? s.farFlame : s.flame) : null;
  if (fl) { ctx.globalAlpha = opt.flame * (0.85 + 0.15 * Math.sin(_b.t * 0.6)); paintPart(ctx,s,fl); }
  if (opt && opt.white) { ctx.globalAlpha = 0.85; paintPart(ctx,s,s.white); }
  if (group && _b.flashT[group] > 0 && (_b.t & 1)) { ctx.globalAlpha = 0.42; paintPart(ctx,s,s.white); }
  if (_shadow > 0.01) { ctx.globalAlpha = _shadow; paintPart(ctx,s,s.dark); }
  ctx.restore();
}

function tint(ctx, s, p, sc, alpha) { edge(ctx, s, p, sc, alpha, s.white); }
function edge(ctx, s, p, sc, alpha, img = s.edge) {
  if (!img || alpha <= 0.01) return;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  if (Math.abs(p.a) > 0.004) ctx.rotate(p.a);
  if (sc !== 1) ctx.scale(sc, sc);
  ctx.globalAlpha = Math.min(1, alpha);
  paintPart(ctx,s,img);
  ctx.restore();
}

function glow(ctx, img, x, y, alpha) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
}

export function draw(ctx, world) {
  const b = world.boss;
  if (!b || !b.active) return;
  const S = getSprites();
  const P = b.pose;
  const gone = b.deathDone || b.mode === 'wait' || (b.mode === 'death' && b.deathT >= 177);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (!gone && P) {
    _ctx = ctx; _b = b;
    _flush = b.phase >= 3 || b.mode === 'death' ? b.flush * (0.6 + 0.22 * Math.sin(b.t * 0.12)) : b.mode === 'enrage' ? b.flush * 0.7 : 0;
    _shadow = b.shadow;
    const A = b.armor;
    for (const k of ['hf', 'ff']) {
      const L = P.legs[k];
      part(S.upper, L.hip, 0, 0, 'leg', { far: true });
      part(S.lower, L.knee, 0, 0, 'leg', { far: true });
    }
    drawGills(S, b, P, false);
    BLADES.forEach((d, i) => part(S[d.s], P.blades[i], 0, 0, null, { far: i === 0 || i === 4 }));
    for (let i = TAIL.n - 1; i >= 0; i--) part(S.tail[i], P.tail[i], 0, 0, 'tail');
    part(S.torso, P.root, 0, 0, 'torso');
    for (let i = 4; i >= 0; i--) { const k = 'band' + i; if (A[k]) part(S.armor[k], P.root, S.armor[k].ox, S.armor[k].oy, k); }
    part(S.core, P.port, 0, 0, 'core');
    for (const k of ['hn', 'fn']) {
      const L = P.legs[k];
      part(S.upper, L.hip, 0, 0, 'leg');
      part(S.lower, L.knee, 0, 0, 'leg');
    }
    if (b.jaw > 0.05) part(S.maw, P.head, 0, 0, null);
    part(S.jaw, P.jaw, 0, 0, 'jaw');
    if (A.chin) part(S.armor.chin, P.jaw, S.armor.chin.ox, S.armor.chin.oy, 'chin');
    part(S.head, P.head, 0, 0, 'head');
    if (A.helmet) part(S.armor.helmet, P.head, S.armor.helmet.ox, S.armor.helmet.oy, 'helmet');
    part(S.eye, P.eye, 0, 0, null);
    drawGills(S, b, P, true);

    // additive lights
    ctx.globalCompositeOperation = 'lighter';
    const dim = (1 - b.eyeDim) * (1 - b.shadow * 0.5);
    glow(ctx, S.eyeGlow, P.eye.x, P.eye.y, dim * (0.75 + 0.25 * Math.sin(b.t * 0.21)) * (b.phase >= 3 ? 1.3 : 1));
    if (b.eyeFlare) glow(ctx, S.bigGlow, P.eye.x, P.eye.y, 0.8);
    // FINAL FORM: exposed white-hot core + burning gill fronds
    if (b.flame > 0.01) {
      glow(ctx, S.coreGlow, P.port.x, P.port.y, b.flame * (0.7 + 0.3 * Math.sin(b.t * 0.25)));
      b.gills.forEach((g, i) => {
        if (g.state !== 'alive') return;
        const q = P.gills[i];
        glow(ctx, S.flameGlow, q.tip.x, q.tip.y, b.flame * (0.5 + 0.4 * Math.sin(b.t * 0.7 + i * 1.7)));
        glow(ctx, S.flameGlow, q.mid.x, q.mid.y, b.flame * (0.3 + 0.3 * Math.sin(b.t * 0.9 + i)));
      });
    }
    const pulse = 0.45 + 0.35 * Math.sin(b.t * 0.09);
    // hittable weak points pulse with a soft rim (gills, throat, core, open mouth)
    if (b.mode === 'fight' || b.mode === 'stun') {
      const wp = 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(b.t * 0.16));
      b.gills.forEach((g, i) => {
        if (g.state !== 'alive') return;
        const q = P.gills[i];
        const a = wp * (GILLS[i].near ? 1 : 0.6);
        tint(ctx, S.gillA, q.base, q.sc, a * 0.45);
        tint(ctx, S.gillB, q.mid, q.sc, a * 0.45);
      });
      edge(ctx, S.core, P.port, 1, wp * 1.2);
      glow(ctx, S.tipGlow, P.throat.x, P.throat.y, wp * 1.4);
      if (b.jaw > 0.4) glow(ctx, S.mawGlow, P.mouth.x + 18, P.mouth.y, wp);
    }
    glow(ctx, S.redLight, P.port.x, P.port.y, dim * (0.5 + 0.5 * pulse + b.portGlow));
    glow(ctx, S.redLight, P.jaw.x + 2, P.jaw.y + 2, dim * pulse);
    for (const k of ['fn', 'hn']) glow(ctx, S.redLight, P.legs[k].knee.x, P.legs[k].knee.y, dim * pulse * 0.8);
    if (b.snipeTell >= 0 && b.gills[b.snipeTell] && b.gills[b.snipeTell].state === 'alive') glow(ctx, S.tellGlow, P.gills[b.snipeTell].tip.x, P.gills[b.snipeTell].tip.y, 1);
    if (b.atk && b.atk.name === 'gillBurst' && b.atk.tell > 0) {
      b.gills.forEach((g, i) => { if (g.state === 'alive') glow(ctx, S.tellGlow, P.gills[i].tip.x, P.gills[i].tip.y, b.atk.tell * 1.2); });
    }
    if (b.gillFlare > 0.05) {
      b.gills.forEach((g, i) => {
        if (g.state !== 'alive') return;
        glow(ctx, S.tipGlow, P.gills[i].tip.x, P.gills[i].tip.y, b.gillFlare * (0.6 + 0.4 * Math.sin(b.t * 0.5 + i)));
      });
    }
    if (b.mawGlow > 0.02) {
      const m = P.mouth;
      glow(ctx, S.mawGlow, m.x + 12, m.y, b.mawGlow);
      if (b.mawGlow > 0.6) glow(ctx, S.bigGlow, m.x + 8, m.y, (b.mawGlow - 0.6) * 1.6 * (0.7 + 0.3 * Math.sin(b.t * 0.7)));
    }
    if (b.portGlow > 0.02) glow(ctx, S.bigGlow, P.port.x, P.port.y, b.portGlow * 0.5);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  drawDebris(ctx, b);
  drawEscorts(ctx, world, b, S);
  if (!gone && P) drawLaser(ctx, world, b, S);
  ctx.restore();
}

function drawGills(S, b, P, near) {
  b.gills.forEach((g, i) => {
    if (GILLS[i].near !== near) return;
    const q = P.gills[i];
    const far = !near;
    if (g.state === 'dead' || (g.state === 'regrow' && g.scale < 0.15)) {
      part(S.stump, q.base, 0, 0, null, { far });
      if (g.flash > 0 && (g.flash & 2)) part(S.stump, q.base, 0, 0, null, { far, white: true });
      // regrowth bud swelling at the stump tip (tells the player the race is on)
      const prog = g.state === 'dead' ? (b.mode === 'stun' ? 0 : g.t / DIFFICULTY[b.phase].gillRegrow) : 1;
      if (prog > 0.15) part(S.buds[Math.min(3, Math.floor(prog * 4))], child(q.base, 9, 0), 0, 0, null, { far });
      return;
    }
    const grp = 'gill' + i;
    part(S.gillA, q.base, 0, 0, grp, { far, sc: q.sc, flame: b.flame });
    part(S.gillB, q.mid, 0, 0, grp, { far, sc: q.sc, flame: b.flame });
  });
}

function drawDebris(ctx, b) {
  for (const q of b.debris) {
    const s = q.spr;
    ctx.save();
    ctx.translate(Math.round(q.x), Math.round(q.y));
    ctx.rotate(q.a);
    paintPart(ctx,s,q.far && s.farImg ? s.farImg : s.img);
    ctx.restore();
  }
}
