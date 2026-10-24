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
//   ?kit=max         start kit: every gauge Lv8 + full shield + burst 3 (combat v2b playtests);
//   ?lv=N (all three weapons), ?laser=N ?wave=N ?homing=N ?shield=N ?burst=N override single fields,
//   ?lock=1 items never change weapon levels (DPS measurement)
//   touch (see core/touch.js): ?touch=1 force touch mode, ?layout=auto|side|portrait|classic,
//   ?pad=left|right|off, ?gain=1.0|1.25|1.5|2.0
//
// Test hooks on window.__game: { world, step(n), snapshot() }.

import { W, SCREEN_H as H, DT, SHOTS } from './config.js';
import { attachInput, readInput, resetInput } from './core/input.js';
import { attachTouch, fitTouch, setTouchScale, touchActive, touchPaused, touchSettings } from './core/touch.js';
import { createWorld, stepWorld, drawWorld } from './game/world.js';
import { botInput } from './game/bot.js';
import { killPlayer } from './game/player.js';
import * as audio from './game/audio.js';
import { loadVisualAssets } from './game/g-visual-assets.js';
import { loadAxolotlAssets } from './game/v-visual-assets.js';
import { loadPresentationArt } from './game/ui-presentation-visual.js';
import { loadPlayerVisual } from './game/player-visual.js';

if (new URLSearchParams(location.search).get('visual') !== '0') await Promise.all([loadVisualAssets(), loadAxolotlAssets(), loadPresentationArt(), loadPlayerVisual()]);
document.getElementById('loading')?.remove();

const params = new URLSearchParams(location.search);
const shotDef = params.get('shot') ? SHOTS.find((s) => s.id === params.get('shot')) : null;
const headless = params.has('headless');
const botParam = params.get('bot');
const useBot = botParam === '1' || botParam === '2' || botParam === '3' || botParam === '4' || botParam === '5' || botParam === '6' || (shotDef && shotDef.bot);
const botProfile = botParam === '2' ? 'human' : botParam === '3' ? 'camper' : botParam === '4' ? 'midcamper' : botParam === '5' ? 'skimcamper' : botParam === '6' ? 'watercamper' : 'perfect';

const display = document.getElementById('screen');
const dctx = display.getContext('2d');
const low = document.createElement('canvas');
low.width = W;
low.height = H;
const lctx = low.getContext('2d');

const seedParam = Number(params.get('seed'));
// start-kit override (shots may define one too: shotDef.kit)
const numP = (k) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : undefined);
const KIT_KEYS = ['kit', 'lv', 'laser', 'wave', 'homing', 'shield', 'burst', 'lock'];
const kitParam = (shotDef && shotDef.kit) || (KIT_KEYS.some((k) => params.has(k))
  ? { max: params.get('kit') === 'max', lv: numP('lv'), laser: numP('laser'), wave: numP('wave'), homing: numP('homing'), shield: numP('shield'), burst: numP('burst'), lock: params.get('lock') === '1' } : null);
let world = createWorld({
  kit: kitParam,
  seed: params.has('seed') && Number.isInteger(seedParam) ? seedParam : 1,
  scene: (shotDef && shotDef.scene) || params.get('scene') || 'title',
  zone: (shotDef && shotDef.zone) || (params.get('zone') || 'V').toUpperCase(),
  bossHpFrac: shotDef && shotDef.bossHpFrac !== undefined ? shotDef.bossHpFrac : Number(params.get('hp') || 1),
});

attachInput();
if (!headless) attachTouch({ relayout: fit });
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
  // Touch devices: side-pad / portrait / classic layouts (core/touch.js sizes and places the
  // canvas and the DOM controls; desktop keeps the sizing below).
  if (fitTouch(display, W, H)) return;
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
  touch: () => (touchActive() ? touchSettings() : null), // touch layout/settings (tools/touch-layout-check.mjs)
  render,
  forceDeath: () => { const p = world.player; if (!p || !p.alive) return false; killPlayer(world, 'forced'); return !p.alive; },
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
      if (!touchPaused()) step(1); // touch settings panel open → simulation paused
      acc -= DT;
    }
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__harnessReady = true;
}
