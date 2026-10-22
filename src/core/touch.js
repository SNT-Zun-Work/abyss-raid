// Touch controls for phones/tablets (lead-owned, DOM overlay — not drawn into the game canvas).
//   Move:  drag anywhere (except the buttons): the ship follows the finger's
//          RELATIVE motion (1:1 in game pixels × TOUCH_GAIN), so the finger never hides the ship.
//   Shot:  automatic while a finger is down (and stays on 0.5 s after release).
//   Burst: the round BURST button (right side bar, or bottom-right corner if no bar).
//   Full:  fullscreen button (left side bar, or bottom-left corner).
//   Start: tap anywhere on title/clear/game-over.
// readTouch() turns buffered finger motion into the same digital x/y snapshot the
// keyboard produces, so gameplay code needs no changes.

const TOUCH_GAIN = 1.25;
const SHOT_HOLD_MS = 500;

const state = {
  enabled: false,
  moveId: null,
  lastX: 0, lastY: 0,
  dx: 0, dy: 0,           // accumulated finger motion in game px since last read
  lastTouchT: 0,
  burstLatch: false,
  startLatch: false,
  scale: 1,               // css px per game px
};

export function touchActive() {
  return state.enabled;
}

export function setTouchScale(cssPerGamePx) {
  state.scale = cssPerGamePx || 1;
  layoutButtons();
}

// Put buttons in the black side bars when there is room, so they never cover the
// HUD or the playfield; otherwise fall back to translucent corners.
const ui = { burst: null, full: null };
function layoutButtons() {
  const { burst, full } = ui;
  if (!burst) return;
  const canvas = document.getElementById('screen');
  const r = canvas.getBoundingClientRect();
  const barR = innerWidth - r.right, barL = r.left;
  const size = Math.max(56, Math.min(84, Math.max(barR, barL) - 12));
  burst.style.width = burst.style.height = `${size}px`;
  if (barR >= 62) {
    burst.style.right = `${Math.max(4, (barR - size) / 2)}px`;
    burst.style.bottom = '18px';
    burst.style.opacity = '1';
  } else {
    burst.style.right = '12px';
    burst.style.bottom = '12px';
    burst.style.opacity = '0.6';
  }
  if (barL >= 56) {
    full.style.left = `${Math.max(4, (barL - 52) / 2)}px`;
    full.style.right = 'auto';
    full.style.top = '10px';
    full.style.bottom = 'auto';
    full.style.opacity = '1';
  } else {
    full.style.left = '8px';
    full.style.right = 'auto';
    full.style.top = 'auto';
    full.style.bottom = '8px';
    full.style.opacity = '0.6';
  }
}

function el(tag, css, text) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

export function attachTouch() {
  if (typeof window === 'undefined') return;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  state.enabled = true;

  const burst = el('button', [
    'position:fixed', 'right:max(16px, env(safe-area-inset-right))', 'bottom:max(16px, env(safe-area-inset-bottom))',
    'width:76px', 'height:76px', 'border-radius:50%', 'border:3px solid rgba(255,140,200,0.9)',
    'background:rgba(120,20,70,0.45)', 'color:#ffd6ec', 'font:700 13px/1 monospace', 'letter-spacing:1px',
    'z-index:10', 'touch-action:none', '-webkit-user-select:none', 'user-select:none',
  ].join(';'), 'BURST');
  burst.setAttribute('aria-label', 'Abyss burst');
  const full = el('button', [
    'position:fixed', 'right:max(12px, env(safe-area-inset-right))', 'top:max(12px, env(safe-area-inset-top))',
    'padding:6px 10px', 'border-radius:8px', 'border:1px solid rgba(255,255,255,0.4)',
    'background:rgba(0,0,0,0.4)', 'color:#fff', 'font:12px monospace', 'z-index:10', 'touch-action:none',
  ].join(';'), '⛶ FULL');
  full.setAttribute('aria-label', 'Fullscreen');
  const rotate = el('div', [
    'position:fixed', 'inset:0', 'display:none', 'align-items:center', 'justify-content:center', 'flex-direction:column',
    'background:#000', 'color:#fff', 'font:16px/1.6 monospace', 'text-align:center', 'z-index:20', 'padding:16px',
  ].join(';'));
  rotate.innerHTML = '<div style="font-size:42px">⟲</div><div>横向きにしてください<br>ROTATE YOUR PHONE</div>';
  full.textContent = '⛶';
  full.style.width = '52px';
  full.style.fontSize = '20px';
  document.body.append(burst, full, rotate);
  ui.burst = burst; ui.full = full;
  layoutButtons();

  const onBurst = (e) => { e.preventDefault(); e.stopPropagation(); state.burstLatch = true; state.lastTouchT = performance.now(); };
  burst.addEventListener('touchstart', onBurst, { passive: false });
  full.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {});
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (err) { /* iOS */ }
  }, { passive: false });

  const orient = () => { rotate.style.display = innerHeight > innerWidth ? 'flex' : 'none'; layoutButtons(); };
  addEventListener('resize', orient);
  orient();

  const area = document.body;
  area.addEventListener('touchstart', (e) => {
    e.preventDefault();
    state.startLatch = true;
    state.lastTouchT = performance.now();
    recordTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (state.moveId === null) {
      const t = e.changedTouches[0];
      state.moveId = t.identifier;
      state.lastX = t.clientX; state.lastY = t.clientY;
    }
  }, { passive: false });
  area.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== state.moveId) continue;
      state.dx += ((t.clientX - state.lastX) / state.scale) * TOUCH_GAIN;
      state.dy += ((t.clientY - state.lastY) / state.scale) * TOUCH_GAIN;
      state.lastX = t.clientX; state.lastY = t.clientY;
    }
    state.lastTouchT = performance.now();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === state.moveId) state.moveId = null;
    state.lastTouchT = performance.now();
  };
  area.addEventListener('touchend', end);
  area.addEventListener('touchcancel', end);
}

// Called once per simulation step from input.readInput().
// Returns {x, y, shot, bomb, start} in the same digital form as keyboard input.
// The ship moves at the same max speed as with keys (2 px/f), so finger motion is
// buffered and consumed over the next frames (fair parity with keyboard play).
const SPEED = 2;
const DEAD = 0.6;
export function readTouch() {
  if (!state.enabled) return null;
  const now = performance.now();
  // cap the buffer so a long flick doesn't keep drifting for a second
  state.dx = Math.max(-40, Math.min(40, state.dx));
  state.dy = Math.max(-40, Math.min(40, state.dy));
  const x = Math.abs(state.dx) > DEAD ? Math.sign(state.dx) : 0;
  const y = Math.abs(state.dy) > DEAD ? Math.sign(state.dy) : 0;
  const step = x && y ? 1.5 : SPEED;
  if (x) state.dx -= x * Math.min(Math.abs(state.dx), step);
  if (y) state.dy -= y * Math.min(Math.abs(state.dy), step);
  const out = {
    x, y,
    shot: state.moveId !== null || now - state.lastTouchT < SHOT_HOLD_MS,
    bomb: state.burstLatch,
    start: state.startLatch,
  };
  state.burstLatch = false;
  state.startLatch = false;
  return out;
}

// Last tap position in SCREEN game coordinates (0..W, 0..SCREEN_H; the HUD band is
// y < HUD_H), or null. Consumed on read. For UI hit-testing (e.g. title zone cards).
let lastTap = null;
export function readTap() {
  const t = lastTap;
  lastTap = null;
  return t;
}
function recordTap(clientX, clientY) {
  const c = document.getElementById('screen');
  if (!c) return;
  const r = c.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
  lastTap = { x: (clientX - r.left) / state.scale, y: (clientY - r.top) / state.scale };
}

export function resetTouch() {
  lastTap = null;
  state.dx = state.dy = 0;
  state.burstLatch = state.startLatch = false;
  state.moveId = null;
}
