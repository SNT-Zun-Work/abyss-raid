// WebAudio synthesized BGM + SFX (no external assets). Public API:
//   attach(target)          create AudioContext lazily on first user gesture (key / pointer / gamepad)
//   sfx(name)               fire-and-forget: 'shot','missile','hit','armHit','explodeS','explodeL','bossRoar',
//                           'warning','bomb','powerup','death','laserCharge','laserFire' (+ 'start','sonar','tick','tally','warningShort',
//                           event SFX 'pop'(arg=chain),'wipe','gillTear','stun','regrow' — fired from world.lastEvents)
//   onScene(world, scene)   switch music per scene
//   update(world)           per-frame hook: pumps the look-ahead sequencer (no-op without a context)
// Never throws when no AudioContext exists (headless captures): every entry point is guarded.
//
// Sequencer: songs are step lists (audio-songs.js); a Player schedules every step whose start time
// falls inside [now, now + LOOKAHEAD) against audioCtx.currentTime, so timing never drifts with
// frame rate. A 25 ms interval timer also pumps it so music survives frame hitches.
import { createEngine, VOICES, SFX, duckMusic, unduckMusic } from './audio-synth.js';
import { SONGS } from './audio-songs.js';

const LOOKAHEAD = 0.2;
const SCENE_SONG = { title: 'title', approach: 'approach', warning: null, boss: 'boss', clear: 'victory', gameover: 'gameover', continue: null, allclear: 'victory' };
// boss music per zone: [normal, final form]
const ZONE_SONGS = { V: ['boss', 'final'], G: ['mud', 'mudFinal'], M: ['mud', 'mudFinal'] };
const zoneSong = (world, final) => {
  // new zone G: second half (skip chase) uses the driving chase variant
  if (!final && world && world.zone === 'G' && world.boss && Number(world.boss.half) === 2) return 'mudChase';
  const z = ZONE_SONGS[(world && world.zone) || 'V'] || ZONE_SONGS.V;
  return z[final ? 1 : 0];
};

let ctx = null;
let E = null;
let attached = false;
let muted = false;
let wantSong = null;
let player = null;
let timer = null;
const lastSfx = new Map();
const songCache = new Map();

const getSong = (name) => {
  if (!songCache.has(name)) songCache.set(name, SONGS[name]());
  return songCache.get(name);
};

// ---------------------------------------------------------------- song player
// Exported for offline analysis (tools-free: used by scratch scripts via OfflineAudioContext).
export function createPlayer(engine, song, startTime, { fadeIn = 0.02 } = {}) {
  const c = engine.ctx;
  const bus = c.createGain();
  bus.gain.setValueAtTime(0, startTime);
  bus.gain.linearRampToValueAtTime(song.gain || 1, startTime + fadeIn);
  bus.connect(engine.music);
  const stepDur = 60 / song.bpm / 4;
  engine.delay.delayTime.setValueAtTime(stepDur * (song.delaySteps || 3), startTime);
  const byStep = [];
  for (const e of song.events) (byStep[e.s] || (byStep[e.s] = [])).push(e);
  const P = { song, bus, stepDur, pos: 0, next: startTime, done: false, loops: 0 };
  P.pump = (horizon, now = c.currentTime) => {
    if (P.done) return;
    if (P.next < now - 0.1) P.next = now + 0.02; // fell far behind (tab hidden) — resync, skip
    while (P.next < horizon) {
      const evs = byStep[P.pos];
      if (evs) for (const e of evs) {
        const v = VOICES[e.i];
        if (v) {
          try { v(engine, bus, P.next, e.n, e.l * stepDur, e.v, e.p); } catch (err) { /* never break the loop */ }
        }
      }
      P.pos++;
      P.next += stepDur;
      if (P.pos >= song.loopEnd) {
        if (song.loop) { P.pos = song.loopStart; P.loops++; } else { P.done = true; break; }
      }
    }
  };
  P.stop = (at = c.currentTime, fade = 0.35) => {
    P.done = true;
    try {
      bus.gain.cancelScheduledValues(at);
      bus.gain.setValueAtTime(bus.gain.value, at);
      bus.gain.linearRampToValueAtTime(0, at + fade);
      setTimeout(() => { try { bus.disconnect(); } catch (e) { /* ignore */ } }, (fade + 3) * 1000);
    } catch (e) { /* ignore */ }
  };
  return P;
}

function startSong(name) {
  if (!E) return;
  if (player) { player.stop(ctx.currentTime, 0.4); player = null; }
  if (!name || !SONGS[name]) return;
  player = createPlayer(E, getSong(name), ctx.currentTime + 0.06);
  player.pump(ctx.currentTime + LOOKAHEAD);
}

// switch song without changing the scene mapping (final form)
function playSong(name) {
  wantSong = name;
  if (E) startSong(name);
}

function pump() {
  if (!ctx || !player) return;
  try { player.pump(ctx.currentTime + LOOKAHEAD); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- context
function ensureContext() {
  if (ctx) {
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    return;
  }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
    E = createEngine(ctx);
    E.master.gain.value = muted ? 0 : 0.8;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    if (wantSong) startSong(wantSong);
    timer = setInterval(pump, 25);
  } catch (e) {
    ctx = null;
    E = null;
  }
}

export function setMuted(m) {
  muted = !!m;
  if (E) {
    const t = ctx.currentTime;
    E.master.gain.cancelScheduledValues(t);
    E.master.gain.setValueAtTime(E.master.gain.value, t);
    E.master.gain.linearRampToValueAtTime(muted ? 0 : 0.8, t + 0.08);
  }
}
export const isMuted = () => muted;

export function attach(target) {
  if (attached || !target || typeof target.addEventListener !== 'function') return;
  attached = true;
  const gesture = () => ensureContext();
  target.addEventListener('keydown', (e) => {
    ensureContext();
    if (e.code === 'KeyM' && !e.repeat) setMuted(!muted);
  });
  target.addEventListener('pointerdown', gesture);
  target.addEventListener('touchstart', gesture, { passive: true });
  target.addEventListener('gamepadconnected', gesture);
}

export function sfx(name, arg) {
  if (!E || muted) return;
  const def = SFX[name];
  if (!def) return;
  const now = ctx.currentTime;
  const last = lastSfx.get(name);
  if (last !== undefined && now - last < def[0]) return;
  lastSfx.set(name, now);
  try { def[1](E, E.sfx, now + 0.005, arg); } catch (e) { /* ignore */ }
}

export function onScene(world, scene) {
  if (scene === 'continue') return; // keep the fight music under the countdown
  let name = Object.prototype.hasOwnProperty.call(SCENE_SONG, scene) ? SCENE_SONG[scene] : null;
  if (scene === 'boss') name = zoneSong(world, world && world.boss && world.boss.phase >= 4);
  if (scene === 'boss' && name === wantSong && player && !player.done) return; // continue: keep the fight music running
  wantSong = name;
  if (E) {
    try { unduckMusic(E, ctx.currentTime); } catch (e) { /* ignore */ }
    startSong(name);
  }
}

// Fun-pass events (world.lastEvents: each event seen exactly once) -> SFX + music duck.
function handleEvents(world) {
  const evs = world && Array.isArray(world.lastEvents) ? world.lastEvents : null;
  if (!evs || !evs.length || !E) return;
  // several fish dying in one step: one representative pop at the max chain pitch + a short capped burst
  let kills = 0, maxChain = 0;
  for (const e of evs) if (e && e.type === 'fishKill') { kills++; maxChain = Math.max(maxChain, Number(e.chain) || 1); }
  if (kills === 1) sfx('pop', maxChain);
  else if (kills > 1) sfx('popBurst', { chain: maxChain, n: kills });
  for (const e of evs) {
    if (!e) continue;
    try {
      switch (e.type) {
        case 'schoolWiped': sfx('wipe'); break;
        case 'skimBonus': sfx('skim', Number(e.value) || 500); break;
        case 'gillKill': sfx(e.part === 'tail' ? 'segmentBreak' : 'gillTear'); break;
        case 'escape': sfx('mudErupt'); break;
        case 'gillRegrow': sfx('regrow'); break;
        case 'stunStart': sfx('stun'); duckMusic(E, ctx.currentTime, (Number(e.frames) || 240) / 60); break;
        case 'stunEnd': unduckMusic(E, ctx.currentTime); break;
        case 'attackStart':
          if (e.big) sfx(/giga/i.test(String(e.cause || '') + String(e.name || '')) ? 'gigaCharge' : 'riser');
          break;
        case 'phaseChange':
          if (Number(e.to) === 4) { sfx('bossRoar'); playSong(zoneSong(world, true)); }
          else if (Number(e.to) === 2 && world && world.zone === 'G' && world.boss && world.boss.half !== undefined) playSong('mudChase');
          break;
        case 'playerDeath': break; // 'death' sfx is fired by the player module
      }
    } catch (err) { /* never break the game loop */ }
  }
}

export function update(world) {
  if (world) world.muted = muted;
  handleEvents(world);
  if (attached && !ctx && typeof navigator !== 'undefined' && navigator.getGamepads) {
    try {
      for (const p of navigator.getGamepads()) if (p && p.buttons.some((b) => b.pressed)) { ensureContext(); break; }
    } catch (e) { /* ignore */ }
  }
  pump();
}
