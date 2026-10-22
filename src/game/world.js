// World = the single mutable game state, plus the fixed update/draw order.
// Module contracts are documented in docs/ARCHITECTURE.md. Each module owns
// its own slice of world and exposes init/update/draw; cross-module calls go
// only through the exported functions listed there.

import { W, H, HUD_H, SCREEN_H } from '../config.js';
import { makeRng } from '../core/rng.js';
import * as background from './background.js';
import * as player from './player.js';
import * as boss from './boss.js';
import * as bullets from './bullets.js';
import * as fx from './fx.js';
import * as hud from './hud.js';
import * as scenes from './scenes.js';
import * as audio from './audio.js';

export function createWorld({ seed = 1, scene = 'title', bossHpFrac = 1, zone = 'V' } = {}) {
  const world = {
    seed,
    zone,              // current zone letter: 'V' axolotl, 'G' mudskipper (see boss.js BOSSES)
    startZone: zone,   // zone the current run started from (title zone select)
    continues: 0,      // continues used this run
    frame: 0,          // presentation clock: always advances
    gameFrame: 0,      // gameplay clock: advances only when gameplay updates ran (not during hitstop/pause)
    scene: null,
    sceneT: 0,
    paused: false,
    rng: makeRng(seed),
    fxRng: makeRng(seed ^ 0x9e3779b9),
    input: { x: 0, y: 0, shot: false, bomb: false, bombPressed: false, start: false },
    score: 0,
    hiScore: 500000,
    shake: 0,          // screen shake magnitude in px, decays in fx.update
    shakeX: 0, shakeY: 0, // resolved per step (draw is read-only)
    flash: 0,          // full-screen white flash 0..1, decays in fx.update
    hitstop: 0,        // frames to freeze gameplay (impact feel)
    player: null,
    boss: null,
    pShots: [],
    eShots: [],
    items: [],
    events: [],
    lastEvents: [],
    stats: { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 },
    bg: null,
    fxState: null,
    hudState: null,
    sceneState: null,
  };
  background.init(world);
  fx.init(world);
  player.init(world);
  boss.init(world);
  bullets.init(world);
  hud.init(world);
  scenes.init(world);
  scenes.goto(world, scene);
  if (bossHpFrac < 1 && world.boss) boss.debugSetHpFrac(world, bossHpFrac);
  return world;
}

// Fresh run (title/clear/gameover → warning). Restores every per-run field to
// its createWorld value so a run with seed S always plays identically,
// whatever happened before. Persistent across runs: seed, hiScore, scene
// bookkeeping (the caller sets scene right after), and module-internal
// caches (sprites) which init() functions keep.
export function resetRun(world, zone = world.startZone || 'V') {
  Object.assign(world, {
    zone, startZone: zone, continues: 0,
    frame: 0, gameFrame: 0, paused: false,
    rng: makeRng(world.seed),
    fxRng: makeRng(world.seed ^ 0x9e3779b9),
    score: 0, shake: 0, shakeX: 0, shakeY: 0, flash: 0, hitstop: 0,
    pShots: [], eShots: [], items: [], events: [], lastEvents: [],
    stats: { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 },
  });
  background.init(world);
  fx.init(world);
  player.init(world);
  boss.init(world);
  bullets.init(world);
  hud.init(world);
}

// Advance to another zone mid-run (boss rush): the player keeps score, lives and
// power; boss, bullets, items, effects and background are rebuilt for the zone.
// Deterministic: gameplay RNG continues its stream.
export function enterZone(world, zone) {
  Object.assign(world, { zone, pShots: [], eShots: [], items: [], hitstop: 0, flash: 0, shake: 0 });
  background.init(world);
  fx.init(world);
  boss.init(world);
  bullets.init(world);
  if (typeof player.enterZone === 'function') player.enterZone(world);
}

// Arcade continue after game over: the fight resumes where it was (boss keeps its
// damage/phase), the player comes back with a fresh stock; score resets to 0 and
// the number of continues is kept (shown on the HUD / tally, like real arcades).
export function continueRun(world) {
  world.continues++;
  world.score = 0;
  world.eShots = [];
  if (typeof player.onContinue === 'function') player.onContinue(world);
  else { world.player.lives = 2; world.player.alive = false; world.player.respawn = 1; }
}

// Gameplay events: producers emit into world.events during step N; at the
// start of step N+1 they move to world.lastEvents, which ALL consumers
// (audio/scenes/hud, and anything else) read. One frame of latency, but every
// consumer sees every event exactly once regardless of update order.
//   emit(world, {type, ...})  types: see docs/ARCHITECTURE.md "Events"
export function emit(world, ev) {
  world.events.push(ev);
}

export function stepWorld(world) {
  if (world.paused) return;
  world.lastEvents = world.events;
  world.events = [];
  world.frame++;
  world.sceneT++;
  audio.update(world);
  scenes.update(world);
  background.update(world);
  if (world.hitstop > 0) {
    world.hitstop--;
  } else if (scenes.gameplayActive(world)) {
    world.gameFrame++;
    player.update(world);
    boss.update(world);
    bullets.update(world);
  }
  fx.update(world);
  hud.update(world);
  // Resolve shake offset here so drawing never consumes RNG (render rate must not affect state).
  if (world.shake > 0.3) {
    world.shakeX = Math.round(world.fxRng.range(-world.shake, world.shake));
    world.shakeY = Math.round(world.fxRng.range(-world.shake, world.shake));
  } else {
    world.shakeX = world.shakeY = 0;
  }
}

// ctx is in SCREEN coordinates (W x SCREEN_H). The HUD band is drawn first at
// the top; everything else is drawn translated into the playfield and clipped.
export function drawWorld(ctx, world) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, SCREEN_H);

  ctx.save();
  ctx.translate(0, HUD_H);
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.save();
  ctx.translate(world.shakeX, world.shakeY);
  background.drawBack(ctx, world);
  if (scenes.showsBoss(world)) boss.draw(ctx, world);
  fx.drawUnder(ctx, world);
  background.drawMid(ctx, world);
  if (scenes.showsPlayer(world)) player.draw(ctx, world);
  bullets.draw(ctx, world);
  fx.drawOver(ctx, world);
  background.drawFront(ctx, world);
  ctx.restore();
  scenes.draw(ctx, world);
  if (world.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, world.flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  hud.draw(ctx, world);
}
