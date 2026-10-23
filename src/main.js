// Boot + main loop. Fixed 60Hz simulation with an accumulator; rendering at
// internal 320x224 then nearest-neighbour upscale to the visible canvas.
//
// URL params (used by tools/ and for debugging):
//   ?seed=N          gameplay RNG seed (default 1)
//   ?scene=boss      start directly in a scene (title|approach|warning|boss|clear)
//   ?bot=1           autopilot (tools/bot.js) drives the input
//   ?hp=0.5          set boss HP fraction at start
//   ?headless=1&shot=ID  run SHOTS[ID] for its frame budget, freeze, set __harnessReady
//   ?mute=1          no audio
//
// Test hooks on window.__game: { world, step(n), snapshot() }.

import { W, SCREEN_H as H, DT, SHOTS } from './config.js';
import { attachInput, readInput, resetInput } from './core/input.js';
import { attachTouch, setTouchScale, touchActive } from './core/touch.js';
import { createWorld, stepWorld, drawWorld } from './game/world.js';
import { botInput } from './game/bot.js';
import * as audio from './game/audio.js';
import { loadVisualAssets } from './game/g-visual-assets.js';
import { loadAxolotlAssets } from './game/v-visual-assets.js';
import { loadPresentationArt } from './game/ui-presentation-visual.js';
import { loadPlayerVisual } from './game/player-visual.js';

// Painted-art assets (Codex visual pass, ~1.7 MB WebP) must be ready before the
// sprite caches are built in createWorld. index.html shows a LOADING overlay
// meanwhile; a failed load falls back to the procedural art.
if (new URLSearchParams(location.search).get('visual') !== '0') await Promise.all([loadVisualAssets(), loadAxolotlAssets(), loadPresentationArt(), loadPlayerVisual()]);
document.getElementById('loading')?.remove();

const params = new URLSearchParams(location.search);
const shotDef = params.get('shot') ? SHOTS.find((s) => s.id === params.get('shot')) : null;
const headless = params.has('headless');
const botParam = params.get('bot');
const useBot = botParam === '1' || botParam === '2' || botParam === '3' || botParam === '4' || botParam === '5' || (shotDef && shotDef.bot);
const botProfile = botParam === '2' ? 'human' : botParam === '3' ? 'camper' : botParam === '4' ? 'midcamper' : botParam === '5' ? 'skimcamper' : 'perfect';

const display = document.getElementById('screen');
const dctx = display.getContext('2d');
const low = document.createElement('canvas');
low.width = W;
low.height = H;
const lctx = low.getContext('2d');

const seedParam = Number(params.get('seed'));
let world = createWorld({
  seed: params.has('seed') && Number.isInteger(seedParam) ? seedParam : 1,
  scene: (shotDef && shotDef.scene) || params.get('scene') || 'title',
  // The game order is V → G; the Codex comparison build defaulted to G, the game does not.
  zone: (shotDef && shotDef.zone) || (params.get('zone') || 'V').toUpperCase(),
  bossHpFrac: shotDef && shotDef.bossHpFrac !== undefined ? shotDef.bossHpFrac : Number(params.get('hp') || 1),
});

attachInput();
if (!headless) attachTouch();
if (!headless && params.get('mute') !== '1') audio.attach(window);

function step(n = 1) {
  for (let i = 0; i < n; i++) {
    world.input = useBot ? botInput(world, botProfile) : readInput();
    stepWorld(world);
  }
}

function render() {
  // Painted zones render at detail× the logical 426x240 (gameplay coords unchanged).
  // Touch devices use 2× to keep phones smooth; ?detail=N overrides for testing.
  const want = Number(params.get('detail')) || (touchActive() ? 2 : 3);
  const detail = ['G', 'V', 'M'].includes(world.zone) && params.get('visual') !== '0' ? want : 1;
  if(low.width !== W*detail){low.width=W*detail;low.height=H*detail;}
  lctx.setTransform(detail, 0, 0, detail, 0, 0);
  lctx.imageSmoothingEnabled = false; // pixel art: rotated/scaled sprites stay nearest-neighbour
  drawWorld(lctx, world);
  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(low, 0, 0, display.width, display.height);
}

function fit() {
  if (headless) {
    display.width = W * 3;
    display.height = H * 3;
    return;
  }
  // Integer scale when it fills the window reasonably; otherwise scale the
  // canvas element fractionally (pixelated CSS) so small windows aren't stuck at 1x.
  const fitS = Math.min(innerWidth / W, innerHeight / H);
  const s = Math.max(1, Math.floor(fitS));
  display.width = W * s;
  display.height = H * s;
  const cssS = fitS >= 2 && fitS - s < 0.5 ? s : fitS;
  display.style.width = `${Math.floor(W * cssS)}px`;
  display.style.height = `${Math.floor(H * cssS)}px`;
  setTouchScale(cssS);
}
addEventListener('resize', fit);
fit();

window.__game = {
  get world() { return world; },
  step,
  render,
  restart: (opts) => { resetInput(); world = createWorld(opts); },
  snapshot: () => ({
    frame: world.frame,
    gameFrame: world.gameFrame,
    scene: world.scene,
    score: world.score,
    player: world.player && { x: world.player.x, y: world.player.y, alive: world.player.alive, lives: world.player.lives },
    boss: world.boss && { hp: world.boss.hp, maxHp: world.boss.maxHp, phase: world.boss.phase, defeated: world.boss.defeated },
    eShots: world.eShots.length,
    pShots: world.pShots.length,
  }),
};

if (headless && shotDef) {
  step(shotDef.frames);
  render();
  window.__harnessReady = true;
} else if (headless) {
  render();
  window.__harnessReady = true;
} else {
  let acc = 0;
  let last = performance.now();
  const loop = (now) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= DT) {
      step(1);
      acc -= DT;
    }
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__harnessReady = true;
}
