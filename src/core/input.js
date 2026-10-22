// Keyboard + gamepad → a flat per-frame input snapshot. Bots/tests write the
// same shape via world.input override (see main.js), so game code never reads
// devices directly.
//   { x:-1..1, y:-1..1, shot:bool, bomb:bool, bombPressed:bool, start:bool }
// Presses are latched on keydown so a tap that starts and ends between two
// simulation steps is still seen once.

import { readTouch, resetTouch } from './touch.js';

const KEYS = new Set();
let prevBomb = false;
let prevStart = false;
let latchBomb = false;
let latchStart = false;
const BOMB_KEYS = new Set(['KeyH', 'KeyX']);
const START_KEYS = new Set(['Enter', 'Space', 'KeyG', 'KeyZ']);

export function attachInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (!e.repeat) {
      if (BOMB_KEYS.has(e.code)) latchBomb = true;
      if (START_KEYS.has(e.code)) latchStart = true;
    }
    KEYS.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => KEYS.delete(e.code));
  target.addEventListener('blur', resetInput);
}

export function resetInput() {
  KEYS.clear();
  prevBomb = prevStart = latchBomb = latchStart = false;
  resetTouch();
}

export function readInput() {
  const k = (c) => KEYS.has(c);
  let x = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
  let y = (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0);
  let shot = k('KeyG') || k('Space') || k('KeyZ');
  let bomb = k('KeyH') || k('KeyX');
  let start = k('Enter') || k('Space') || k('KeyG') || k('KeyZ');

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (Math.abs(ax) > 0.35) x = Math.sign(ax);
    if (Math.abs(ay) > 0.35) y = Math.sign(ay);
    const b = (i) => p.buttons[i] && p.buttons[i].pressed;
    if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
    shot ||= b(0) || b(2);
    bomb ||= b(1) || b(3);
    start ||= b(9) || b(0);
  }
  const t = readTouch();
  if (t) {
    if (t.x || t.y) { x = t.x; y = t.y; }
    shot ||= t.shot;
    if (t.bomb) latchBomb = true;
    if (t.start) latchStart = true;
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
