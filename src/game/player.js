// Player ship: movement, banking, entry/death/respawn, shield, power-up items.
// Weapons live in player-weapons.js, pixel art in player-art.js.
// Public API (see docs/ARCHITECTURE.md):
//   init(world) update(world) draw(ctx, world)
//   killPlayer(world)                     lethal contact (ignored while invulnerable)
//   playerHitbox(world) → {x,y,r} | null  (null while invulnerable/dead/entering/bursting)
//   hurt(world, source) → 'absorbed'|'killed'|'ignored'   single hit API (bullets, lasers, body contact)
//   absorbHit(world) → bool               true if the shield ate the hit (legacy; prefer hurt)
//   spawnItem(world, x, y, kind)          kind 'laser'|'wave'|'homing'|'shield'|'bomb'
//                                         (legacy 'red'→laser 'green'→wave 'blue'→homing 'cyan'→shield)
// HUD-readable fields on world.player (stable):
//   lives, alive, invuln, entering,
//   laserLv/laserMax, waveLv/waveMax, homingLv/homingMax, shieldHp/shieldMax,
//   burstStock/burstMax, burst (active Abyss Burst | null)
import { W, H } from '../config.js';
import { clamp, swapRemove, TAU } from '../core/util.js';
import { track } from '../core/analytics.js';
import * as fx from './fx.js';
import { emit } from './world.js';
import * as audio from './audio.js';
import { drawPlayerVisual } from './player-visual.js';
import { art, SHIP_CX, SHIP_CY, SHIELD_W, SHIELD_H, ORB_S, SHIELD_COLOR } from './player-art.js';
import {
  fire, updateShots, drawShots, launchBurst, burstGuard, updateBurst, drawBurst,
  LASER_MAX, WAVE_MAX, HOMING_MAX, BURST_MAX,
} from './player-weapons.js';

export const SHIELD_MAX = 8;
export const START = { laserLv: 1, waveLv: 0, homingLv: 0, shieldHp: 0, burstStock: 1 };
// a run that starts directly at zone G gets a mid kit
export const START_G = { laserLv: 3, waveLv: 1, homingLv: 0, shieldHp: 2, burstStock: 1 };
export const KIT_MAX = { laserLv: LASER_MAX, waveLv: WAVE_MAX, homingLv: HOMING_MAX, shieldHp: SHIELD_MAX, burstStock: BURST_MAX };
export const ITEM_KINDS = ['laser', 'wave', 'homing', 'shield', 'bomb'];
const LEGACY = { red: 'laser', missile: 'laser', green: 'wave', bomb: 'bomb', blue: 'homing', cyan: 'shield', arm: 'shield' };
const SPEED = 2, DIAG = 1.5;
const X_MIN = 12, X_MAX = W - 18, Y_MIN = 9, Y_MAX = H - 9;
const ENTER_FRAMES = 50, RESPAWN_DELAY = 80, INVULN = 170 /* 50f entry + 2 s */, HOME_X = 56, CRUISE_X = 60;
const ITEM_SCORE = 1000, ITEM_MAX_BONUS = 5000, SHIELD_PER_ITEM = 2;

const sfx = (n) => { if (typeof audio.sfx === 'function') audio.sfx(n); };
const fxc = (fn, ...a) => { if (typeof fx[fn] === 'function') fx[fn](...a); };

function startKit(world) {
  const base = { ...(world.zone === 'G' || world.zone === 'M' ? START_G : START) };
  const k = world.kit;
  if (k) {
    if (k.max) Object.assign(base, KIT_MAX);
    const lv = (v, lo, hi) => clamp(Math.round(v), lo, hi);
    if (Number.isFinite(k.lv)) { base.laserLv = lv(k.lv, 1, LASER_MAX); base.waveLv = lv(k.lv, 0, WAVE_MAX); base.homingLv = lv(k.lv, 0, HOMING_MAX); }
    if (Number.isFinite(k.laser)) base.laserLv = lv(k.laser, 1, LASER_MAX);
    if (Number.isFinite(k.wave)) base.waveLv = lv(k.wave, 0, WAVE_MAX);
    if (Number.isFinite(k.homing)) base.homingLv = lv(k.homing, 0, HOMING_MAX);
    if (Number.isFinite(k.shield)) base.shieldHp = lv(k.shield, 0, SHIELD_MAX);
    if (Number.isFinite(k.burst)) base.burstStock = lv(k.burst, 0, BURST_MAX);
  }
  return base;
}

export function init(world) {
  world.player = {
    x: -30, y: H / 2, alive: true, lives: 2, invuln: 0, respawn: 0, entering: 0, parked: true,
    bank: 0, cool: 0, waveCool: 0, homingCool: 0, homingSide: 1, muzzle: 0, volley: 0,
    ...startKit(world),
    laserMax: LASER_MAX, waveMax: WAVE_MAX, homingMax: HOMING_MAX, shieldMax: SHIELD_MAX, burstMax: BURST_MAX,
    shieldFlash: 0, shieldGrace: 0, itemsCollected: 0, shieldOwed: 0, kvx: 0, kvy: 0, pops: [], impacts: [], burst: null, t: 0, collectFx: null, sceneSeen: null, lastItem: null, lastDeath: null,
  };
  // per-run state owned by the player module
  world.items = [];
  world.dmgMeter = {};
  if (world.pShots) world.pShots.length = 0; else world.pShots = [];
  if (typeof document !== 'undefined') art(); // pre-render once (~17 ms) so the first shot never hitches
}

export function playerHitbox(world) {
  const p = world.player;
  if (!p || !p.alive || p.parked || p.invuln > 0 || p.entering > 0 || burstGuard(world)) return null;
  return { x: p.x, y: p.y, r: 2 };
}

function addPop(world, x, y) {
  const p = world.player;
  const shards = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + world.fxRng.range(-0.15, 0.15), s = world.fxRng.range(1.2, 2.6);
    shards.push({ x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 11, vx: Math.cos(a) * s, vy: Math.sin(a) * s });
  }
  p.pops.push({ x, y, t: 0, shards });
}

// Shield absorb. After a hit the shield has SHIELD_GRACE frames in which
// further hits are eaten for free, so overlapping bullets can't drain it at once.
const SHIELD_GRACE = 10, CONTACT_GRACE = 24;
// The grace timer is only (re)started when shield HP is actually consumed, so
// staying in contact can never extend it.
function shieldTake(world, grace) {
  const p = world.player;
  if (!p) return 'none';
  if (p.shieldGrace > 0) return 'grace';
  if (p.shieldHp <= 0) return 'none';
  p.shieldHp--;
  p.shieldFlash = 6;
  p.shieldGrace = grace;
  if (p.shieldHp === 0) addPop(world, p.x + 1, p.y);
  sfx('armHit');
  return 'consumed';
}
export function absorbHit(world) {
  return shieldTake(world, SHIELD_GRACE) !== 'none';
}

// Single hit API for anything that harms the player.
//   source: 'bullet' | 'laser' | 'body' | 'escort' | {kind, x, y, cause}  (x,y → knock-back away from it;
//           cause = hazard id for death attribution; a bullet object with .cause also works)
//   → 'ignored' (dead/parked/entering/invulnerable/burst guard), 'absorbed' (shield), 'killed'
export function hurt(world, source = 'bullet') {
  const p = world.player;
  if (!p || !p.alive || p.parked || p.invuln > 0 || p.entering > 0 || burstGuard(world)) return 'ignored';
  const kind = typeof source === 'string' ? source : (source && source.kind) || 'bullet';
  const contact = kind === 'body' || kind === 'escort' || kind === 'contact';
  const taken = shieldTake(world, contact ? CONTACT_GRACE : SHIELD_GRACE);
  if (taken !== 'none') {
    if (contact && taken === 'consumed') {
      let ax = -1, ay = 0;
      if (source && typeof source === 'object' && Number.isFinite(source.x) && Number.isFinite(source.y)) {
        ax = p.x - source.x; ay = p.y - source.y;
        const d = Math.hypot(ax, ay) || 1; ax /= d; ay /= d;
        if (ax > -0.3) ax = -0.3; // always shove at least a little to the left
      }
      p.kvx = ax * 3.2; p.kvy = ay * 3.2;
    }
    return 'absorbed';
  }
  const obj = source && typeof source === 'object' ? source : null;
  const inner = obj && (obj.b || obj.bullet);
  const cause = (obj && (obj.cause || (inner && inner.cause))) || 'unknown';
  const atk = obj ? (obj.atk ?? (inner && inner.atk) ?? null) : null;
  killPlayer(world, cause, atk);
  return p.alive ? 'ignored' : 'killed';
}

// cause: hazard id from the boss (CAUSES table); unknown → 'unknown'
// atk: attack-instance id stamped by the boss (optional)
function safeSnapshot(world, cause, atk) {
  const h = world.boss && world.boss.safeHint;
  if (!h) return null;
  const match = atk !== undefined && atk !== null ? h.atk === atk : h.cause === cause;
  if (!match) return null;
  return {
    cause: h.cause, atk: h.atk,
    rects: Array.isArray(h.rects) ? h.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) : [],
    text: h.text,
  };
}
export function killPlayer(world, cause = 'unknown', atk = null) {
  const p = world.player;
  if (!p.alive || p.invuln > 0 || p.entering > 0 || p.parked || burstGuard(world)) return;
  cause = typeof cause === 'string' && cause ? cause : 'unknown';
  if (atk === undefined) atk = null;
  const safe = safeSnapshot(world, cause, atk);
  p.lastDeath = { cause, atk, safe, x: p.x, y: p.y, frame: world.gameFrame };
  const ev = { type: 'playerDeath', x: p.x, y: p.y, cause, atk, safe };
  if (typeof emit === 'function') emit(world, ev);
  else if (world.events) world.events.push(ev);
  p.alive = false;
  p.respawn = RESPAWN_DELAY;
  p.lives--;
  track(`death/${world.zone || 'V'}/${cause}`, `death ${cause}`);
  if (p.shieldHp > 0) addPop(world, p.x + 1, p.y);
  // the shield is lost; part of it comes back as SHIELD capsules that float in with the new ship
  // (catch-up, combat v2b: one death must not snowball; 1 capsule = +2, up to 2 capsules)
  p.shieldOwed = Math.min(2, Math.ceil(p.shieldHp / 3));
  p.shieldHp = 0;
  p.levelAtDeath = p.laserLv;
  p.kitAtDeath = `${p.laserLv}/${p.waveLv}/${p.homingLv}`;
  fxc('explode', world, p.x, p.y, 'large');
  fxc('addShake', world, 4);
  if (typeof fx.debris === 'function') {
    const cols = ['#eef1f7', '#a0a8bc', '#ff4a3c', '#6c7390', '#d61a26'];
    for (let i = 0; i < 7; i++) {
      const a = world.fxRng.range(0, TAU), s = world.fxRng.range(0.8, 2.4);
      fx.debris(world, p.x, p.y, Math.cos(a) * s - 0.5, Math.sin(a) * s - 0.6, cols[i % cols.length]);
    }
  }
  world.flash = Math.max(world.flash, 0.3);
  sfx('death');
}

// ---------------------------------------------------------------- items
export function spawnItem(world, x, y, kind = 'laser') {
  if (!world.items) world.items = [];
  if (!ITEM_KINDS.includes(kind)) kind = LEGACY[kind] || 'laser';
  world.items.push({ x, y, kind, t: 0, vx: -world.rng.range(1.2, 1.8), vy: world.rng.range(-1.2, 1.2), ph: world.rng.range(0, TAU) });
}

function collect(world, it) {
  const p = world.player;
  let maxed = false;
  const up = (k, max) => { if (p[k] < max) p[k]++; else maxed = true; };
  const lock = !!(world.kit && world.kit.lock) && (it.kind === 'laser' || it.kind === 'wave' || it.kind === 'homing'); // DPS measurement kit: levels never change
  if (lock) maxed = true;
  else if (it.kind === 'laser') up('laserLv', LASER_MAX);
  else if (it.kind === 'wave') up('waveLv', WAVE_MAX);
  else if (it.kind === 'homing') up('homingLv', HOMING_MAX);
  else if (it.kind === 'shield') {
    if (p.shieldHp < SHIELD_MAX) p.shieldHp = Math.min(SHIELD_MAX, p.shieldHp + SHIELD_PER_ITEM); else maxed = true;
    p.shieldFlash = 8;
  } else if (it.kind === 'bomb') up('burstStock', BURST_MAX);
  const val = ITEM_SCORE + (maxed ? ITEM_MAX_BONUS : 0);
  world.score += val;
  fxc('scorePopup', world, it.x, it.y - 6, val);
  p.collectFx = { x: it.x, y: it.y, t: 0, kind: it.kind };
  p.itemsCollected++;
  p.lastItem = { kind: it.kind, t: world.frame, maxed };
  sfx('powerup');
}

function updateItems(world) {
  const items = world.items, p = world.player;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.t++;
    it.vx += (-0.45 - it.vx) * 0.04;
    it.vy *= 0.95;
    it.x += it.vx;
    it.y += it.vy + Math.sin(it.t * 0.06 + it.ph) * 0.35;
    if (it.y < 10) { it.y = 10; it.vy = Math.abs(it.vy); }
    if (it.y > H - 10) { it.y = H - 10; it.vy = -Math.abs(it.vy); }
    if (it.x > W - 8) { it.x = W - 8; it.vx = -Math.abs(it.vx); }
    if (it.x < -12) { swapRemove(items, i); continue; }
    if (p.alive && !p.parked && p.entering <= 0) {
      if (world.inputLocked) {
        // victory magnet: pull every item in so nothing is lost during the boss death/clear
        const mx = p.x - it.x, my = p.y - it.y, md = Math.hypot(mx, my) || 1;
        const sp = Math.min(md, 1.5 + it.t * 0.02 + (it.mag = (it.mag || 0) + 0.15));
        it.x += (mx / md) * sp; it.y += (my / md) * sp;
      }
      const dx = it.x - p.x, dy = it.y - p.y;
      if (dx * dx + dy * dy < 14 * 14) { collect(world, it); swapRemove(items, i); }
    }
  }
}

// ---------------------------------------------------------------- update
// ---------------------------------------------------------------- run flow hooks (world.js)
function clearTransient(world) {
  const p = world.player;
  if (world.pShots) world.pShots.length = 0; else world.pShots = [];
  if (world.items) world.items.length = 0; else world.items = [];
  Object.assign(p, { burst: null, pops: [], impacts: [], collectFx: null, kvx: 0, kvy: 0, shieldGrace: 0, shieldFlash: 0, cinematic: false });
}

// Arcade continue: fresh stock, fly in now; every gauge level is kept (LASER only ever RAISED to the
// Lv3 floor, never lowered), shield ≥ 2, burst ≥ 1.
export function onContinue(world) {
  const p = world.player;
  clearTransient(world);
  p.lives = 2;
  p.shieldOwed = 0;
  p.laserLv = Math.max(p.laserLv, 3);
  p.shieldHp = Math.min(SHIELD_MAX, Math.max(p.shieldHp, 2));
  p.burstStock = Math.max(p.burstStock, 1);
  startEntry(p);
  p.invuln = INVULN;
  p.sceneSeen = world.scene;
}

// Next zone of the boss rush: keep power/lives/score/itemsCollected; park off-screen
// and fly in when the next boss scene starts (or right away if already in it).
export function enterZone(world) {
  const p = world.player;
  clearTransient(world);
  Object.assign(p, { parked: true, x: -30, y: H / 2, entering: 0, bank: 0, invuln: 0, alive: true, respawn: 0, sceneSeen: null });
}

function startEntry(p) {
  Object.assign(p, { alive: true, parked: false, x: -24, y: H / 2, entering: ENTER_FRAMES, bank: 0, cool: 10, waveCool: 10, homingCool: 20 });
}

export function update(world) {
  const p = world.player, inp = world.input;
  p.t++;
  if (!world.items) world.items = [];
  // scene hooks: parked off-screen before the fight, fly in when the boss scene starts
  if (world.scene !== p.sceneSeen) {
    p.sceneSeen = world.scene;
    if (world.scene === 'boss' && p.parked) startEntry(p);
    else if (world.scene === 'warning' || world.scene === 'title') { p.parked = true; p.x = -30; }
  }
  if (p.cinematic) { /* scenes drive x/y */ }
  else if (p.parked) { /* waiting off-screen */ }
  else if (!p.alive) {
    if (p.lives >= 0 && --p.respawn <= 0) {
      startEntry(p);
      p.invuln = INVULN;
      p.burstStock = Math.max(p.burstStock, 1);
      // owed shield capsules drift in ahead of the respawning ship (grab them during the invulnerability)
      for (let i = 0; i < p.shieldOwed; i++) {
        spawnItem(world, HOME_X + 70 + i * 26, H / 2 + (i ? 18 : -18), 'shield');
        const it = world.items[world.items.length - 1]; it.vx = -0.6; it.vy = 0;
      }
      p.shieldOwed = 0;
    }
  } else if (p.entering > 0) {
    p.entering--;
    const k = 1 - p.entering / ENTER_FRAMES;
    p.x = -24 + (HOME_X + 24) * (1 - (1 - k) ** 3);
    p.bank *= 0.8;
    if (p.invuln > 0) p.invuln--;
  } else if (world.inputLocked) {
    // victory cruise: no firing/burst, glide to a calm mid-screen position
    p.x += (CRUISE_X - p.x) * 0.04;
    p.y += (H / 2 - p.y) * 0.04;
    p.bank += clamp(clamp((H / 2 - p.y) * -0.15, -1, 1) - p.bank, -0.1, 0.1);
    if (p.invuln > 0) p.invuln--;
    if (p.cool > 0) p.cool--;
  } else {
    const dx = inp.x || 0, dy = inp.y || 0;
    const sp = dx && dy ? DIAG : SPEED;
    p.x = clamp(p.x + Math.sign(dx) * sp + p.kvx, X_MIN, X_MAX);
    p.y = clamp(p.y + Math.sign(dy) * sp + p.kvy, Y_MIN, Y_MAX);
    p.kvx *= 0.82; p.kvy *= 0.82;
    if (Math.abs(p.kvx) < 0.05) p.kvx = 0;
    if (Math.abs(p.kvy) < 0.05) p.kvy = 0;
    p.bank += clamp(Math.sign(dy) * 2 - p.bank, -0.25, 0.25);
    if (p.invuln > 0) p.invuln--;
    if (inp.bombPressed) launchBurst(world);
    fire(world);
  }
  if (p.muzzle > 0) p.muzzle--;
  if (p.shieldFlash > 0) p.shieldFlash--;
  if (p.shieldGrace > 0) p.shieldGrace--;
  updateShots(world);
  updateBurst(world);
  updateItems(world);
  for (let i = p.pops.length - 1; i >= 0; i--) {
    const pp = p.pops[i];
    pp.t++;
    for (const s of pp.shards) { s.x += s.vx; s.y += s.vy; s.vx *= 0.93; s.vy *= 0.93; }
    if (pp.t > 22) p.pops.splice(i, 1);
  }
  if (p.collectFx && ++p.collectFx.t > 16) p.collectFx = null;
}

// ---------------------------------------------------------------- draw
const RING = { laser: '#ff8070', wave: '#a0ff80', homing: '#80a8ff', shield: '#80f0ff', bomb: '#d090ff' };
function drawItems(ctx, world) {
  const A = art();
  for (const it of world.items) {
    const x = Math.round(it.x), y = Math.round(it.y);
    const pulse = 0.55 + 0.45 * Math.sin(it.t * 0.18);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(A.halo[it.kind], x - 16, y - 16);
    ctx.globalAlpha = pulse * 0.6;
    ctx.drawImage(A.halo[it.kind], x - 16, y - 16);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(A.orb[it.kind][(it.t >> 3) & 3], x - (ORB_S >> 1), y - (ORB_S >> 1));
    const tw = (it.t + ((it.ph * 10) | 0)) % 40;
    if (tw < 6) {
      ctx.fillStyle = '#ffffff';
      const s = tw < 3 ? tw : 6 - tw;
      ctx.fillRect(x - 5 - s, y - 5, s * 2 + 1, 1);
      ctx.fillRect(x - 5, y - 5 - s, 1, s * 2 + 1);
    }
  }
  const c = world.player.collectFx;
  if (c) {
    ctx.globalAlpha = 1 - c.t / 16;
    ctx.strokeStyle = RING[c.kind] || '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(Math.round(c.x), Math.round(c.y), 4 + c.t * 1.6, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawShip(ctx, world) {
  if (drawPlayerVisual(ctx, world)) return;
  const p = world.player, A = art();
  const x = Math.round(p.x), y = Math.round(p.y);
  const f = (world.frame >> 1) & 3;
  const L = p.entering > 0 ? 2 : world.inputLocked ? 1 : world.input.x > 0 ? 2 : world.input.x < 0 ? 0 : 1;
  const fl = A.flame[L][f];
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(fl, x - 14 - fl.width + 1, y - 4);
  ctx.globalCompositeOperation = 'source-over';
  const bi = clamp(Math.round(p.bank), -2, 2) + 2;
  ctx.drawImage(A.ship[bi], x - SHIP_CX, y - SHIP_CY);
  if (p.muzzle > 0) {
    const m = A.muzzle[Math.max(0, 3 - p.muzzle)];
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(m, x + 11, y - 5);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawShield(ctx, world) {
  const p = world.player, A = art();
  const x = Math.round(p.x) + 1, y = Math.round(p.y);
  if (p.shieldHp > 0 && p.alive && !p.parked) {
    const crack = p.shieldHp >= 5 ? 0 : p.shieldHp >= 3 ? 1 : 2;
    const wob = Math.round(Math.sin(p.t * 0.15) * 0.6);
    const sp = p.shieldFlash > 0 && (p.shieldFlash & 2) ? A.shieldFlash : A.shield[crack];
    ctx.globalAlpha = (0.78 + 0.12 * Math.sin(p.t * 0.3)) * (0.75 + 0.25 * Math.min(1, p.shieldHp / 4));
    ctx.drawImage(sp, x - (SHIELD_W >> 1), y - (SHIELD_H >> 1) + wob);
    ctx.globalAlpha = 1;
    for (let k = 0; k < 2; k++) {
      const a = p.t * 0.07 + k * Math.PI;
      const gx = Math.round(x + Math.cos(a) * 19.5), gy = Math.round(y + Math.sin(a) * 13.5 + wob);
      ctx.fillStyle = SHIELD_COLOR;
      ctx.fillRect(gx - 1, gy, 3, 1); ctx.fillRect(gx, gy - 1, 1, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(gx, gy, 1, 1);
    }
  }
  for (const pp of p.pops) {
    ctx.globalAlpha = 1 - pp.t / 22;
    ctx.strokeStyle = SHIELD_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(Math.round(pp.x), Math.round(pp.y), 19 + pp.t * 1.6, 13 + pp.t * 1.2, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const s of pp.shards) ctx.fillRect(Math.round(s.x), Math.round(s.y), pp.t < 8 ? 2 : 1, 1);
    ctx.globalAlpha = 1;
  }
}

export function draw(ctx, world) {
  const p = world.player;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawItems(ctx, world);
  drawShots(ctx, world);
  const blink = p.invuln > 0 && ((p.invuln >> 1) & 1);
  if (p.alive && !blink && p.x > -40) drawShip(ctx, world);
  drawShield(ctx, world);
  drawBurst(ctx, world);
  ctx.restore();
}
