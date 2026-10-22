// Scene flow: title ->warning ->boss ->clear (or gameover) ->title.
// ('approach' is kept as a harmless optional scene but is not in the flow.)
// Owns all full-screen presentation: title logo, zone banner, the WARNING
// sequence, boss name plate, ZONE CLEAR bonus tally and GAME OVER.
//
// Timings (60 Hz frames):
//   approach  240  (4.0 s)  ship flies in, bg.speed eases 7 ->1, zone banner
//   warning   330  (5.5 s)  alarm bands, WARNING!!, typed boss intro, schematic
//   boss      until boss.defeated && boss.deathDone (or lives < 0 ->gameover)
//   clear     ~ 560 (bonus tally, then back to title; START skips once tallied)
//   gameover  START after 90 f, auto-return after 900 f

import { W, H } from '../config.js';
import { clamp, lerp, easeOutCubic } from '../core/util.js';
import * as audio from './audio.js';
import * as world_ from './world.js'; // circular, used only at runtime (resetRun)
import { drawText, textWidth, bigText, bigLayout, drawBig } from './ui-font.js';
import { drawEvents, causeInfo } from './ui-events.js';
import { isTouchUI, startPrompt } from './ui-touch.js';
import { vignette, hazard, HAZ_P, alarmBand, schematic, SCHEM_W, SCHEM_H, titleSilhouette, TITLE_SIL_EYE, keyCap } from './ui-art.js';

export const APPROACH_LEN = 240;
export const WARNING_LEN = 330;
export const WARNING_SHORT = 96; // quick retry from GAME OVER
const CLEAR_LEN = 600;
const warnLen = (world) => (world.sceneState && world.sceneState.short ? WARNING_SHORT : WARNING_LEN);

const GAMEPLAY = new Set(['approach', 'warning', 'boss', 'clear']);
const HEADLESS = typeof location !== 'undefined' && /headless/.test(location.search);
const HI_KEY = 'abyss-axolotl.hi';


export function init(world) {
  world.sceneState = {};
  if (!HEADLESS) {
    try {
      const v = Number(localStorage.getItem(HI_KEY));
      if (Number.isFinite(v) && v > world.hiScore) world.hiScore = v;
    } catch (e) { /* storage unavailable */ }
  }
}

function saveHi(world) {
  if (HEADLESS) return;
  try { localStorage.setItem(HI_KEY, String(world.hiScore)); } catch (e) { /* ignore */ }
}

// Fresh run: the lead's world.resetRun re-seeds rng/fxRng, clears shots/items and
// re-inits every gameplay module (hiScore is kept).
function resetRun(world) {
  if (typeof world_.resetRun === 'function') world_.resetRun(world);
}

export function goto(world, scene) {
  const prev = world.scene;
  if ((scene === 'approach' || scene === 'warning') && (prev === 'title' || prev === 'gameover' || prev === 'clear')) resetRun(world);
  world.scene = scene;
  world.sceneT = 0;
  world.sceneState = { from: prev, short: scene === 'warning' && prev === 'gameover' };
  world.inputLocked = scene === 'clear';
  if (scene === 'boss' && world.boss) world.boss.active = true;
  if (scene === 'boss' && world.player) world.sceneState.startLives = world.player.lives;
  if (scene === 'clear' || scene === 'gameover') saveHi(world);
  if (world.bg) {
    if (scene === 'title') world.bg.speed = 0.4;
    if (scene !== 'warning') world.bg.tint = 0;
  }
  audio.onScene(world, scene);
}

export function gameplayActive(world) { return GAMEPLAY.has(world.scene); }
export function showsBoss(world) { return world.scene === 'boss' || world.scene === 'clear'; }
export function showsPlayer(world) { return world.scene !== 'title'; }

// ---------------------------------------------------------------- update
export function update(world) {
  const t = world.sceneT;
  const ss = world.sceneState;
  const bg = world.bg;
  switch (world.scene) {
    case 'title':
      if (bg) bg.speed = 0.4;
      if (t >= 3 && t < 3 + WARM.length) WARM[t - 3]();
      if (world.input.start && t > 20) { audio.sfx('start'); goto(world, 'warning'); }
      break;

    case 'approach': {
      if (bg) {
        bg.speed = 1 + 6 * (1 - easeOutCubic(clamp(t / 210, 0, 1)));
        bg.darken = 0;
      }
      const p = world.player;
      if (p && t < 72) {
        // cinematic fly-in: ignore the stick, glide in from off-screen left
        p.cinematic = true;
        world.input = { ...world.input, x: 0, y: 0, shot: false, bomb: false, bombPressed: false };
        p.x = lerp(-30, 64, easeOutCubic(t / 72));
        p.y = lerp(H / 2 + 26, H / 2, easeOutCubic(t / 72));
      } else if (p) p.cinematic = false;
      if (t === 40) audio.sfx('sonar');
      if (t >= APPROACH_LEN) goto(world, 'warning');
      break;
    }

    case 'warning': {
      if (bg) {
        const WL = warnLen(world);
        const k = t < 24 ? t / 24 : t > WL - 40 ? (WL - t) / 40 : 1;
        bg.darken = 0.55 * clamp(k, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.2);
        bg.tint = (0.35 + 0.4 * pulse) * clamp(k, 0, 1);
        bg.speed = 1;
      }
      if (t === 1) audio.sfx(ss.short ? 'warningShort' : 'warning');
      if (t >= warnLen(world)) goto(world, 'boss');
      break;
    }

    case 'boss': {
      if (bg && t < 60) { bg.darken = 0.55 * (1 - t / 60) * (ss.from === 'warning' ? 1 : 0); bg.tint = 0; }
      if (t === 30) audio.sfx('bossRoar');
      // FINAL FORM mood: persistent pulsing red tint
      if (bg && world.boss && world.boss.phase >= 4) bg.tint = Math.max(bg.tint || 0, 0.22 + 0.08 * Math.sin(t * 0.05));
      // boss dying: lock gameplay input (player module auto-cruises the ship)
      world.inputLocked = !!(world.boss && world.boss.defeated);
      if (world.boss && world.boss.defeated && world.boss.deathDone) goto(world, 'clear');
      else if (world.player && world.player.lives < 0 && !world.player.alive) goto(world, 'gameover');
      break;
    }

    case 'clear':
      world.inputLocked = true;
      updateClear(world, t);
      break;

    case 'gameover':
      // quick retry: START jumps straight into a shortened WARNING (no title)
      if (world.input.start && t > 60) goto(world, 'warning');
      else if (t > 900) goto(world, 'title');
      break;
  }
}

// Pre-build sprites used by later scenes while the title idles (avoids a hitch on START).
const WARM = [
  () => { alarmBand(22); hazard(5); schematic(); },
  () => { bigText('WARNING!!', { style: 'red', scale: 4, gap: 3 }); },
  () => { bigText('WARNING!!', { style: 'hot', scale: 4, gap: 3 }); },
  () => { bigText(WARN_L2, { style: 'pink', scale: 2, gap: 2 }); bigText('AMBYSTOMA ROSEA', { style: 'pink', scale: 2, gap: 2 }); },
  () => { bigText('ZONE CLEAR', { style: 'gold', scale: 3, gap: 2 }); bigText('ZONE CLEAR', { style: 'hot', scale: 3, gap: 2 }); },
];

// ---------------------------------------------------------------- clear tally
function clearLines(world) {
  const ss = world.sceneState;
  if (ss.lines) return ss.lines;
  const lives = world.player ? Math.max(0, world.player.lives | 0) : 0;
  const startLives = ss.from === 'boss' && world.player ? undefined : undefined; // (no-miss tracked below)
  void startLives;
  const fightFrames = world.boss ? Number(world.boss.fightT || world.boss.t) || 0 : 0;
  const ev = world.hudState && world.hudState.ev;
  const deaths = ev ? ev.deaths | 0 : 0;
  const secs = Math.floor(fightFrames / 60);
  const clock = `${Math.floor(secs / 60)}'${String(secs % 60).padStart(2, '0')}"`;
  const timeBonus = fightFrames > 0 ? Math.max(0, Math.round((10800 - fightFrames) / 60) * 1000) : 0;
  const st = world.stats || {};
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const wiped = n(st.schoolsWiped), chain = n(st.bestChain), stuns = n(st.stuns);
  ss.lines = [
    { label: 'BOSS DESTROY BONUS', value: 300000 },
    { label: `SCHOOLS WIPED   ${wiped} x 20000`, value: wiped * 20000 },
    { label: `BEST CHAIN      ${chain} x 2000`, value: chain * 2000 },
    { label: `BOSS STUNS      ${stuns} x 50000`, value: stuns * 50000 },
    { label: `REMAINING SHIP  ${lives} x 100000`, value: lives * 100000 },
    { label: deaths === 0 ? 'DEATHS 0   NO MISS BONUS' : `DEATHS ${deaths}`, value: deaths === 0 ? 200000 : 0 },
    { label: `TIME ${clock}  SWIFT KILL`, value: timeBonus },
  ];
  ss.lines.forEach((l) => { l.shown = 0; });
  return ss.lines;
}

const TALLY_START = 60, TALLY_EACH = 36, TALLY_COUNT = 26, ROW0 = 78, ROWH = 12;
function updateClear(world, t) {
  const lines = clearLines(world);
  const ss = world.sceneState;
  lines.forEach((l, i) => {
    const t0 = TALLY_START + i * TALLY_EACH;
    if (t < t0) return;
    const k = clamp((t - t0) / TALLY_COUNT, 0, 1);
    const target = Math.round(l.value * k / 100) * 100;
    if (target > l.shown) { world.score += target - l.shown; l.shown = target; }
    if (k < 1 && (t - t0) % 3 === 0 && l.value > 0) audio.sfx('tick');
    if (t === t0 + TALLY_COUNT + 1 && l.value > 0) audio.sfx('tally');
  });
  const done = t > TALLY_START + lines.length * TALLY_EACH;
  if (done && !ss.recordChecked) {
    ss.recordChecked = true;
    ss.newRecord = world.score >= world.hiScore && world.score > 0;
    if (world.score > world.hiScore) world.hiScore = world.score;
    saveHi(world);
  }
  if ((done && world.input.start) || t >= CLEAR_LEN) goto(world, 'title');
}

// ---------------------------------------------------------------- drawing
export function draw(ctx, world) {
  const prevS = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  switch (world.scene) {
    case 'title': drawTitle(ctx, world); break;
    case 'approach': drawApproach(ctx, world); break;
    case 'warning': drawWarning(ctx, world); break;
    case 'boss': drawEvents(ctx, world); drawBossIntro(ctx, world); break;
    case 'clear': drawEvents(ctx, world); drawClear(ctx, world); break;
    case 'gameover': drawGameOver(ctx, world); break;
  }
  ctx.restore();
  ctx.imageSmoothingEnabled = prevS;
}

function shade(ctx, a, col = '2,4,16') {
  if (a <= 0) return;
  ctx.fillStyle = `rgba(${col},${a})`;
  ctx.fillRect(0, 0, W, H);
}

// Typewriter helper: returns the visible prefix of str at time t.
const typed = (str, t, t0, per = 2) => str.slice(0, clamp(Math.floor((t - t0) / per), 0, str.length));

// --- title
let logoBuf = null;
function drawLogo(ctx, cx, y, t) {
  const text = 'ABYSS RAID';
  const S = 4, gap = 3, style = 'steel';
  const full = bigText(text, { style, scale: S, italic: true, gap });
  const x0 = Math.round(cx - full.width / 2);
  if (t < 60) {
    // letters drop in one by one
    const pos = bigLayout(text, { style, scale: S, italic: true, gap });
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const x = pos[i];
      if (ch !== ' ') {
        const k = clamp((t - i * 4) / 20, 0, 1);
        if (k > 0) {
          const g = bigText(ch, { style: k < 1 ? 'cyan' : style, scale: S, italic: true, gap });
          const dy = Math.round((1 - easeOutCubic(k)) * -60);
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.drawImage(g, x0 + x, y - full.pad + dy);
          ctx.globalAlpha = 1;
        }
      }
    }
    return;
  }
  // flash on completion, then periodic shine sweep
  if (t < 68) { ctx.drawImage(bigText(text, { style: 'hot', scale: S, italic: true, gap }), x0, y - full.pad); return; }
  const sweep = (t - 68) % 300;
  if (sweep < 44) {
    if (!logoBuf || logoBuf.width !== full.width) {
      logoBuf = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(full.width, full.height) : Object.assign(document.createElement('canvas'), { width: full.width, height: full.height });
    }
    const b = logoBuf.getContext('2d');
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, full.width, full.height);
    b.drawImage(full, 0, 0);
    b.globalCompositeOperation = 'source-atop';
    const sx = -30 + (sweep / 44) * (full.width + 60);
    b.fillStyle = 'rgba(255,255,255,0.45)';
    b.beginPath();
    b.moveTo(sx, 0); b.lineTo(sx + 16, 0); b.lineTo(sx + 2, full.height); b.lineTo(sx - 14, full.height);
    b.fill();
    b.fillStyle = 'rgba(255,255,255,0.5)';
    b.beginPath();
    b.moveTo(sx + 5, 0); b.lineTo(sx + 11, 0); b.lineTo(sx - 3, full.height); b.lineTo(sx - 9, full.height);
    b.fill();
    ctx.drawImage(logoBuf, x0, y - full.pad);
  } else {
    ctx.drawImage(full, x0, y - full.pad);
  }
}

// key-cap + label helper; returns x after the cap
function cap(ctx, x, y, label, alpha = 1) {
  const w = textWidth(label) + 6;
  ctx.globalAlpha = alpha;
  ctx.drawImage(keyCap(w), x, y);
  ctx.globalAlpha = 1;
  drawText(ctx, label, x + 3, y + 2, { style: 'white', shadow: false, alpha });
  return x + w + 1;
}

function drawControls(ctx, y, alpha) {
  const touchUI = isTouchUI();
  const pw = 262, ph = 58, px0 = Math.round(W / 2 - pw / 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(2,6,18,0.78)';
  ctx.fillRect(px0, y, pw, ph);
  ctx.fillStyle = '#3a5a80';
  ctx.fillRect(px0, y, pw, 1);
  ctx.fillRect(px0, y + ph - 1, pw, 1);
  ctx.fillStyle = '#58c8ff';
  ctx.fillRect(px0, y, 3, 1); ctx.fillRect(px0 + pw - 3, y, 3, 1);
  ctx.globalAlpha = 1;
  if (touchUI) { drawTouchControls(ctx, px0, y, alpha); return; }
  const lx = px0 + 8, rx = px0 + 146;
  let r = y + 5;
  let x = lx;
  for (const k of ['←', '↑', '↓', '→']) x = cap(ctx, x, r, k, alpha);
  drawText(ctx, 'MOVE', x + 4, r + 2, { style: 'cyan', alpha });
  x = cap(ctx, rx, r, 'G', alpha);
  drawText(ctx, 'SHOT', x + 4, r + 2, { style: 'gold', alpha });
  r += 13;
  x = lx;
  for (const k of ['W', 'A', 'S', 'D']) x = cap(ctx, x, r, k, alpha);
  drawText(ctx, 'MOVE', x + 4, r + 2, { style: 'cyan', alpha });
  x = cap(ctx, rx, r, 'H', alpha);
  drawText(ctx, 'ABYSS BURST', x + 4, r + 2, { style: 'pink', alpha });
  r += 13;
  x = cap(ctx, lx, r, 'ENTER', alpha);
  drawText(ctx, 'START', x + 4, r + 2, { style: 'white', alpha });
  x = cap(ctx, rx, r, 'M', alpha);
  drawText(ctx, 'MUTE', x + 4, r + 2, { style: 'grey', alpha });
  drawText(ctx, 'GAMEPAD OK: D-PAD/STICK  A SHOT  B BURST', W / 2, r + 15, { style: 'dim', align: 'center', alpha });
}

// touch devices: same panel, touch instructions in key-cap style
function drawTouchControls(ctx, px0, y, alpha) {
  const lx = px0 + 8;
  const rows = [
    ['DRAG ANYWHERE', 'MOVE (AUTO-FIRE)', 'cyan'],
    ['BURST', 'ABYSS BURST  (ON-SCREEN BUTTON)', 'pink'],
    ['TAP', 'START', 'white'],
    ['FULL', 'FULLSCREEN', 'grey'],
  ];
  rows.forEach(([k, label, style], i) => {
    const r = y + 4 + i * 13;
    const x = cap(ctx, lx, r, k, alpha);
    drawText(ctx, label, x + 4, r + 2, { style, alpha });
  });
}

function drawTitle(ctx, world) {
  const t = world.sceneT;
  // hero: dark partial silhouette of the battleship drifting in from the right
  ctx.drawImage(vignette(), 0, 0);
  shade(ctx, 0.12);
  const sil = titleSilhouette();
  const sx = Math.round(lerp(150, 26, easeOutCubic(clamp(t / 120, 0, 1))) + Math.sin(t / 70) * 3);
  const sy = Math.round(4 + Math.sin(t / 53) * 2);
  ctx.drawImage(sil, sx, sy);
  const glow = 0.6 + 0.4 * Math.sin(t / 9);
  ctx.fillStyle = `rgba(255,40,60,${glow.toFixed(2)})`;
  ctx.fillRect(sx + Math.round(TITLE_SIL_EYE[0]) - 1, sy + Math.round(TITLE_SIL_EYE[1]) - 1, 4, 3);
  ctx.fillStyle = '#ffd0d0';
  ctx.fillRect(sx + Math.round(TITLE_SIL_EYE[0]), sy + Math.round(TITLE_SIL_EYE[1]), 2, 1);

  drawLogo(ctx, W / 2, 24, t);
  if (t >= 56) {
    const k = clamp((t - 56) / 20, 0, 1);
    const half = Math.round(118 * easeOutCubic(k));
    ctx.fillStyle = 'rgba(255,170,210,0.5)';
    ctx.fillRect(W / 2 - half, 57, half * 2, 1);
    ctx.fillStyle = '#ff6aa8';
    ctx.fillRect(W / 2 - half, 58, half * 2, 1);
    ctx.fillStyle = '#5a1838';
    ctx.fillRect(W / 2 - half, 59, half * 2, 1);
    drawBig(ctx, 'AXOLOTL', W / 2, 64, { style: 'pink', scale: 2, gap: 5, alpha: k });
    drawText(ctx, 'ZONE V  -  ABYSSAL TRENCH', W / 2, 83, { style: 'grey', align: 'center', alpha: k });
  }
  if (t >= 70) {
    if (((t - 70) % 60) < 40) drawBig(ctx, startPrompt(), W / 2, 97, { style: 'gold', scale: 1, gap: 2 });
    drawControls(ctx, 112, clamp((t - 70) / 16, 0, 1));
  }
  drawText(ctx, '© 2026 ABYSSAL WORKS  ORIGINAL ARCADE', W / 2, 182, { style: 'cyan', align: 'center' });
  if (!isTouchUI()) drawText(ctx, 'FREE PLAY', W - 6, H - 10, { style: 'white', align: 'right' }); // touch: BURST button sits there
  if (!isTouchUI()) drawText(ctx, 'BOSS ATTACK MODE', 6, H - 10, { style: 'dim' }); // touch: corner buttons
}

// --- approach
function drawApproach(ctx, world) {
  const t = world.sceneT;
  // speed streaks while the scroll is fast (cosmetic, deterministic per frame)
  const spd = world.bg ? world.bg.speed : 1;
  if (spd > 2) {
    const n = Math.round((spd - 2) * 3);
    for (let i = 0; i < n; i++) {
      const y = 14 + ((i * 53 + 17) % (H - 30));
      const len = 18 + ((i * 29) % 30);
      const x = W - ((t * spd * 3 + i * 97) % (W + len));
      ctx.fillStyle = `rgba(170,220,255,${0.12 + (i % 3) * 0.06})`;
      ctx.fillRect(Math.round(x), y, len, 1);
    }
  }
  if (t < 40 || t > 236) return;
  const fade = t > 210 ? (236 - t) / 26 : 1;
  const cy = 34;
  const sx = clamp((t - 40) / 10, 0, 1);
  // banner plate
  const half = Math.round(130 * easeOutCubic(clamp((t - 44) / 18, 0, 1)));
  ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(2,6,20,0.55)';
  ctx.fillRect(W / 2 - half, cy - 8, half * 2, 52);
  ctx.fillStyle = '#58c8ff';
  ctx.fillRect(W / 2 - half, cy - 8, half * 2, 1);
  ctx.fillRect(W / 2 - half, cy + 43, half * 2, 1);
  ctx.globalAlpha = 1;
  drawBig(ctx, 'ZONE V', W / 2, cy, { style: 'cyan', scale: 2, gap: 3, sx, alpha: fade });
  drawText(ctx, typed('ABYSSAL TRENCH', t, 62, 2), W / 2 - textWidth('ABYSSAL TRENCH') / 2, cy + 20, { style: 'white', alpha: fade });
  const sub = 'DEPTH 6800M   BIO-SIGNAL: UNKNOWN';
  drawText(ctx, typed(sub, t, 96, 1), W / 2 - textWidth(sub) / 2, cy + 32, { style: 'grey', alpha: fade });
}

// --- warning
const WARN_L1 = 'A GIGANTIC AMPHIBIOUS BATTLESHIP';
const WARN_L2 = 'AMBYSTOMA ROSEA';
const WARN_L3 = 'IS APPROACHING FAST';
function drawBand(ctx, y, h, t, dir, slide) {
  const ox = Math.round(slide * W * dir);
  ctx.save();
  ctx.translate(ox, 0);
  ctx.drawImage(alarmBand(h), 0, y);
  const hz = hazard(5);
  const s = ((t * 1.5 * dir) % HAZ_P + HAZ_P) % HAZ_P;
  ctx.drawImage(hz, -s - HAZ_P, y - 5);
  ctx.drawImage(hz, s - HAZ_P, y + h);
  // scrolling caution text inside the band
  const msg = 'WARNING  !!  CAUTION  !!  ';
  const mw = msg.length * 12;
  const off = ((t * 1.2 * -dir) % mw + mw) % mw;
  for (let x = -off - mw; x < W + mw; x += mw) drawText(ctx, msg, Math.round(x), y + Math.round((h - 14) / 2), { style: 'white', scale: 2, shadowStyle: 'dark' });
  ctx.restore();
}

function drawWarning(ctx, world) {
  const t = world.sceneT, L = warnLen(world);
  const short = L === WARNING_SHORT;
  // red alarm pulse over the whole screen
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.2);
  const env = clamp(t / 16, 0, 1) * clamp((L - t) / 30, 0, 1);
  ctx.drawImage(vignette(), 0, 0);
  shade(ctx, (0.08 + 0.12 * pulse) * env, '255,10,20');

  // bands slide in (top from right, bottom from left) and out at the end
  const inK = 1 - easeOutCubic(clamp(t / 22, 0, 1));
  const outK = t > L - 28 ? easeOutCubic((t - (L - 28)) / 28) : 0;
  const slide = Math.max(inK, outK);
  drawBand(ctx, 18, 22, t, 1, outK > 0 ? -outK : slide);
  drawBand(ctx, H - 36, 22, t, -1, outK > 0 ? -outK : slide);

  // giant WARNING!! -expands from a line, then flashes
  if (t >= 14 && t < L - 10) {
    const sy = clamp((t - 14) / 8, 0.08, 1);
    const flashing = t < 150 ? ((t >> 3) & 1) : ((t >> 4) & 1) || t > 240;
    const style = t < 22 ? 'hot' : flashing ? 'red' : 'hot';
    const dim = t > L - 30 ? (L - 10 - t) / 20 : 1;
    drawBig(ctx, 'WARNING!!', W / 2, 52, { style, scale: 4, gap: 3, sy, alpha: dim });
  }
  // intro text
  if (t >= 64 && !short) {
    const a = t > L - 24 ? (L - t) / 24 : 1;
    const l1 = typed(WARN_L1, t, 64, 2);
    drawText(ctx, l1, W / 2 - textWidth(WARN_L1) / 2, 88, { style: 'white', alpha: a });
    if (t >= 132) {
      const n = clamp(Math.floor((t - 132) / 3), 0, WARN_L2.length);
      const full = bigText(WARN_L2, { style: 'pink', scale: 2, gap: 2 });
      const part = bigText(WARN_L2.slice(0, n) || ' ', { style: 'pink', scale: 2, gap: 2 });
      if (n > 0) {
        ctx.globalAlpha = a;
        ctx.drawImage(part, Math.round(W / 2 - full.width / 2), 99 - part.pad);
        ctx.globalAlpha = 1;
        drawText(ctx, '"', Math.round(W / 2 - full.width / 2) - 14, 98, { style: 'pink', scale: 2, alpha: a });
        if (n >= WARN_L2.length) drawText(ctx, '"', Math.round(W / 2 + full.width / 2) + 2, 98, { style: 'pink', scale: 2, alpha: a });
      }
    }
    if (t >= 190) {
      drawText(ctx, typed(WARN_L3, t, 190, 2), W / 2 - textWidth(WARN_L3) / 2, 117, { style: 'white', alpha: a });
    }
  }
  // schematic box with scanning line
  if (short && t >= 24 && t < L - 12) drawText(ctx, 'RETRY  -  GOOD LUCK!', W / 2, 92, { style: 'gold', align: 'center' });
  if (t >= 100 && t < L - 20) {
    const on = t < 108 ? (t & 2) === 0 : true;
    if (on) {
      const sx = Math.round(W / 2 - SCHEM_W / 2), sy = 128;
      ctx.drawImage(schematic(), sx, sy);
      const scan = (t * 1.6) % SCHEM_W;
      ctx.fillStyle = 'rgba(180,255,255,0.55)';
      ctx.fillRect(sx + Math.round(scan), sy + 1, 1, SCHEM_H - 2);
      ctx.fillStyle = 'rgba(180,255,255,0.18)';
      ctx.fillRect(sx + Math.round(scan) - 3, sy + 1, 3, SCHEM_H - 2);
      drawText(ctx, 'TARGET', sx + 3, sy + SCHEM_H - 9, { style: 'cyan', shadow: false });
      if ((t >> 4) & 1) drawText(ctx, 'SIZE 412M', sx + SCHEM_W - 3, sy + 3, { style: 'red', align: 'right', shadow: false });
    }
  }
}

// --- boss name plate
function drawBossIntro(ctx, world) {
  const t = world.sceneT;
  if (t < 36 || t > 260) return;
  const k = easeOutCubic(clamp((t - 36) / 18, 0, 1));
  const out = t > 230 ? (260 - t) / 30 : 1;
  const nm = bigText('AMBYSTOMA ROSEA', { style: 'pink', scale: 2, gap: 2 });
  const y = H - 50;
  const w = Math.max(nm.width, textWidth('GIGANTIC AMPHIBIOUS BATTLESHIP')) + 14;
  const x = Math.round(W - 8 - w * k);
  ctx.globalAlpha = out;
  ctx.fillStyle = 'rgba(16,2,14,0.72)';
  ctx.fillRect(x, y, w, 32);
  ctx.fillStyle = '#ff6aa8';
  ctx.fillRect(x, y, 2, 32);
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = '#5a1838';
  ctx.fillRect(x, y + 31, w, 1);
  ctx.globalAlpha = 1;
  drawText(ctx, 'GIGANTIC AMPHIBIOUS BATTLESHIP', x + 7, y + 4, { style: 'grey', alpha: out });
  ctx.globalAlpha = out;
  ctx.drawImage(nm, x + 7 - nm.pad, y + 14 - nm.pad);
  ctx.globalAlpha = 1;
}

// --- clear
function drawClear(ctx, world) {
  const t = world.sceneT;
  const lines = clearLines(world);
  shade(ctx, clamp(t / 40, 0, 1) * 0.35);
  if (t >= 6) {
    const sx = easeOutCubic(clamp((t - 6) / 14, 0.02, 1));
    const style = t < 22 || (t < 60 && (t >> 2) & 1) ? 'hot' : 'gold';
    drawBig(ctx, 'ZONE CLEAR', W / 2, 44, { style, scale: 3, gap: 2, sx });
  }
  if (t >= 30) {
    const half = Math.round(120 * easeOutCubic(clamp((t - 30) / 20, 0, 1)));
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(W / 2 - half, 72, half * 2, 1);
    ctx.fillStyle = '#7a4a08';
    ctx.fillRect(W / 2 - half, 73, half * 2, 1);
  }
  lines.forEach((l, i) => {
    const t0 = TALLY_START + i * TALLY_EACH;
    if (t < t0 - 6) return;
    const y = ROW0 + i * ROWH;
    drawText(ctx, l.label, 36, y, { style: 'white' });
    drawText(ctx, String(l.shown).padStart(8, ' '), W - 36, y, { style: t < t0 + TALLY_COUNT ? 'white' : 'gold', align: 'right' });
  });
  const tEnd = TALLY_START + lines.length * TALLY_EACH;
  if (t >= tEnd - 10) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(36, ROW0 + lines.length * ROWH - 4, W - 72, 1);
    drawText(ctx, 'SCORE', 36, ROW0 + lines.length * ROWH + 2, { style: 'cyan' });
    drawText(ctx, String(world.score).padStart(8, '0'), W - 36, ROW0 + lines.length * ROWH + 2, { style: 'gold', align: 'right' });
  }
  if (t >= tEnd + 10) {
    if (world.sceneState.newRecord && (t >> 3) & 1) drawBig(ctx, 'NEW RECORD!', W / 2, 188, { style: 'red', scale: 1, gap: 2 });
    if (((t - tEnd) % 60) < 40) drawText(ctx, startPrompt(), W / 2, 202, { style: 'white', align: 'center' });
  }
}

// --- game over
function drawGameOver(ctx, world) {
  const t = world.sceneT;
  shade(ctx, clamp(t / 50, 0, 1) * 0.6);
  ctx.drawImage(vignette(), 0, 0);
  if (t >= 10) {
    const k = easeOutCubic(clamp((t - 10) / 24, 0, 1));
    drawBig(ctx, 'GAME OVER', W / 2, 80 - Math.round((1 - k) * 20), { style: 'steel', scale: 3, gap: 2, alpha: k });
  }
  if (t >= 50) {
    drawText(ctx, 'SCORE', W / 2 - 4, 116, { style: 'cyan', align: 'right' });
    drawText(ctx, String(world.score).padStart(8, '0'), W / 2 + 4, 116, { style: 'gold' });
    const d = world.hudState && world.hudState.ev && world.hudState.ev.lastDeath;
    if (d) {
      const info = d.name ? d : causeInfo(d.cause);
      drawText(ctx, 'FINAL BLOW: ' + info.name, W / 2, 130, { style: 'red', align: 'center' });
      drawText(ctx, String(d.hint || info.hint).slice(0, 60), W / 2, 141, { style: 'green', align: 'center' });
    } else drawText(ctx, 'THE ABYSS AWAITS YOUR RETURN', W / 2, 132, { style: 'dim', align: 'center' });
  }
  if (t >= 60 && (t % 60) < 40) drawBig(ctx, isTouchUI() ? 'TRY AGAIN!  TAP TO START' : 'TRY AGAIN!  PUSH START', W / 2, 160, { style: 'gold', scale: 1, gap: 2 });
}
