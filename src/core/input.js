
import { readTouch, resetTouch } from './touch.js';

const KEYS = new Set();
let prevBomb = false;
let prevStart = false;
let latchBomb = false;
let latchStart = false;
const BOMB_KEYS = new Set(['KeyH', 'KeyX']);
const START_KEYS = new Set(['Enter', 'Space', 'KeyG', 'KeyZ']);
const DEAD = 0.5;          // stick dead zone after removing the resting offset
const ENGAGE = 0.75;       // a stick must move this far from rest to engage the pad
const padState = new Map(); // pad.index → { id, rest: [ax, ay], engaged }

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyG', 'KeyH', 'KeyZ', 'KeyX', 'Space', 'Enter', 'KeyM']);

const DIR_KEYS = { L: ['ArrowLeft', 'KeyA'], R: ['ArrowRight', 'KeyD'], U: ['ArrowUp', 'KeyW'], D: ['ArrowDown', 'KeyS'] };
const DIR_OF = {};
for (const [d, codes] of Object.entries(DIR_KEYS)) for (const c of codes) DIR_OF[c] = d;
const OPPOSITE = { L: 'R', R: 'L', U: 'D', D: 'U' };
const pressSeq = new Map(); // direction key → order of its last fresh press (last pressed wins)
let seq = 0;

// Lost key-up watchdog. The OS auto-repeats only the most recently pressed key, so while that key
// is held its keydown(repeat) events keep arriving every ~30-100 ms. If it is still marked down but
// nothing has arrived for STALE_MS, its key-up was lost: release it. Enabled only after a repeat
// event has been seen (proves auto-repeat is on; with repeat disabled a long hold must not stop).
const STALE_MS = 1100;
let lastFresh = null;        // code of the most recent non-repeat keydown (any key)
const lastSeen = new Map();  // code → time of its latest keydown (incl. repeats)
let repeatSeen = false;
let anomalies = 0, lastAnomaly = '';

let debugEl = null;
const keyLog = []; // last raw key events, shown by ?inputdebug=1
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function logKey(kind, e) {
  if (!debugEl) return;
  keyLog.push(`${(now() / 1000).toFixed(2)} ${kind} ${e.code || '?'} key=${e.key ?? ''} kc=${e.keyCode ?? ''}${e.isComposing ? ' COMPOSING' : ''}${e.repeat ? ' rep' : ''}`);
  if (keyLog.length > 12) keyLog.shift();
}
// ?inputdebug=1 also watches the display loop: a stalled frame feels like a control glitch too
let hitches = 0, worstGap = 0, lastHitch = '';
function watchFrames() {
  let prev = 0;
  const tick = (t) => {
    if (prev && !document.hidden) {
      const gap = t - prev;
      if (gap > 40) { hitches++; worstGap = Math.max(worstGap, gap); lastHitch = `${(t / 1000).toFixed(2)} (${gap.toFixed(0)} ms)`; }
    }
    prev = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function anomaly(msg) {
  anomalies++;
  lastAnomaly = `${(now() / 1000).toFixed(2)} ${msg}`;
}

export function attachInput(target = window) {
  const opt = { capture: true }; // see events before any page/extension handler in the bubble phase
  target.addEventListener('keydown', (e) => {
    logKey('down', e);
    if (e.repeat) repeatSeen = true;
    if (!e.repeat) {
      if (KEYS.has(e.code)) anomaly(`fresh press of ${e.code} while still marked down (its key-up was lost)`);
      lastFresh = e.code;
    }
    lastSeen.set(e.code, now());
    // With a Japanese IME switched on, Chrome/Windows reports letter keys as key 'Process' /
    // keyCode 229 while e.code is still the physical key. Ignoring those made G/H/WASD (and,
    // once a composition started, the arrows) stop working until another key cleared it.
    // So game keys are accepted by e.code whatever the IME says; only non-game keys are skipped.
    const ime = e.isComposing || e.key === 'Process' || e.keyCode === 229;
    if (ime && !GAME_KEYS.has(e.code)) return;
    if (ime) e.preventDefault(); // keep the IME from starting a composition on game keys
    if (!e.repeat) {
      if (BOMB_KEYS.has(e.code)) latchBomb = true;
      if (START_KEYS.has(e.code)) latchStart = true;
    }
    KEYS.add(e.code);
    if (!e.repeat && DIR_OF[e.code]) pressSeq.set(e.code, ++seq);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  }, opt);
  target.addEventListener('keyup', (e) => {
    logKey('up', e);
    KEYS.delete(e.code);
    const d = DIR_OF[e.code];
    if (d) {
      const mine = pressSeq.get(e.code) || 0;
      for (const c of DIR_KEYS[OPPOSITE[d]]) if (KEYS.has(c) && (pressSeq.get(c) || 0) < mine) KEYS.delete(c);
    }
  }, opt);
  // an IME composition that starts anyway would swallow later key events: drop held keys then
  target.addEventListener('compositionstart', () => { logKey('comp', { code: 'start' }); KEYS.clear(); });
  target.addEventListener('blur', resetInput);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('gamepaddisconnected', (e) => padState.delete(e.gamepad.index));
    if (new URLSearchParams(location.search).get('inputdebug') === '1') {
      debugEl = document.createElement('pre');
      debugEl.style.cssText = 'position:fixed;left:4px;bottom:4px;margin:0;padding:4px 6px;background:rgba(0,0,0,.7);color:#9f9;font:11px monospace;z-index:50;pointer-events:none';
      document.body.appendChild(debugEl);
      watchFrames();
    }
  }
}

export function resetInput() {
  KEYS.clear();
  prevBomb = prevStart = latchBomb = latchStart = false;
  resetTouch();
}

function readPad(p) {
  let st = padState.get(p.index);
  if (!st || st.id !== p.id) {
    st = { id: p.id, rest: [p.axes[0] || 0, p.axes[1] || 0], engaged: false };
    padState.set(p.index, st);
  }
  const ax = (p.axes[0] || 0) - st.rest[0], ay = (p.axes[1] || 0) - st.rest[1];
  const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
  if (!st.engaged && (p.buttons.some((bt) => bt && bt.pressed) || Math.abs(ax) > ENGAGE || Math.abs(ay) > ENGAGE)) st.engaged = true;
  if (!st.engaged) return null;
  let x = Math.abs(ax) > DEAD ? Math.sign(ax) : 0;
  let y = Math.abs(ay) > DEAD ? Math.sign(ay) : 0;
  if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
  return { x, y, shot: b(0) || b(2), bomb: b(1) || b(3), start: b(9) || b(0), raw: [p.axes[0] || 0, p.axes[1] || 0] };
}

export function readInput() {
  if (repeatSeen && lastFresh && KEYS.has(lastFresh) && now() - (lastSeen.get(lastFresh) || 0) > STALE_MS) {
    anomaly(`watchdog released ${lastFresh} (no repeat for ${STALE_MS} ms)`);
    KEYS.delete(lastFresh);
  }
  const k = (c) => KEYS.has(c);
  // per axis: if both directions are held, the most recently pressed one wins (no dead stop)
  const held = (d) => DIR_KEYS[d].reduce((m, c) => (KEYS.has(c) ? Math.max(m, pressSeq.get(c) || 1) : m), 0);
  const axis = (neg, pos) => { const a = held(neg), b = held(pos); return !a && !b ? 0 : b > a ? 1 : -1; };
  const kx = axis('L', 'R');
  const ky = axis('U', 'D');
  const keyDir = k('ArrowRight') || k('KeyD') || k('ArrowLeft') || k('KeyA') || k('ArrowDown') || k('KeyS') || k('ArrowUp') || k('KeyW');
  let x = kx, y = ky;
  let shot = k('KeyG') || k('Space') || k('KeyZ');
  let bomb = k('KeyH') || k('KeyX');
  let start = k('Enter') || k('Space') || k('KeyG') || k('KeyZ');

  const dbg = debugEl ? [] : null;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const r = readPad(p);
    if (dbg) {
      const st = padState.get(p.index);
      dbg.push(`pad${p.index} ${p.id.slice(0, 28)} axes ${(p.axes[0] || 0).toFixed(2)},${(p.axes[1] || 0).toFixed(2)} rest ${st.rest.map((v) => v.toFixed(2))} ${st.engaged ? 'ENGAGED' : 'ignored'}`);
    }
    if (!r) continue;
    if (!keyDir) { if (r.x) x = r.x; if (r.y) y = r.y; }
    shot ||= r.shot;
    bomb ||= r.bomb;
    start ||= r.start;
  }
  const t = readTouch();
  if (t) {
    if (!keyDir && (t.x || t.y)) { x = t.x; y = t.y; }
    shot ||= t.shot;
    if (t.bomb) latchBomb = true;
    if (t.start) latchStart = true;
  }
  if (dbg) {
    dbg.unshift(`keys ${[...KEYS].join(' ') || '-'}  →  x ${x} y ${y}${shot ? ' SHOT' : ''}`);
    dbg.push(`frame hitches >40ms: ${hitches} (worst ${worstGap.toFixed(0)} ms${lastHitch ? ', last at ' + lastHitch : ''})`);
    dbg.push(`anomalies ${anomalies}${lastAnomaly ? '  last: ' + lastAnomaly : ''}  (repeat ${repeatSeen ? 'on' : '?'})`);
    debugEl.textContent = dbg.concat(keyLog).join('\n');
  }
  const snap = {
    x, y, shot, bomb,
    bombPressed: (bomb && !prevBomb) || latchBomb,
    start: (start && !prevStart) || latchStart,
  };
  prevBomb = bomb;
  prevStart = start;
  latchBomb = latchStart = false;
  return snap;
}
