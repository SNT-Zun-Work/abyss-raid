
const GAINS = [1.0, 1.25, 1.5, 2.0];
const LAYOUTS = ['auto', 'side', 'classic'];
const STORE_KEY = 'axarius.touch';

const state = {
  enabled: false,
  moveId: null,
  moveOnPad: false,
  lastX: 0, lastY: 0,
  dx: 0, dy: 0,           // accumulated finger motion in game px since last read
  lastTouchT: 0,
  burstLatch: false,
  startLatch: false,
  scale: 1,               // css px per game px
  mode: 'classic',        // resolved layout: side | portrait | classic
  layout: null,           // last computed rects (css px)
  paused: false,          // settings panel open
};

const settings = { layout: 'auto', side: 'right', gain: null }; // gain null → layout default

const ui = { burst: null, full: null, gear: null, pad: null, padLabel: null, dot: null, hint: null, panel: null, probe: null };
let relayout = () => {};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (LAYOUTS.includes(s.layout)) settings.layout = s.layout;
      if (s.side === 'left' || s.side === 'right') settings.side = s.side;
      if (GAINS.includes(s.gain)) settings.gain = s.gain;
    }
  } catch (e) { /* storage unavailable */ }
  try {
    const q = new URLSearchParams(location.search);
    const pad = q.get('pad');
    if (pad === 'left' || pad === 'right') settings.side = pad;
    if (pad === 'off') settings.layout = 'classic';
    const lay = q.get('layout');
    if (lay === 'portrait' || LAYOUTS.includes(lay)) settings.layout = lay;
    const g = Number(q.get('gain'));
    if (q.has('gain') && Number.isFinite(g) && g > 0 && g <= 4) settings.gain = g;
  } catch (e) { /* no URL */ }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

function gain() {
  return settings.gain ?? (state.mode === 'classic' ? 1.25 : 1.5);
}

export function touchActive() {
  return state.enabled;
}
export function touchPaused() {
  return state.enabled && state.paused;
}
// Resolved layout ('side' | 'portrait' | 'classic') or null without touch. Test/debug hook.
export function touchMode() {
  return state.enabled ? state.mode : null;
}
export function touchSettings() {
  return { ...settings, gain: gain(), mode: state.mode };
}

// Kept for compatibility: the scale is normally set by fitTouch().
export function setTouchScale(cssPerGamePx) {
  state.scale = cssPerGamePx || 1;
}

// ---------------------------------------------------------------- layout
function safeInsets() {
  const p = ui.probe;
  if (!p) return { l: 0, r: 0, t: 0, b: 0 };
  const cs = getComputedStyle(p);
  const n = (v) => parseFloat(v) || 0;
  return { l: n(cs.paddingLeft), r: n(cs.paddingRight), t: n(cs.paddingTop), b: n(cs.paddingBottom) };
}

function resolveMode(vw, vh) {
  const L = settings.layout;
  if (L === 'classic') return 'classic';
  if (L === 'portrait') return 'portrait';
  return vh > vw ? 'portrait' : 'side'; // 'side' in an upright viewport → the portrait pad layout
}

// Snap the CSS width so each game pixel is a whole number of device pixels when that costs
// little (≤ 8% of the size) — crisp pixels; otherwise keep the fractional size.
function snapWidth(cw, W, dpr) {
  const k = (cw / W) * dpr;
  const f = Math.floor(k);
  if (f >= 2 && (k - f) / k <= 0.08) return (f * W) / dpr;
  return cw;
}

// Pure layout computation (css px). Returns rects for the canvas and every control.
function computeLayout(vw, vh, ins, W, H, dpr) {
  const mode = resolveMode(vw, vh);
  const aspect = W / H;
  const x0 = ins.l, x1 = vw - ins.r, y0 = ins.t, y1 = vh - ins.b;
  const AW = x1 - x0, AH = y1 - y0;
  const out = { mode, canvas: null, pad: null, burst: null, full: null, gear: null, hint: null };
  const side = settings.side;

  if (mode === 'side') {
    const padMin = Math.round(Math.min(AW * 0.4, Math.max(120, vw * 0.22)));
    const barMin = 76;
    // prefer BURST in the opposite bar (two-thumb grip) while the game keeps ≥ 80% of the height
    let cw = Math.min(AW - padMin - barMin, AH * aspect);
    const burstInBar = cw / aspect >= vh * 0.8;
    if (!burstInBar) cw = Math.min(AW - padMin, AH * aspect);
    cw = Math.floor(snapWidth(cw, W, dpr));
    const ch = Math.floor(cw / aspect);
    const slack = AW - padMin - cw - (burstInBar ? barMin : 0);
    const barW = burstInBar ? barMin + Math.floor(slack / 2) : 0;
    const padW = padMin + slack - (burstInBar ? Math.floor(slack / 2) : 0);
    const cy = Math.round(y0 + (AH - ch) / 2);
    // order (pad right): [safe-l][bar][canvas][pad][safe-r]; mirrored for a left pad
    let barX, canvasX, padX;
    if (side === 'right') { barX = x0; canvasX = x0 + barW; padX = canvasX + cw; }
    else { padX = x0; canvasX = x0 + padW; barX = canvasX + cw; }
    out.canvas = { x: canvasX, y: cy, w: cw, h: ch };
    // the visible pad runs to the physical screen edge so it is easy to find without looking
    const outerX = side === 'right' ? padX : 0;
    const outerW = side === 'right' ? vw - padX : padX + padW;
    out.pad = { x: outerX + 4, y: 4, w: outerW - 8, h: vh - 8 };
    const btn = 40; // gear / fullscreen
    if (burstInBar) {
      const bs = Math.max(64, Math.min(104, barW - 12));
      out.burst = { x: barX + (barW - bs) / 2, y: Math.round(y0 + AH * 0.62 - bs / 2), w: bs, h: bs };
      out.full = { x: barX + (barW - btn) / 2, y: y0 + 8, w: btn, h: btn };
      out.gear = { x: barX + (barW - btn) / 2, y: y0 + 8 + btn + 8, w: btn, h: btn };
    } else {
      const bs = Math.max(64, Math.min(96, padW - 24));
      out.burst = { x: padX + (padW - bs) / 2, y: y1 - bs - 12, w: bs, h: bs };
      const gx = side === 'right' ? padX + padW - btn - 8 : padX + 8;
      const fx = side === 'right' ? gx - btn - 8 : gx + btn + 8;
      out.gear = { x: gx, y: y0 + 10, w: btn, h: btn };
      out.full = { x: fx, y: y0 + 10, w: btn, h: btn };
    }
  } else if (mode === 'portrait') {
    const toolbar = 44;
    const minPad = Math.max(150, AH * 0.3);
    let cw = Math.min(AW, (AH - toolbar - minPad) * aspect);
    cw = Math.floor(snapWidth(cw, W, dpr));
    const ch = Math.floor(cw / aspect);
    const cx = Math.round(x0 + (AW - cw) / 2);
    out.canvas = { x: cx, y: y0, w: cw, h: ch };
    const ty = y0 + ch;
    const btn = 36;
    out.full = { x: x1 - btn - 8, y: ty + (toolbar - btn) / 2, w: btn, h: btn };
    out.gear = { x: x1 - 2 * btn - 16, y: ty + (toolbar - btn) / 2, w: btn, h: btn };
    out.hint = { x: x0 + 10, y: ty + (toolbar - 16) / 2, w: Math.max(0, AW - 2 * btn - 40), h: 16 };
    out.pad = { x: x0 + 6, y: ty + toolbar, w: AW - 12, h: y1 - (ty + toolbar) - 6 };
    const bs = Math.round(Math.max(76, Math.min(112, AW * 0.26)));
    const bx = side === 'right' ? out.pad.x + 14 : out.pad.x + out.pad.w - bs - 14;
    out.burst = { x: bx, y: out.pad.y + out.pad.h - bs - 14, w: bs, h: bs };
  } else {
    // classic: the game fills the screen; controls in the black bars or translucent corners
    const fitS = Math.min(vw / W, vh / H);
    const s = Math.floor(fitS);
    const cssS = fitS >= 2 && fitS - s < 0.5 ? s : fitS;
    const cw = Math.floor(W * cssS), ch = Math.floor(H * cssS);
    const cx = Math.round((vw - cw) / 2), cy = Math.round((vh - ch) / 2);
    out.canvas = { x: cx, y: cy, w: cw, h: ch };
    const barR = vw - (cx + cw) - ins.r, barL = cx - ins.l;
    const bs = Math.max(56, Math.min(84, Math.max(barR, barL) - 12));
    out.burst = barR >= 62
      ? { x: x1 - Math.max(4, (barR - bs) / 2) - bs, y: y1 - 18 - bs, w: bs, h: bs, dim: false }
      : { x: x1 - 12 - bs, y: y1 - 12 - bs, w: bs, h: bs, dim: true };
    const btn = 44;
    if (barL >= 56) {
      const fx = x0 + Math.max(4, (barL - btn) / 2);
      out.full = { x: fx, y: y0 + 10, w: btn, h: btn };
      out.gear = { x: fx, y: y0 + 10 + btn + 8, w: btn, h: btn };
    } else {
      out.full = { x: x0 + 8, y: y1 - 8 - btn, w: btn, h: btn, dim: true };
      out.gear = { x: x0 + 8, y: y1 - 16 - 2 * btn, w: btn, h: btn, dim: true };
    }
    if (vh > vw) out.hint = { x: x0 + 10, y: cy + ch + 10, w: AW - 20, h: 16 };
  }
  return out;
}

function place(e, r) {
  if (!e) return;
  if (!r) { e.style.display = 'none'; return; }
  e.style.display = '';
  e.style.left = `${Math.round(r.x)}px`;
  e.style.top = `${Math.round(r.y)}px`;
  e.style.width = `${Math.round(r.w)}px`;
  e.style.height = `${Math.round(r.h)}px`;
}

// Size + position the canvas for touch devices. Returns false when touch mode is off
// (the caller keeps its desktop sizing).
export function fitTouch(display, W, H) {
  if (!state.enabled || !display) return false;
  const vw = innerWidth, vh = innerHeight;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const L = computeLayout(vw, vh, safeInsets(), W, H, dpr);
  state.mode = L.mode;
  state.layout = L;
  const c = L.canvas;
  const cssS = c.w / W;
  // backing store: whole device pixels per game pixel (≤ 4×), nearest-neighbour upscale
  const bs = Math.max(1, Math.min(4, Math.ceil(cssS * dpr - 0.05)));
  if (display.width !== W * bs) { display.width = W * bs; display.height = H * bs; }
  display.style.position = 'fixed';
  place(display, c);
  state.scale = cssS;
  place(ui.pad, L.pad);
  place(ui.burst, L.burst);
  place(ui.full, L.full);
  place(ui.gear, L.gear);
  place(ui.hint, L.hint);
  if (ui.burst && L.burst) {
    ui.burst.style.opacity = L.burst.dim ? '0.6' : '1';
    ui.burst.style.fontSize = `${Math.round(Math.max(13, L.burst.w / 5.5))}px`;
  }
  for (const e of [ui.full, ui.gear]) if (e) e.style.opacity = L.full && L.full.dim ? '0.6' : '1';
  if (ui.hint) ui.hint.textContent = '⟲ 横向きで大画面 / ROTATE FOR A BIGGER VIEW';
  if (ui.panel && ui.panel.style.display !== 'none') renderPanel();
  return true;
}

// ---------------------------------------------------------------- DOM
function el(tag, css, text) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

// a control that reacts on touchstart (fast, no click synthesis delay) and on click (mouse)
function onPress(e, fn) {
  e.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(ev); }, { passive: false });
  e.addEventListener('click', (ev) => { ev.stopPropagation(); fn(ev); });
}

const gainLabel = (g) => `${g === 1.25 ? '1.25' : g.toFixed(1)}×`;

function renderPanel() {
  const p = ui.panel;
  p.innerHTML = '';
  p.append(el('div', 'font:700 15px/1 monospace;letter-spacing:2px;color:#8fe8ff;margin-bottom:6px', 'TOUCH SETTINGS'));
  const row = (label, opts, cur, set) => {
    const r = el('div', 'margin:10px 0');
    r.append(el('div', 'font:12px/1 monospace;color:#9ab;margin-bottom:6px', label));
    const g = el('div', 'display:flex;gap:6px;flex-wrap:wrap');
    for (const [v, txt] of opts) {
      const on = v === cur;
      const b = el('button', [
        'min-width:56px', 'height:40px', 'padding:0 10px', 'border-radius:8px', 'font:700 13px monospace',
        `border:2px solid ${on ? '#8fe8ff' : 'rgba(255,255,255,0.25)'}`,
        `background:${on ? 'rgba(40,120,160,0.6)' : 'rgba(255,255,255,0.06)'}`, 'color:#fff', 'touch-action:none',
      ].join(';'), txt);
      b.dataset.opt = `${label}:${v}`;
      onPress(b, () => { set(v); saveSettings(); relayout(); renderPanel(); });
      g.append(b);
    }
    r.append(g);
    p.append(r);
  };
  row('LAYOUT', [['auto', 'AUTO'], ['side', 'SIDE PAD'], ['classic', 'CLASSIC']],
    settings.layout === 'portrait' ? 'auto' : settings.layout, (v) => { settings.layout = v; });
  row('PAD SIDE', [['left', 'LEFT'], ['right', 'RIGHT']], settings.side, (v) => { settings.side = v; });
  row('SENSITIVITY', GAINS.map((g) => [g, gainLabel(g)]), gain(), (v) => { settings.gain = v; });
  p.append(el('div', 'font:11px/1.5 monospace;color:#789;margin-top:8px',
    `NOW: ${state.mode.toUpperCase()} · AUTO = SIDE PAD (landscape) / PAD BELOW (portrait). Dragging on the game also moves.`));
  const close = el('button', [
    'margin-top:12px', 'width:100%', 'height:44px', 'border-radius:10px', 'border:2px solid #8fe8ff',
    'background:rgba(20,60,90,0.8)', 'color:#fff', 'font:700 15px monospace', 'letter-spacing:2px', 'touch-action:none',
  ].join(';'), 'CLOSE ▶');
  close.id = 'touch-settings-close';
  onPress(close, () => toggleSettings(false));
  p.append(close);
}

function toggleSettings(open) {
  const show = open ?? ui.panel.style.display === 'none';
  ui.panel.style.display = show ? 'block' : 'none';
  resetTouch();
  state.paused = show;
  if (show) renderPanel();
}

export function attachTouch(opts = {}) {
  if (typeof window === 'undefined') return;
  const forced = /[?&]touch=1\b/.test(location.search);
  const isTouch = forced || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  state.enabled = true;
  if (typeof opts.relayout === 'function') relayout = opts.relayout;
  loadSettings();

  // safe-area probe (env() insets read back through computed padding)
  const probe = el('div', 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)');

  const pad = el('div', [
    'position:fixed', 'box-sizing:border-box', 'border:1px solid rgba(120,200,255,0.2)', 'border-radius:14px',
    'background-color:rgba(20,40,60,0.2)',
    'background-image:linear-gradient(rgba(120,200,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(120,200,255,0.07) 1px,transparent 1px)',
    'background-size:32px 32px', 'background-position:center', 'z-index:1', 'pointer-events:none', 'overflow:hidden',
  ].join(';'));
  pad.id = 'touch-pad';
  const padLabel = el('div', 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;' +
    'font:700 14px/1.5 monospace;letter-spacing:4px;color:rgba(160,220,255,0.25)');
  padLabel.innerHTML = '✥<br>MOVE';
  pad.append(padLabel);
  const dot = el('div', 'position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;box-sizing:border-box;' +
    'border:2px solid rgba(160,230,255,0.45);display:none;pointer-events:none;z-index:2');

  const burst = el('button', [
    'position:fixed', 'box-sizing:border-box', 'border-radius:50%', 'border:3px solid rgba(255,140,200,0.9)',
    'background:rgba(120,20,70,0.5)', 'color:#ffd6ec', 'font:700 15px/1 monospace', 'letter-spacing:1px', 'padding:0',
    'z-index:10', 'touch-action:none', '-webkit-user-select:none', 'user-select:none',
  ].join(';'), 'BURST');
  burst.id = 'touch-burst';
  burst.setAttribute('aria-label', 'Abyss burst');
  const smallBtn = 'position:fixed;box-sizing:border-box;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,0.35);' +
    'background:rgba(0,0,0,0.45);color:#fff;font:20px/1 monospace;z-index:10;touch-action:none';
  const full = el('button', smallBtn, '⛶');
  full.id = 'touch-full';
  full.setAttribute('aria-label', 'Fullscreen');
  const gear = el('button', smallBtn, '⚙');
  gear.id = 'touch-gear';
  gear.setAttribute('aria-label', 'Touch settings');
  const hint = el('div', 'position:fixed;font:11px/16px monospace;color:rgba(255,255,255,0.4);white-space:nowrap;overflow:hidden;' +
    'text-overflow:ellipsis;pointer-events:none;z-index:3');
  hint.id = 'touch-hint';
  const panel = el('div', [
    'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)', 'display:none',
    'width:min(340px, calc(100vw - 32px))', 'max-height:calc(100vh - 24px)', 'overflow:auto', 'box-sizing:border-box',
    'padding:16px', 'border-radius:14px', 'border:1px solid rgba(143,232,255,0.5)', 'background:rgba(4,10,22,0.94)',
    'color:#fff', 'z-index:40', 'touch-action:none',
  ].join(';'));
  panel.id = 'touch-settings';
  // touches inside the panel never reach the game
  for (const ev of ['touchstart', 'touchmove', 'touchend']) panel.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });

  document.body.append(probe, pad, dot, burst, full, gear, hint, panel);
  Object.assign(ui, { burst, full, gear, pad, padLabel, dot, hint, panel, probe });

  onPress(burst, () => { if (state.paused) return; state.burstLatch = true; state.lastTouchT = performance.now(); });
  onPress(full, () => {
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {});
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    // lock only in the side-pad layout; portrait players keep free rotation
    try { if (state.mode === 'side' && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (err) { /* iOS */ }
  });
  onPress(gear, () => toggleSettings());

  // live layout on resize / rotation (some browsers report the new size a little late)
  let t1 = 0;
  const onResize = () => { relayout(); clearTimeout(t1); t1 = setTimeout(relayout, 250); };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);
  if (window.visualViewport) visualViewport.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);

  const onPad = (x, y) => {
    const r = state.layout && state.layout.pad;
    return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  };
  const showDot = (x, y) => { dot.style.display = 'block'; dot.style.left = `${x}px`; dot.style.top = `${y}px`; };
  const area = document.body;
  area.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.paused) return;
    state.startLatch = true;
    state.lastTouchT = performance.now();
    const t0 = e.changedTouches[0];
    recordTap(t0.clientX, t0.clientY);
    for (const t of e.changedTouches) {
      const padHit = onPad(t.clientX, t.clientY);
      // the first finger moves; a finger landing on the pad takes over from a playfield finger
      if (state.moveId === null || (padHit && !state.moveOnPad)) {
        state.moveId = t.identifier;
        state.moveOnPad = padHit;
        state.lastX = t.clientX; state.lastY = t.clientY;
        if (padHit) showDot(t.clientX, t.clientY); else dot.style.display = 'none';
      }
    }
  }, { passive: false });
  area.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (state.paused) return;
    const g = gain();
    for (const t of e.changedTouches) {
      if (t.identifier !== state.moveId) continue;
      state.dx += ((t.clientX - state.lastX) / state.scale) * g;
      state.dy += ((t.clientY - state.lastY) / state.scale) * g;
      state.lastX = t.clientX; state.lastY = t.clientY;
      if (state.moveOnPad) showDot(t.clientX, t.clientY);
    }
    state.lastTouchT = performance.now();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === state.moveId) { state.moveId = null; state.moveOnPad = false; dot.style.display = 'none'; }
    }
    state.lastTouchT = performance.now();
  };
  area.addEventListener('touchend', end);
  area.addEventListener('touchcancel', end);
  relayout();
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
    // once the screen has been touched, fire continuously (lifting the finger keeps shooting)
    shot: state.moveId !== null || state.lastTouchT > 0,
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
  state.moveOnPad = false;
  if (ui.dot) ui.dot.style.display = 'none';
}
