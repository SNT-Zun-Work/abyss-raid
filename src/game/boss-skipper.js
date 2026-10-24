import { drawSpray } from './boss-skipper-art.js';
import { W, H } from '../config.js';
import { clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import * as fx from './fx.js';
import { sfx, fxCall, hurtPlayer, atkLogInit, atkStarted, atkCompleted, atkCancelled, bagLeft } from './boss-util.js';
import { emit } from './world.js';
import { getMudSprites } from './boss-mudskipper-parts.js';
import { SURFACE_Y, K_DUEL, DUEL_X, DUEL_Y, K_CHASE, CHASE_X, CHASE_Y, SEGS, SEG_DX, EYE_POS, EYE_UP, SAIL_POS,
  PLATES, PLATE_HP, PLATE_STAGES, METAL_DMG, DIFFICULTY, CAUSES as SK_CAUSES, stats, toWorld } from './boss-skipper-core.js';
import { ATTACKS, STRONG, CANNONS, eyePos, sailTop, segsLeft, outerSeg, segX, eyeRampK, splash, updateSkHazards, skHazards, skLasers, drawSkHazards, hitWall, damageWall } from './boss-skipper-attacks.js';
import { paintedSurface, paintedCell } from './g-painted-fx.js';
import { initFry, updateFry, hitFry, damageFry, fryBodyHit, killAllFry, fryHazards, fryTargets, drawFry, drawChimneys } from './boss-skipper-fry.js';
import { getSkArt, getMudCoat, mudVariant, getCoreArt, drawMound } from './boss-skipper-art.js';

export const ZONE_INFO = { letter: 'G', name: 'PERIOPHTHALMUS', title: 'TIDAL FLAT DESTROYER', area: 'TIDAL FLATS' };
export const CAUSES = SK_CAUSES;
export { DIFFICULTY };
const EYE_HP = DIFFICULTY[1].eyeHp, SAIL_HP = DIFFICULTY[1].sailHp;
// combat v2b: tail segments are broken outermost first (index 5,4 = P2, 3,2 = P3, 1,0 = P4); each phase
// sets its own segment HP (calibrated so every phase completes its first attack rotation, docs/COMBAT.md)
const segPhase = (i) => (i >= SEGS - 2 ? 2 : i >= SEGS - 4 ? 3 : 4);
export const SEG_HPS = Array.from({ length: SEGS }, (_, i) => DIFFICULTY[segPhase(i)].segHp ?? DIFFICULTY[2].segHp);
const MOUND_F = 150; // fx.burrowMound life; it bursts at 85%
const ESC = { dig: 56, swap: 90, burst: Math.round(MOUND_F * 0.85) + 2, up: 150, end: 160 }; // burrow → burst-out timeline (frames)
const MOUND_X = 332;

export function init(world) {
  const S = getMudSprites();
  getSkArt();
  if (world.bg) { world.bg.surfaceY = SURFACE_Y; world.bg.chase = 0; world.bg.chaseSpeed = 0; }
  const b = (world.boss = {
    x: DUEL_X, y: SURFACE_Y + 70, k: K_DUEL, f: 1, a: 0, half: 1, phase: 1,
    hp: 0, maxHp: 2 * EYE_HP + SEG_HPS.reduce((s, v) => s + v, 0), active: false, defeated: false, deathDone: false,
    mode: 'wait', modeT: 0, t: 0, deathT: 0, fightT: 0,
    eyes: [0, 1].map(() => ({ hp: EYE_HP, max: EYE_HP, state: 'ok', up: 0, upT: 0, smoke: 0 })),
    panels: [0, 1, 2].map(() => ({ hp: SAIL_HP, max: SAIL_HP, state: 'ok' })),
    segs: SEG_HPS.map((hp) => ({ hp, max: hp, state: 'ok' })),
    sailUp: 0, sailUpT: 0, arm: 0, armT: 0, coil: 0, coilT: 0, jaw: 0, cake: 1, flare: 0, air: false,
    atk: null, atkSeq: 0, gap: 40, lastAtk: null, atkCount: 0, calmT: 0, script: ['eye0', 'eye1', 'slap', 'sail', 'eye0', 'sail'],
    safeHint: null, hazards: [], lasers: [], circles: [], mud: [], splash: [], mwave: null, landing: null,
    flashT: {}, aimY: DUEL_Y - 50, chipN: 0, demo: true, rings: [], mound: 0,
    plates: PLATES.map(([x, y, r], i) => ({ id: i, x, y, r, hp: PLATE_HP, max: PLATE_HP, state: 'ok', stage: 0, glint: 0 })), plateW: [],
    walls: [], wallPrev: null, cannon: null, cannonCd: 0, slabs: [], steam: [], p4k: 0, volN: 0, eyeK: 0, shedQ: null,
  });
  b.armor = b.plates; b.mudPlates = b.plates; // HUD aliases (MUD tracker)
  getMudCoat(S, PLATES); getCoreArt();
  for (const s of [S.tailA, S.tailB, S.upper, S.lower, S.jaw, ...S.sails]) mudVariant(s, 3);
  b.sails = b.panels; b.tail = b.segs;
  initFry(b);
  atkLogInit(b);
  recomputeHp(b);
  computeCircles(b);
}

// combat v2b first rotation per phase: every attack of the phase must COMPLETE once (the duel's
// scripted opener already covers P1; mixed sub-patterns are variants and do not count)
export const BAGS = { 1: ['eye', 'slap', 'sail'], 2: ['skip', 'volley', 'cannon'], 3: ['skip', 'volley', 'cannon'], 4: ['bigskip', 'volley', 'gigaCannon'] };
const firstShowing = (b, atk) => !!atk && bagLeft(b, atk.ph, BAGS[atk.ph] || []).includes(atk.name);

function recomputeHp(b) {
  b.hp = b.eyes.reduce((s, e) => s + Math.max(0, e.hp), 0) + b.segs.reduce((s, q) => s + Math.max(0, q.hp), 0);
}

export function debugSetHpFrac(world, f) {
  const b = world.boss;
  let cut = b.maxHp * (1 - f);
  for (const e of b.eyes) { const d = Math.min(e.hp, cut); e.hp -= d; cut -= d; if (e.hp <= 0) { e.hp = 0; e.state = 'broken'; } }
  for (let i = SEGS - 1; i >= 0; i--) { const s = b.segs[i], d = Math.min(s.hp, cut); s.hp -= d; cut -= d; if (s.hp <= 0) { s.hp = 0; s.state = 'broken'; } }
  recomputeHp(b);
  // the mud is peeled roughly in proportion to the fight progress (head first)
  const peel = Math.round(b.plates.length * Math.min(1, (1 - f) * 1.4));
  for (let i = 0; i < peel; i++) { b.plates[i].hp = 0; b.plates[i].state = 'broken'; }
  b.mode = 'fight'; b.modeT = 0; b.gap = 30;
  if (b.eyes.every((e) => e.state === 'broken')) {
    enterChase(world, b);
    const left = segsLeft(b);
    b.phase = left <= 2 ? 4 : left <= 4 ? 3 : 2;
    b.demo = b.phase === 2; // a chase that starts at P2 still opens with the safe demo lap
    if (b.phase === 4 && b.hp > 0) startTransform(world, b, true);
  } else { b.x = DUEL_X; b.y = DUEL_Y; }
  if (b.hp <= 0) startDeath(world);
  computeCircles(b);
}

// ---- hit circles -------------------------------------------------------------------
const litEye = (e) => e.state === 'ok' && e.up > 0.6;
const segLit = (b) => b.coil > 0.5 && b.atk && !b.air && (b.atk.name === 'skip' || b.atk.name === 'bigskip');
function computeCircles(b) {
  const cs = [];
  const add = (lx, ly, r, kind, mult, group, id) => { const p = toWorld(b, lx, ly); cs.push({ x: p.x, y: p.y, r: r * b.k, kind, mult, group, id }); };
  // lit parts first (they sit in front of / above the hull from the player's side)
  b.eyes.forEach((e, i) => { if (litEye(e)) { const [x, y] = EYE_POS[i]; add(x - 2, y - 2 - EYE_UP[i] * e.up, 8, 'eye', 1, 'eye' + i, i); } });
  if (b.sailUp > 0.7) b.panels.forEach((q, i) => { if (q.state === 'ok') { const [x, y] = SAIL_POS[i]; add(x + 12, y - 24, 13, 'sail', 1, 'sail' + i, i); } });
  if (b.half === 2) {
    const o = outerSeg(b);
    for (let i = 0; i <= o; i++) {
      const lit = i === o && segLit(b);
      add(segX(b, i), 4, lit ? 12 : 10, lit ? 'seg' : 'tail', 1, lit ? 'seg' : 'tail', i);
    }
  }
  b.plateW = b.plates.map((q) => { const p = toWorld(b, q.x, q.y); return { x: p.x, y: p.y, r: q.r * b.k * 0.9, state: q.state }; });
  b.plates.forEach((q, i) => { if (q.state !== 'broken') add(q.x, q.y, q.r * 0.95, 'plate', 1, 'plate' + i, i); });
  add(-62, 2, 16, 'head', 1, 'head');
  add(-36, -6, 22, 'head', 1, 'head');
  add(4, 0, 28, 'body', 1, 'torso');
  add(36, 0, 22, 'body', 1, 'torso');
  if (b.half === 1) add(66, 2, 13, 'body', 1, 'tail');
  b.circles = cs;
}

function hittable(b) {
  return b.active && !b.defeated && b.mode === 'fight';
}

export function hitTest(world, x, y, r) {
  const b = world.boss;
  if (!b || !b.active) return null;
  const h = hitFry(world, x, y, r) || hitWall(world, x, y, r);
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
  const f = fryBodyHit(world, x, y, r);
  if (f) return { kind: 'escort', cause: 'skFry', x: f.x, y: f.y };
  if (!hittable(b)) return null;
  for (const c of b.circles) {
    if (c.kind === 'eye' || c.kind === 'sail' || c.kind === 'plate') continue;
    const rr = c.r * 0.78 + r;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr * rr) return { kind: 'body', cause: b.air ? 'skSkip' : 'skBody', x: c.x, y: c.y };
  }
  return null;
}
export function bodyHit(world, x, y, r) { return !!contactAt(world, x, y, r); }

export function targets(world) {
  const b = world.boss;
  if (!b || !b.active || b.defeated) return [];
  const out = [];
  fryTargets(b, out);
  for (const c of b.circles) if (c.kind === 'eye' || c.kind === 'sail' || c.kind === 'seg') out.push({ x: c.x, y: c.y, kind: 'weak', part: c.kind });
  return out;
}

// ---- damage ------------------------------------------------------------------------------
export function applyDamage(world, hit, dmg) {
  const b = world.boss;
  if (!hit || !b) return;
  if (hit.kind === 'escort' || hit.kind === 'chimney') { damageFry(world, hit, dmg); return; }
  if (hit.kind === 'clod') { damageWall(world, hit, dmg); return; }
  if (!hittable(b)) return;
  const d = DIFFICULTY[b.phase];
  const v = dmg * (hit.mult ?? 1) * d.dmgTaken;
  if (hit.kind === 'eye' || hit.kind === 'sail' || hit.kind === 'seg') {
    b.flashT[hit.group] = 3;
    world.score += Math.round(10 * v);
    if (b.t - (b.weakEmitT || -99) >= 6) { b.weakEmitT = b.t; emit(world, { type: 'weakHit', x: hit.x, y: hit.y, part: hit.kind === 'seg' ? 'tail' : hit.kind }); }
    if ((b.t & 3) === 0) fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.7, 0.7));
    if (hit.kind === 'eye') hurtPart(world, b, b.eyes[hit.id], 'eye', hit.id, v);
    if (hit.kind === 'sail') hurtPart(world, b, b.panels[hit.id], 'sail', hit.id, v);
    if (hit.kind === 'seg') hurtPart(world, b, b.segs[hit.id], 'tail', hit.id, v);
    recomputeHp(b);
    return;
  }
  // MUD ARMOR plate: every hit flashes + flecks the crust, cracks grow (4 stages), then the plate
  // breaks off as a falling slab and the metal underneath glints
  if (hit.kind === 'plate') {
    const q = b.plates[hit.id];
    if (!q || q.state === 'broken') return;
    q.hp -= v; b.flashT['plate' + hit.id] = 3; world.score += 2;
    b.chipN++;
    if (b.chipN & 1) fxCall('debris', world, hit.x + 1, hit.y, world.fxRng.range(0.3, 1.8), -world.fxRng.range(0.2, 1.6), (b.chipN & 2) ? '#6c5438' : '#a08460');
    if ((b.chipN & 3) === 0) fxCall('mudChunk', world, hit.x + 2, hit.y, world.fxRng.range(0.2, 1.4), -world.fxRng.range(0.6, 1.8));
    sfx('mudChip');
    const fr = q.hp / q.max, st = fr < PLATE_STAGES[2] ? 3 : fr < PLATE_STAGES[1] ? 2 : fr < PLATE_STAGES[0] ? 1 : 0;
    if (st > q.stage) {
      q.stage = st; sfx('mudCrack');
      for (let k = 0; k < 2 + st; k++) fxCall('mudChunk', world, hit.x, hit.y, world.fxRng.range(-0.5, 1.6), -world.fxRng.range(0.6, 2));
    }
    if (q.hp > 0) return;
    breakPlate(world, b, q, false);
    return;
  }
  // hull: peeled metal passes part of the damage to the current target part (eye / outer tail
  // segment) — peeling the armor is visible progress; the mud-free rest of the hull just clinks
  world.score += 1;
  const bare = b.plateW.some((w) => w.state === 'broken' && (hit.x - w.x) ** 2 + (hit.y - w.y) ** 2 < (w.r + 3) ** 2);
  if (bare) {
    let tp = null, kind = 'eye', id = -1;
    if (b.half === 1) { b.eyes.forEach((e, i) => { if (e.state === 'ok' && (!tp || e.hp < tp.hp)) { tp = e; id = i; } }); }
    else { id = outerSeg(b); tp = id >= 0 ? b.segs[id] : null; kind = 'tail'; }
    if (tp) { hurtPart(world, b, tp, kind, id, v * METAL_DMG); recomputeHp(b); b.flashT.torso = 2; }
    if ((++b.chipN & 3) === 0) fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.6, 0.6));
  } else if ((++b.chipN & 7) === 0) fxCall('spark', world, hit.x - 2, hit.y, Math.PI + world.fxRng.range(-0.6, 0.6));
}

// a mud plate cracks off: the slab itself falls (tumbling, splats on the flat / water), a chunk
// shower + burst, thud + metal 'ting', a light shake, and the bare metal underneath glints
function breakPlate(world, b, q, quiet) {
  q.hp = 0; q.state = 'broken'; q.glint = 40;
  const w = toWorld(b, q.x, q.y);
  b.slabs.push({ id: q.id, x: w.x, y: w.y, vx: world.fxRng.range(0.2, 1.4) * (quiet ? world.fxRng.range(-1.6, 1.6) : 1), vy: -world.fxRng.range(0.6, 1.6),
    a: b.a, va: world.fxRng.range(-0.08, 0.08), k: b.k, f: b.f, t: 0 });
  if (b.slabs.length > 24) b.slabs.shift();
  for (let k = 0; k < (quiet ? 3 : 7); k++) fxCall('mudChunk', world, w.x + world.fxRng.range(-6, 6), w.y + world.fxRng.range(-5, 5), world.fxRng.range(-1.6, 1.6), -world.fxRng.range(0.8, 2.6));
  fxCall('mudBurst', world, w.x, w.y);
  for (let k = 0; k < 3; k++) fxCall('spark', world, w.x + world.fxRng.range(-4, 4), w.y + world.fxRng.range(-4, 4), world.fxRng.range(0, Math.PI * 2));
  sfx('mudBreak');
  if (!quiet) { fxCall('addShake', world, 2.5); world.hitstop = Math.max(world.hitstop, 3); world.score += 1500; fxCall('scorePopup', world, w.x, w.y - 8, 1500); }
  emit(world, { type: 'gillKill', x: w.x, y: w.y, part: 'mud', left: b.plates.filter((z) => z.state !== 'broken').length, total: b.plates.length });
}

function partPos(b, kind, i) {
  if (kind === 'eye') return eyePos(b, i);
  if (kind === 'sail') return sailTop(b, i);
  return toWorld(b, segX(b, i), 4);
}

function hurtPart(world, b, p, kind, i, v) {
  if (p.state === 'broken') return;
  p.hp -= v;
  if (p.hp > 0) return;
  p.hp = 0; p.state = 'broken';
  const pos = partPos(b, kind, i);
  const big = kind !== 'sail';
  fxCall('explode', world, pos.x, pos.y, big ? 'large' : 'medium', { debris: ['#5a4430', '#8a96a8', '#ff7a30'] });
  fxCall('mudBurst', world, pos.x, pos.y);
  fxCall('mudChunk', world, pos.x, pos.y, -1.2, -2.2);
  for (let k = 0; k < 6; k++) fxCall('debris', world, pos.x, pos.y, world.fxRng.range(-2, 1), -world.fxRng.range(1, 3), k & 1 ? '#5a4430' : '#8a96a8');
  sfx(big ? 'explodeL' : 'explodeS');
  world.hitstop = Math.max(world.hitstop, big ? 8 : 4);
  fxCall('addShake', world, big ? 5 : 3);
  const pts = kind === 'sail' ? 3000 : 8000;
  world.score += pts; fxCall('scorePopup', world, pos.x, pos.y - 8, pts);
  stats(world).stuns++; // parts broken (HUD/stats compat)
  const list = kind === 'eye' ? b.eyes : kind === 'sail' ? b.panels : b.segs;
  const left = list.filter((q) => q.state !== 'broken').length;
  emit(world, { type: 'gillKill', x: pos.x, y: pos.y, part: kind, left, total: list.length });
  if (kind === 'eye') {
    b.eyes[i].upT = 0; b.eyes[i].smoke = 1;
    if (left === 0) startEscape(world, b);
  }
  if (kind === 'tail') {
    if (left === 0) { startDeath(world); return; }
    // breaking the lit segment during a cannon charge → the pressure is lost (no beam) — except on the
    // cannon's FIRST showing in this phase (combat v2b: every attack is seen once)
    if (b.atk && CANNONS.has(b.atk.name) && b.atk.phase === 'charge' && !firstShowing(b, b.atk)) b.atk.broken = true;
    const to = left <= 2 ? 4 : left <= 4 ? 3 : 2;
    // the FINAL FORM transformation would cut the running attack: a first showing finishes first
    if (to > b.phase && to === 4 && firstShowing(b, b.atk)) b.pendingPhase = Math.max(b.pendingPhase || 0, to);
    else if (to > b.phase) toPhase(world, b, to);
  }
}

function toPhase(world, b, to) {
  const from = b.phase;
  b.phase = to;
  emit(world, { type: 'phaseChange', from, to });
  if (to === 4) startTransform(world, b, false);
  else { world.flash = Math.max(world.flash, 0.3); b.calmT = 30; }
}

// ---- FINAL FORM transformation beat (~2.5 s, invulnerable, no hazards) ------------------------------
const TRANSFORM_F = 150;
function startTransform(world, b, debug) {
  if (b.atk) endAttack(b);
  clearField(world, b);
  b.mode = 'transform'; b.modeT = 0; b.flare = 1; b.air = false; b.landing = null;
  b.shedQ = b.plates.filter((q) => q.state !== 'broken').map((q) => q.id);
  if (!debug) {
    world.hitstop = Math.max(world.hitstop, 14); world.flash = Math.max(world.flash, 0.9);
    fxCall('screenRumble', world, TRANSFORM_F, 3); sfx('bossRoar'); sfx('rumble');
  }
}
function updateTransform(world, b) {
  const t = b.modeT;
  b.jawT = 1.15; b.coilT = 0.6;
  if (t < 70) { b.y += (CHASE_Y - 16 - b.y) * 0.08; b.a += (-0.14 - b.a) * 0.08; b.x += (CHASE_X + 10 - b.x) * 0.05; }
  // the remaining mud blasts off plate by plate
  if (b.shedQ && b.shedQ.length && t % 3 === 0 && t > 6) breakPlate(world, b, b.plates[b.shedQ.shift()], true);
  if (t === 20 || t === 44) sfx('bossRoar');
  if (t === 60) {
    // the core ignites
    const c = toWorld(b, 6, -2);
    world.flash = Math.max(world.flash, 1); world.hitstop = Math.max(world.hitstop, 6);
    fxCall('explode', world, c.x, c.y, 'large', { debris: ['#5a4430', '#8a96a8', '#ff7a30'] });
    fxCall('addShake', world, 8); sfx('explodeL');
  }
  if (t >= 60) b.p4k = Math.min(1, b.p4k + 1 / 30);
  if (t > 60 && t < 110 && t % 5 === 0) { const p = toWorld(b, world.fxRng.range(-60, 60), world.fxRng.range(-26, 10)); fxCall('explode', world, p.x, p.y, 'small', { debris: ['#5a4430', '#ff7a30'] }); }
  if (t >= 70 && t < 110) { b.y += (CHASE_Y + 2 - b.y) * 0.2; b.a += (0.04 - b.a) * 0.2; }
  if (t === 104) {
    // slams back down onto the water
    splash(b, world, b.x - 10, 70, 7, true); fxCall('mudColumn', world, b.x - 20, SURFACE_Y);
    fxCall('addShake', world, 9); sfx('explodeL'); world.flash = Math.max(world.flash, 0.5);
  }
  if (t >= 110) { b.y += (CHASE_Y - b.y) * 0.1; b.a *= 0.85; }
  if (t >= TRANSFORM_F) {
    b.mode = 'fight'; b.modeT = 0; b.gap = 16; b.calmT = 30; b.p4k = 1; b.coilT = 0; b.a = 0; b.shedQ = null;
    b.lastAtk = 'volley'; b.volN = 1; // opens with a slam skip, then the GIGA cannon
  }
}

// ---- escape (transition) ------------------------------------------------------------------
function startEscape(world, b) {
  if (b.atk) endAttack(b);
  b.mode = 'escape'; b.modeT = 0;
  for (const e of b.eyes) e.upT = 0;
  b.sailUpT = 0; b.armT = 0;
  clearField(world, b);
  killAllFry(world, b);
  world.hitstop = Math.max(world.hitstop, 10);
  emit(world, { type: 'escape', x: b.x, y: b.y });
  sfx('bossRoar'); fxCall('screenRumble', world, 60, 3);
}

function enterChase(world, b) {
  b.half = 2; b.f = -1; b.k = K_CHASE; b.x = CHASE_X; b.y = CHASE_Y; b.a = 0;
  b.sailUp = 0; b.sailUpT = 0; b.chimneysGone = true;
  for (const e of b.eyes) { e.up = 0; e.upT = 0; }
  if (world.bg) { world.bg.chase = Math.max(world.bg.chase || 0, 0.01); world.bg.chaseSpeed = 6; }
}

function clearField(world, b) {
  bullets.clearAll(world, true);
  b.mud.length = 0; b.mwave = null; b.landing = null; b.safeHint = null; b.rings.length = 0;
  b.walls.length = 0; b.wallPrev = null; b.cannon = null;
}

function endAttack(b, done = false) {
  if (b.atk && !done) atkCancelled(b, b.atk.ph, b.atk.name);
  b.atk = null; b.landing = null; b.safeHint = null; b.coilT = 0; b.air = false; b.slam = false;
  b.wallPrev = null; b.cannon = null;
  if (b.half === 1) { b.sailUpT = 0; b.armT = 0; for (const e of b.eyes) e.upT = 0; }
}

function startDeath(world) {
  const b = world.boss;
  if (b.defeated) return;
  b.hp = 0; b.defeated = true; b.mode = 'death'; b.modeT = 0; b.deathT = 0;
  if (b.atk) endAttack(b);
  clearField(world, b);
  killAllFry(world, b);
  world.hitstop = Math.max(world.hitstop, 30);
  world.flash = Math.max(world.flash, 0.8);
  fxCall('addShake', world, 9);
  sfx('explodeL');
}

// ---- update ---------------------------------------------------------------------------------
export function update(world) {
  const b = world.boss;
  if (!b.active) return;
  b.t++; b.modeT++;
  for (const k in b.flashT) if (b.flashT[k] > 0) b.flashT[k]--;
  if (b.calmT > 0 && b.mode === 'fight') b.calmT--;
  { const pl = world.player; if (pl) { const px = b.pv ? b.pv.px : pl.x, py = b.pv ? b.pv.py : pl.y; b.pv = { x: (b.pv ? b.pv.x * 0.7 : 0) + (pl.x - px) * 0.3, y: (b.pv ? b.pv.y * 0.7 : 0) + (pl.y - py) * 0.3, px: pl.x, py: pl.y }; } }
  const d = DIFFICULTY[b.phase];

  switch (b.mode) {
    case 'wait':
      b.mode = 'entry'; b.modeT = 0;
      break;
    case 'entry': {
      // heaves itself out of the mud on the right; eyes pop up once to look around
      const u = clamp((b.modeT - 10) / 100, 0, 1);
      b.y = SURFACE_Y + 70 + (DUEL_Y - SURFACE_Y - 70) * (1 - (1 - u) ** 3);
      if (b.modeT === 12) { splash(b, world, b.x - 30, 60, 5, true); sfx('bossRoar'); fxCall('addShake', world, 5); fxCall('mudColumn', world, b.x - 20, SURFACE_Y); }
      if (b.modeT % 6 === 0 && u < 1) splash(b, world, b.x - 50 + world.fxRng.range(-40, 60), 6, 3, true);
      for (const e of b.eyes) e.upT = b.modeT > 118 && b.modeT < 150 ? 1 : 0;
      b.jawT = b.modeT > 120 && b.modeT < 150 ? 1 : 0;
      if (b.modeT >= 170) { b.mode = 'fight'; b.modeT = 0; b.gap = 24; b.calmT = 30; }
      break;
    }
    case 'fight':
      b.fightT++;
      if (!b.atk) {
        idle(world, b);
        if (--b.gap <= 0) pickAttack(world, b);
      } else {
        const done = ATTACKS[b.atk.name](world, b, b.atk);
        // mixed attacks (after the teaching phase): a second pattern runs inside the first
        const sub = b.atk && b.atk.sub;
        if (sub && b.atk.t >= sub.at && !sub.done) { sub.done = ATTACKS[sub.name](world, b, sub) === true; sub.t++; }
        if (b.atk) b.atk.t++;
        if (done === true && (!sub || sub.done) && b.atk) {
          if (b.atk.broken) atkCancelled(b, b.atk.ph, b.atk.name); // fizzled cannon: not a showing
          else atkCompleted(b, b.atk.ph, b.atk.name, BAGS[b.atk.ph]);
          endAttack(b, true); b.gap = d.gap;
          if (b.pendingPhase > b.phase) { const to = b.pendingPhase; b.pendingPhase = 0; toPhase(world, b, to); }
        }
      }
      break;
    case 'escape':
      updateEscape(world, b);
      break;
    case 'transform':
      updateTransform(world, b);
      break;
    case 'death':
      updateDeath(world, b);
      break;
  }

  b.eyes.forEach((e) => { e.up += (e.upT - e.up) * 0.22; if (e.smoke > 0 && b.half === 1) e.smoke = 1; });
  b.sailUp += ((b.flare ? 1 : b.sailUpT) - b.sailUp) * 0.14;
  b.arm += (b.armT - b.arm) * 0.2;
  b.coil += (b.coilT - b.coil) * 0.12;
  b.jaw += ((b.jawT || 0) - b.jaw) * 0.15;
  computeCircles(b);
  b.eyes.forEach((e) => { e.lit = litEye(e); });
  b.panels.forEach((q) => { q.lit = q.state === 'ok' && b.sailUp > 0.7; });
  { const o = outerSeg(b); b.segs.forEach((q, i) => { q.lit = b.circles.some((c) => c.kind === 'seg' && c.id === i) && i === o; }); }
  if (b.mode === 'escape') { bullets.clearAll(world, false); b.mud.length = 0; }
  updateSkHazards(world, b);
  const strong = b.atk && STRONG.has(b.atk.name);
  updateFry(world, b, b.mode === 'fight' && !strong && b.calmT <= 0);
  updateSplash(b);
  updateCosmetics(world, b);
  aimFor(b);

  b.hazards.length = 0;
  skHazards(b, b.hazards);
  fryHazards(b, b.hazards);
  b.lasers.length = 0;
  skLasers(b, b.lasers);

  if (b.mode === 'fight') {
    const hb = player.playerHitbox(world);
    const c = hb && contactAt(world, hb.x, hb.y, hb.r);
    if (c) hurtPlayer(world, { ...c, atk: b.atk ? b.atk.id : 0 });
  }
  if (world.bg && !b.defeated) {
    // final form: red storm tint; cannon charge: the scene darkens around the striped band
    const C = b.cannon, dk = C ? (C.state === 'fire' ? 0.3 : C.state === 'fade' ? 0.3 * C.k : 0.32 * Math.min(1, C.k * 1.3)) : 0;
    world.bg.darken = dk;
    world.bg.tint = b.p4k > 0 ? { r: 150, g: 10, b: 20, a: (0.1 + 0.05 * Math.sin(b.t * 0.08)) * b.p4k } : null;
  }
  if (world.bg && b.half === 2 && !b.defeated) {
    world.bg.chase = Math.min(1, (world.bg.chase || 0) + 1 / 60);
    world.bg.chaseSpeed = b.phase >= 4 ? 7 : 6;
    // thin the underwater tint while submerged threats are on screen (rings, sinking clods, rakes, swimming fry)
    const sub = b.rings.length || b.walls.length || b.fry.some((f) => f.swim) || b.mud.some((q) => q.y > SURFACE_Y + 4);
    const ut = world.bg.underTint == null ? 1 : world.bg.underTint;
    world.bg.underTint = ut + ((sub ? 0.35 : 1) - ut) * 0.08;
  }
}

// bot/HUD aim height: the lit part, else where the next window will open
function aimFor(b) {
  if (b.half === 1) {
    const i = b.eyes.findIndex(litEye);
    if (i >= 0) { b.aimY = eyePos(b, i).y; return; }
    if (b.sailUp > 0.7 && b.panels.some((q) => q.state === 'ok')) { b.aimY = sailTop(b, 1).y + 10; return; }
    const j = b.eyes.findIndex((e) => e.state === 'ok');
    b.aimY = j >= 0 ? toWorld(b, EYE_POS[j][0], EYE_POS[j][1] - EYE_UP[j]).y : b.y;
  } else b.aimY = toWorld(b, segX(b, Math.max(0, outerSeg(b))), 4).y;
}

function idle(world, b) {
  if (b.half === 1) {
    b.y += (DUEL_Y + Math.sin(b.t * 0.05) * 1.5 - b.y) * 0.08;
    b.a = Math.sin(b.t * 0.04) * 0.02;
  } else {
    b.y += (CHASE_Y + Math.sin(b.t * 0.12) * 2 - b.y) * 0.12;
    b.x += (CHASE_X - b.x) * 0.05;
    b.a = Math.sin(b.t * 0.1) * 0.03;
    if ((b.t & 7) === 0) splash(b, world, b.x - 10 + world.fxRng.range(-40, 40), 3, 2);
  }
  if (b.p4k > 0) b.jawT = 0.75; // final form: the maw hangs open, glowing
}

function pickAttack(world, b) {
  if (b.calmT > 0) { b.gap = b.calmT; return; }
  let name, extra = {}, fromScript = false;
  if (b.half === 1) {
    const alive = [0, 1].filter((i) => b.eyes[i].state === 'ok');
    fromScript = b.script.length > 0;
    let s = fromScript ? b.script[0] : null;
    if (!s) {
      const pool = ['eye', 'eye', 'sail', 'slap'].filter((n) => n === 'eye' || n !== b.lastAtk);
      s = world.rng.pick(pool);
    }
    const k = eyeRampK(b);
    if (s.startsWith('eye')) {
      name = 'eye';
      let i = s === 'eye0' ? 0 : s === 'eye1' ? 1 : (b.lastEye === 0 ? 1 : 0);
      if (b.eyes[i].state !== 'ok') i = alive[0];
      extra.eye = i; b.lastEye = i;
      if (s === 'eye' && alive.length === 2 && k > 0.35 && world.rng.next() < 1.4 * (k - 0.3)) { extra.both = true; extra.dualN = b.dualN = (b.dualN || 0) + 1; }
      else if (!fromScript && k > 0.3 && world.rng.next() < 0.6 * (k - 0.3)) extra.sub = { name: 'slap', t: 0, at: 30 };
    } else if (s === 'sail' && !fromScript && alive.length && k > 0.3 && world.rng.next() < 0.6 * (k - 0.3)) {
      name = s; extra.sub = { name: 'eye', eye: alive[0], t: 0, at: 10 };
    } else name = s;
  } else {
    // chase rotation: skip ↔ (wall | HYDRO CANNON every few walls); P4 = slam skips + GIGA cannon
    const d = DIFFICULTY[b.phase], P4 = b.phase >= 4, skipName = P4 ? 'bigskip' : 'skip';
    const afterSkip = b.lastAtk === 'skip' || b.lastAtk === 'bigskip';
    // combat v2b first rotation: the slot after each skip draws the phase's not-yet-completed attacks
    // (P4 keeps its scripted GIGA cannon right after the transformation slam)
    const left = bagLeft(b, b.phase, BAGS[b.phase]).filter((n) => n !== skipName);
    let bagPick = null;
    if (afterSkip && left.length) bagPick = P4 && left.includes('gigaCannon') ? 'gigaCannon' : left.length > 1 ? world.rng.pick(left) : left[0];
    const cannonNow = bagPick ? CANNONS.has(bagPick) : afterSkip && b.volN >= (d.cannonEvery || 4) - 2;
    if (b.demo) { name = skipName; extra.demo = true; b.demo = false; }
    else if (afterSkip && cannonNow) {
      if (b.walls.length || world.eShots.length + b.mud.length >= 12) { b.gap = 12; return; } // let the last wall pass before the beam
      name = P4 ? 'gigaCannon' : 'cannon'; b.volN = 0;
    } else if (afterSkip) { name = 'volley'; b.volN++; }
    else {
      name = skipName;
      // (P4 slam skips come alone: the slam + surge is the threat)
      if (!P4) extra.sub = { name: 'volley', isSub: true, kind: b.phase >= 3 && b.atkCount % 4 === 1 ? 'drift' : 'gate', t: 0, at: 24 };
    }
  }
  if (STRONG.has(name) && world.eShots.length + b.mud.length >= 12) { b.gap = 20; return; }
  if (fromScript) b.script.shift();
  b.atkSeq++;
  b.atk = { name, t: 0, id: b.atkSeq, ph: b.phase, ...extra };
  if (b.atk.sub) b.atk.sub.id = b.atkSeq;
  atkStarted(b, b.phase, name);
  b.lastAtk = name;
  b.atkCount++;
  const cause = { eye: 'skEye', sail: 'skSail', slap: 'skWave', skip: 'skSkip', bigskip: 'skSlam', volley: 'skVolley', cannon: 'skCannon', gigaCannon: 'skCannon' }[name] || name;
  emit(world, { type: 'attackStart', cause, name, big: name === 'bigskip' || name === 'sail' || CANNONS.has(name), atk: b.atkSeq });
}

function updateEscape(world, b) {
  const t = b.modeT;
  b.mound = t < 20 ? t / 20 : t < ESC.up ? 1 : Math.max(0, 1 - (t - ESC.up) / (ESC.end - ESC.up));
  if (t === 2) {
    if (typeof fx.burrowMound === 'function') fx.burrowMound(world, MOUND_X, H - 34, MOUND_F);
    else fxCall('mudColumn', world, b.x - 30, SURFACE_Y);
    fxCall('addShake', world, 6); sfx('explodeL');
  }
  if (t < ESC.dig) {
    // digs in nose-first: sinks into the flat behind the mound, mud thrown up around it
    b.y += 1.7; b.x += 0.6; b.a += (-0.2 - b.a) * 0.08;
    if (t % 3 === 0) splash(b, world, MOUND_X - 50 + world.fxRng.range(-40, 70), 8, 4.5, true);
    if (t % 6 === 0) fxCall('mudChunk', world, MOUND_X + world.fxRng.range(-50, 50), SURFACE_Y - 6, world.fxRng.range(-1.4, 1.4), -world.fxRng.range(1.5, 3));
  }
  if (t === ESC.swap) { enterChase(world, b); b.y = CHASE_Y + 92; b.a = 0.25; }
  if (t === ESC.burst) {
    fxCall('mudColumn', world, b.x - 10, SURFACE_Y); fxCall('addShake', world, 7); sfx('explodeL');
    for (let k = 0; k < 10; k++) fxCall('mudChunk', world, b.x + world.fxRng.range(-50, 40), SURFACE_Y - 8, world.fxRng.range(-2, 2), -world.fxRng.range(2, 4));
    splash(b, world, b.x - 20, 50, 6, true);
  }
  if (t > ESC.burst && t <= ESC.up) {
    const u = (t - ESC.burst) / (ESC.up - ESC.burst);
    b.y = CHASE_Y + 92 * (1 - u) * (1 - u) - Math.sin(u * Math.PI) * 18; b.a = 0.25 * (1 - u);
  }
  if (t >= ESC.end) {
    b.mode = 'fight'; b.modeT = 0; b.gap = 40; b.calmT = 60; b.y = CHASE_Y; b.a = 0; b.mound = 0;
    const from = b.phase; b.phase = 2;
    emit(world, { type: 'phaseChange', from, to: 2 });
  }
}

function updateDeath(world, b) {
  b.deathT++;
  const t = b.deathT;
  if (t % 9 === 0 && t < 120) {
    const p = toWorld(b, world.fxRng.range(-60, 50), world.fxRng.range(-30, 30));
    fxCall('explode', world, p.x, p.y, t % 27 === 0 ? 'large' : 'medium', { debris: ['#5a4430', '#8a96a8', '#ff7a30'] });
    sfx('explodeS');
  }
  if (t === 100) { fxCall('mudColumn', world, b.x, SURFACE_Y); fxCall('explode', world, b.x, b.y, 'large', { debris: ['#5a4430', '#ff7a30'] }); world.flash = Math.max(world.flash, 1); fxCall('addShake', world, 10); sfx('explodeL'); }
  if (t >= 100 && t < 160 && t % 3 === 0) splash(b, world, b.x + world.fxRng.range(-40, 40), 18, 8, (t & 1) === 0);
  if (t > 100) b.y += 1.2;
  b.a += (0.25 - b.a) * 0.02;
  if (t === 200) b.deathDone = true;
}

// cosmetic only (world.fxRng): falling mud slabs, metal glints, final-form steam vents
const VENTS = [[-14, -30], [16, -31], [42, -24]];
function updateCosmetics(world, b) {
  for (let i = b.slabs.length - 1; i >= 0; i--) {
    const s = b.slabs[i];
    s.t++; s.vy += 0.13; s.x += s.vx - (b.half === 2 ? 1.2 : 0); s.y += s.vy; s.a += s.va;
    if (s.y > SURFACE_Y + 4 && s.vy > 0) {
      if (b.half === 1) fxCall('mudSplat', world, s.x, SURFACE_Y - 2, 'small');
      splash(b, world, s.x, 10, 3.5, true);
      if (b.half === 1) for (let k = 0; k < 3; k++) fxCall('mudChunk', world, s.x, SURFACE_Y - 3, world.fxRng.range(-1.2, 1.2), -world.fxRng.range(0.6, 1.6));
      b.slabs.splice(i, 1);
    } else if (s.t > 200) b.slabs.splice(i, 1);
  }
  for (const q of b.plates) if (q.glint > 0) q.glint--;
  const st = b.steam;
  if (b.p4k > 0 && !b.deathDone && (b.t & 1) === 0) {
    const [vx, vy] = VENTS[(b.t >> 1) % 3], p = toWorld(b, vx, vy);
    const burst = b.mode === 'transform' || (b.t % 90) < 20;
    st.push({ x: p.x + world.fxRng.range(-2, 2), y: p.y, vx: world.fxRng.range(-1.6, -0.6) + (burst ? -0.4 : 0), vy: -world.fxRng.range(0.6, burst ? 2.2 : 1.2), t: 0, life: world.fxRng.int(24, 40), s: burst ? 1 : 0 });
  }
  for (let i = st.length - 1; i >= 0; i--) { const q = st[i]; q.t++; q.x += q.vx; q.y += q.vy; q.vy *= 0.97; if (q.t >= q.life) { st[i] = st[st.length - 1]; st.pop(); } }
  if (st.length > 90) st.splice(0, st.length - 90);
}

function updateSplash(b) {
  const s = b.splash;
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i];
    q.t++; q.vy += 0.12; q.x += q.vx - (b.half === 2 ? 1.2 : 0.15); q.y += q.vy;
    if ((q.y > SURFACE_Y + 2 && !q.free) || q.t > 90 || q.y > H) { s[i] = s[s.length - 1]; s.pop(); }
  }
  if (s.length > 400) s.splice(0, s.length - 400);
}

// ---- draw -------------------------------------------------------------------------------------
let _ctx = null, _b = null, _mudA = 0, _redA = 0;
function part(s, x, y, a, group, opt) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (a) ctx.rotate(a);
  const far = opt && opt.far;
  const img = far && s.farImg ? s.farImg : s.img, ds = s.detailScale || 1;
  ctx.drawImage(img, -s.px, -s.py, img.width / ds, img.height / ds);
  // crust on the limbs/tail/sails fades out as the armour plates come off (muddy → metal)
  if (!far && opt !== false && _mudA > 0.02) { const m = mudVariant(s, 3); ctx.globalAlpha = _mudA; ctx.drawImage(m, -s.px, -s.py, m.width / ds, m.height / ds); ctx.globalAlpha = 1; }
  // final form: red-hot pulse
  if (!far && _redA > 0.02 && s.red) { ctx.globalAlpha = _redA; ctx.drawImage(s.red, -s.px, -s.py, s.red.width / ds, s.red.height / ds); ctx.globalAlpha = 1; }
  if (group && _b.flashT[group] > 0 && (_b.t & 1) && s.white) { ctx.globalAlpha = 0.5; ctx.drawImage(s.white, -s.px, -s.py, s.white.width / ds, s.white.height / ds); }
  ctx.restore();
}

function stub(ctx, x, y, a0, t) {
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a0);
  const J = [[-2, 2], [-1, -9], [2, -14], [4, -8], [7, -17], [10, -9], [13, -12], [16, -4], [18, 2]];
  ctx.fillStyle = '#231e1c'; ctx.beginPath(); J.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill();
  ctx.fillStyle = (t >> 2) & 1 ? '#ffb040' : '#ff6a20';
  for (let k = 1; k < J.length - 1; k++) ctx.fillRect(J[k][0] - 1, J[k][1], 2, 2);
  ctx.restore();
}

function drawRig(ctx, b, S) {
  const t = b.t, A = getSkArt();
  // far arm-fin
  part(S.upper, -12, 14, 0.15 - b.arm * 0.6, null, { far: true });
  part(S.lower, -18, 31, -0.2 - b.arm * 0.4, null, { far: true });
  // tail: half 1 = painted tail; half 2 = the TAIL SPRING (segments toward the player) + fin
  if (b.half === 1) {
    const ta = Math.sin(t * 0.06) * 0.08;
    part(S.tailA, 50, 0, ta, 'tail');
    part(S.tailB, 50 + Math.cos(ta) * 30, Math.sin(ta) * 30, ta * 2, 'tail');
  } else {
    const o = outerSeg(b), lit = segLit(b);
    const wob = (i) => (b.air ? Math.sin(t * 0.3 + i) * 2 : Math.sin(t * 0.15 + i * 0.8) * 0.6 * (1 - b.coil));
    const tipX = segX(b, o) + SEG_DX * 0.9;
    part(S.tailB, tipX + 8, 4 + wob(o + 1), Math.sin(t * 0.2) * 0.15, null, false);
    for (let i = o; i >= 0; i--) {
      const s = i === o && lit ? A.seg.lit : A.seg.ok;
      ctx.drawImage(s.img, Math.round(segX(b, i) - s.px), Math.round(4 + wob(i) - s.py), s.w, s.h);
      if (b.flashT.seg > 0 && i === o && (t & 1)) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(segX(b, i) - 6), Math.round(4 + wob(i) - 12), 12, 24); ctx.globalAlpha = 1; }
    }
    if (o < SEGS - 1) { const s = A.seg.broken; ctx.drawImage(s.img, Math.round(segX(b, o) + 5), Math.round(4 - s.py), s.w, s.h); }
  }
  // dorsal sail: folded flat against the back unless raised (threat display) or flaring (final)
  SAIL_POS.forEach(([x, y, a0], i) => {
    const q = b.panels[i], fold = 1 - b.sailUp;
    const a = a0 + fold * 1.05 + Math.sin(t * 0.07) * 0.03 * (i + 1);
    if (q.state === 'broken') { stub(ctx, x, y, a0 + fold * 0.6, t); return; }
    if (b.sailUp > 0.7 || b.flare) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (b.flare ? 0.7 : 0.5) + 0.3 * Math.sin(t * 0.3 + i);
      ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a);
      const g = S.sailGlow[i], ds = g.detailScale || 1; ctx.drawImage(g.img, -g.px, -g.py, g.img.width / ds, g.img.height / ds);
      ctx.restore();
    }
    part(S.sails[i], x, y, a, 'sail' + i);
  });
  part(S.torso, 0, 0, 0, 'torso', false);
  // eyes: retract into the sockets (hidden behind the head) unless popped up to aim
  b.eyes.forEach((e, i) => {
    const [ex, ey] = EYE_POS[i];
    // Visual shaft spans the current eye rise and overlaps the head socket.
    const top=e.state==='broken'?ey+4:ey-EYE_UP[i]*e.up+(1-e.up)*20,base=ey+26;
    ctx.fillStyle='#211c1a';ctx.fillRect(ex-4,top+5,8,Math.max(1,base-top-3));
    ctx.fillStyle='#66584a';ctx.fillRect(ex-2.5,top+5,4.5,Math.max(1,base-top-3));
    ctx.fillStyle='#b29b79';ctx.fillRect(ex-2,top+6,1,Math.max(1,base-top-5));
    ctx.fillStyle='#302c29';for(let yy=top+9;yy<base;yy+=5)ctx.fillRect(ex-3,yy,6,1);
    if (e.state === 'broken') { part(S.eyeDead, ex, ey + 4, 0, null, false); return; }
    part(S.eye, ex, ey - EYE_UP[i] * e.up + (1 - e.up) * 20, 0, 'eye' + i, false);
  });
  if (b.jaw > 0.05) {
    part(S.maw, -34, -4, 0, null, false);
    if (b.p4k > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = b.p4k * (0.6 + 0.3 * Math.sin(t * 0.25)); ctx.drawImage(S.mawGlow, -78, -14, 40, 32); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  }
  part(S.jaw, -44, 6, -b.jaw * 0.3, 'head');
  part(S.head, -34, -4, 0, 'head', false);
  b.eyes.forEach((e,i)=>{const [x,y]=EYE_POS[i],base=y+24;
    ctx.fillStyle='#29221d';ctx.beginPath();ctx.ellipse(x,base,5.5,2.8,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#aa9170';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#62513d';ctx.fillRect(x-3,base-3,6,3);
    if(_mudA>.02){ctx.globalAlpha=_mudA;ctx.fillStyle='#795334';ctx.fillRect(x-5,base-1,3,3);ctx.fillRect(x+1,base-2,4,3);ctx.globalAlpha=1;}
  });
  // MUD COAT: one cell per plate (crack stages; broken = bare metal shows, with a glint sweep)
  const coat = getMudCoat(S, PLATES);
  for (const q of b.plates) {
    const c = coat.cells[q.id];
    if (q.state === 'broken') {
      if (q.glint > 0) {
        // fresh metal: bright sheen fading + a light band sweeping across it
        const g = q.glint / 40;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * g * g; ctx.drawImage(c.sheen, c.lx, c.ly, c.lw, c.lh);
        ctx.save(); ctx.beginPath(); ctx.rect(c.lx - 8 + (1 - g) * (c.lw + 16), c.ly, 5, c.lh); ctx.clip();
        ctx.globalAlpha = 0.9; ctx.drawImage(c.sheen, c.lx, c.ly, c.lw, c.lh); ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      continue;
    }
    ctx.drawImage(c.st[q.stage], c.lx, c.ly, c.lw, c.lh);
    if (b.flashT['plate' + q.id] > 0 && (t & 1)) { ctx.globalAlpha = 0.45; ctx.drawImage(c.white, c.lx, c.ly, c.lw, c.lh); ctx.globalAlpha = 1; }
  }
  // twinkles on the exposed metal
  ctx.fillStyle = '#ffffff';
  for (const q of b.plates) {
    if (q.state !== 'broken' || q.glint > 0) continue;
    const ph = (t + q.id * 37) % 160;
    if (ph < 10) { const s = ph < 5 ? ph : 10 - ph, x = Math.round(q.x + ((q.id * 7) % 9) - 4), y = Math.round(q.y - 3 + ((q.id * 5) % 7) - 3); ctx.fillRect(x - s, y, s * 2 + 1, 1); ctx.fillRect(x, y - s, 1, s * 2 + 1); }
  }
  // final form: the exposed reactor core
  if (b.p4k > 0) {
    const C = getCoreArt(), pulse = 0.75 + 0.25 * Math.sin(t * 0.22);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = b.p4k * pulse;
    ctx.drawImage(C.glow, 6 - 26 * pulse, -2 - 26 * pulse, 52 * pulse, 52 * pulse);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, b.p4k * 1.5);
    ctx.drawImage(C.img, 6 - C.d / 2, -2 - C.d / 2, C.d, C.d);
    ctx.globalAlpha = 1;
  }
  part(S.upper, -22, 16, -b.arm * 1.1, null);
  part(S.lower, -28, 33, -0.25 - b.arm * 0.7, null);
}

// falling slabs (the actual plate shapes), steam from the final-form vents
function drawDebris(ctx, b, S) {
  const coat = getMudCoat(S, PLATES);
  for (const s of b.slabs) {
    const c = coat.cells[s.id];
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y)); ctx.scale(s.f, 1); ctx.rotate(s.a); ctx.scale(s.k, s.k);
    ctx.drawImage(c.st[3], c.lx - c.x, c.ly - c.y, c.lw, c.lh);
    ctx.restore();
  }
  for (const q of b.steam) {
    const u = q.t / q.life, sz = Math.round(3 + u * (q.s ? 7 : 5));
    ctx.globalAlpha = (1 - u) * (q.s ? 0.75 : 0.5);
    ctx.fillStyle = u < 0.3 ? '#ffffff' : '#c8c4c0';
    ctx.beginPath();ctx.ellipse(q.x,q.y,sz*.6,sz*.4,-.3,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const splashCounts=new Uint16Array(46),splashXs=new Float64Array(46);
export function draw(ctx, world) {
  const b = world.boss;
  if (!b || !b.active) return;
  const S = getMudSprites();
  _ctx = ctx; _b = b;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawSkHazards(ctx, world, b, S, 'under');
  drawChimneys(ctx, b);
  const gone = b.deathDone || b.mode === 'wait';
  if (!gone) {
    const alive = b.plates.filter((q) => q.state !== 'broken').length;
    _mudA = 0.85 * alive / b.plates.length;
    _redA = b.p4k * (0.35 + 0.3 * Math.sin(b.t * 0.16));
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    ctx.scale(b.f, 1);
    ctx.rotate(b.a);
    ctx.scale(b.k, b.k);
    drawRig(ctx, b, S);
    ctx.restore();
    _mudA = 0; _redA = 0;
    drawGlows(ctx, b, S);
  }
  drawDebris(ctx, b, S);
  // the lower-right mound hides it while it burrows / before it bursts out (and during the entry)
  if (b.mode === 'escape' || (b.mode === 'entry' && b.modeT < 120)) {
    const k = b.mode === 'entry' ? Math.max(0, 1 - b.modeT / 120) : b.mound;
    if (typeof fx.burrowMound !== 'function') drawMound(ctx, MOUND_X, SURFACE_Y + 12, k, b.t);
  }
  drawFry(ctx, world, b, S);
  splashCounts.fill(0);splashXs.fill(0);
  for(const q of b.splash){if(q.free||q.t>45)continue;splashCounts[q.t]++;splashXs[q.t]+=q.x-q.vx*q.t;}
  for(let age=0;age<46;age++)if(splashCounts[age]>=8){
    const x=splashXs[age]/splashCounts[age],width=Math.min(100,34+Math.sqrt(splashCounts[age])*6);
    paintedSurface(ctx,x,SURFACE_Y,age,width);
    paintedCell(ctx,'water',age<22?12:14+(age>32?1:0),x-width*.6,SURFACE_Y-5,width*1.2,14,(1-age/46)*.65);
  }
  // splash droplets (water / mud)
  for (const q of b.splash) {
    drawSpray(ctx,q.x,q.y,q.vx,q.vy,q.t,q.c===2,Math.floor(q.x));
  }
  drawSkHazards(ctx, world, b, S, 'over');
  ctx.restore();
}

// window language: lit part = bright core + outer rim (eyes, sail panels, tail segment)
function drawGlows(ctx, b, S) {
  ctx.globalCompositeOperation = 'lighter';
  b.eyes.forEach((e, i) => {
    if (e.state !== 'ok' || e.up < 0.3) return;
    const p = eyePos(b, i), tell = b.atk && b.atk.tell && b.atk.name === 'eye';
    ctx.globalAlpha = Math.min(1, 0.6 + 0.3 * Math.sin(b.t * 0.3) + (tell ? 0.3 : 0));
    ctx.drawImage(S.eyeGlow, Math.round(p.x) - 12, Math.round(p.y) - 12, 24, 24);
  });
  if (b.sailUp > 0.7 && !b.flare) b.panels.forEach((q, i) => { if (q.state !== 'ok') return; const p = sailTop(b, i); ctx.globalAlpha = 0.7 + 0.3 * Math.sin(b.t * 0.4 + i); ctx.drawImage(S.tellGlow, Math.round(p.x) - 8, Math.round(p.y) - 8); });
  if (b.half === 2 && segLit(b)) {
    const o = outerSeg(b);
    if (o >= 0) { const p = toWorld(b, segX(b, o), 4); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(b.t * 0.4); ctx.drawImage(S.sailFire, Math.round(p.x) - 18, Math.round(p.y) - 18, 36, 36); }
  }
  if (b.half === 1 && b.atk && b.atk.name === 'slap' && b.atk.tell) { const p = toWorld(b, -30, 40); ctx.globalAlpha = (b.t >> 2) & 1 ? 0.9 : 0.4; ctx.drawImage(S.tellGlow, Math.round(p.x) - 8, Math.round(p.y) - 8); }
  if (b.half === 2 && b.atk && b.atk.name === 'volley' && b.atk.tell) { const p = toWorld(b, -20, 24); ctx.globalAlpha = (b.t >> 2) & 1 ? 0.9 : 0.4; ctx.drawImage(S.tellGlow, Math.round(p.x) - 8, Math.round(p.y) - 8); }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // white rim on lit eyes (the hittable outline)
  ctx.fillStyle = '#ffffff';
  b.eyes.forEach((e, i) => {
    if (!litEye(e)) return;
    const p = eyePos(b, i), r = 8 * b.k + 1;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2 + b.t * 0.05; ctx.fillRect(Math.round(p.x + Math.cos(a) * r), Math.round(p.y + Math.sin(a) * r), 1, 1); }
  });
  // smoking sockets of broken eyes
  ctx.fillStyle = '#3a3634';
  b.eyes.forEach((e, i) => {
    if (e.state !== 'broken') return;
    const p = toWorld(b, EYE_POS[i][0], EYE_POS[i][1]);
    for (let k = 0; k < 4; k++) { const u = ((b.t * 0.5 + k * 9) % 36) / 36; ctx.globalAlpha = 0.6 * (1 - u); ctx.fillRect(Math.round(p.x + Math.sin(u * 6 + k) * 3 - 2 + u * 8 * b.f), Math.round(p.y - 6 - u * 22), 4, 4); }
  });
  ctx.globalAlpha = 1;
}
