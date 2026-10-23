// Keyboard + gamepad (+ touch) → a flat per-frame input snapshot. Bots/tests write the
// same shape via world.input override (see main.js), so game code never reads
// devices directly.
//   { x:-1..1, y:-1..1, shot:bool, bomb:bool, bombPressed:bool, start:bool }
// Presses are latched on keydown so a tap that starts and ends between two
// simulation steps is still seen once.
//
// Robustness (owner report 2026-10-24: in Chrome the ship sometimes drifts up or
// only moves left/right):
//  - KEYBOARD WINS: while any direction key is held, gamepad/touch directions are ignored.
//  - A gamepad is ignored until it is ENGAGED (a button press, or a stick pushed well
//    away from its resting value). Resting axis values are captured per pad and
//    subtracted, with a larger dead zone, so a drifting stick or a device that merely
//    reports axes (wheels, adapters, virtual pads) can't steer the ship.
//  - IME composition key events are ignored; input resets on blur / tab hidden.
//  - ?inputdebug=1 shows the raw keyboard/pad state in a corner overlay.

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

let debugEl = null;

export function attachInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return; // IME
    if (!e.repeat) {
      if (BOMB_KEYS.has(e.code)) latchBomb = true;
      if (START_KEYS.has(e.code)) latchStart = true;
    }
    KEYS.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => KEYS.delete(e.code));
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
  const k = (c) => KEYS.has(c);
  const kx = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
  const ky = (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0);
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
    debugEl.textContent = dbg.join('\n');
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
