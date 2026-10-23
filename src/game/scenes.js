// Scene flow: title ->warning ->boss ->clear (or gameover) ->title.
// ('approach' is kept as a harmless optional scene but is not in the flow.)
// Owns all full-screen presentation: title logo, zone banner, the WARNING
// sequence, boss name plate, ZONE CLEAR bonus tally and GAME OVER.
//
// Timings (60 Hz frames):
//   approach  240  (4.0 s)  ship flies in, bg.speed eases 7 ->1, zone banner
//   warning   330  (5.5 s)  alert slam, painted sonar acquisition, target-name slam
//   boss      until boss.defeated && boss.deathDone (or lives < 0 ->gameover)
//   clear     ~ 560 (bonus tally, then back to title; START skips once tallied)
//   gameover  START after 90 f, auto-return after 900 f

import { W, H, HUD_H } from '../config.js';
import * as touchMod from '../core/touch.js';
import { clamp, lerp, easeOutCubic } from '../core/util.js';
import * as audio from './audio.js';
import * as world_ from './world.js'; // circular, used only at runtime (resetRun/enterZone/continueRun)
import * as bossF from './boss.js'; // facade: zoneInfo, ZONE_ORDER (runtime only)

const ZDEF = {
  V: { letter: 'V', name: 'AMBYSTOMA ROSEA', title: 'GIGANTIC AMPHIBIOUS BATTLESHIP', area: 'ABYSSAL TRENCH' },
  G: { letter: 'G', name: 'PERIOPHTHALMUS', title: 'AMPHIBIOUS ASSAULT CARRIER', area: 'SUNSET TIDELANDS' },
  M: { letter: 'M', name: 'PERIOPHTHALMUS REX', title: 'AMPHIBIOUS SIEGE BEHEMOTH', area: 'MUDFLAT FRONT' },
};
const CARD_AREA = { V: 'CAVERN', G: 'TIDELANDS', M: 'MUDFLAT' };
export function zinfo(world) {
  let z = null;
  try { z = typeof bossF.zoneInfo === 'function' ? bossF.zoneInfo(world) : null; } catch (e) { z = null; }
  const d = ZDEF[(world && world.zone) || 'V'] || ZDEF.V;
  return { ...d, ...(z || {}) };
}
const zoneOrder = () => (Array.isArray(bossF.ZONE_ORDER) && bossF.ZONE_ORDER.length ? bossF.ZONE_ORDER : ['V', 'G']);
// title zone select lives in world.titleZone (initialised from world.zone)
export const selectedZone = (world) => (world && world.titleZone) || (world && world.zone) || 'V';
export const CONTINUE_LEN = 600; // 9..0, one number per second
const ALLCLEAR_LEN = 900;
import { drawText, textWidth, bigText, bigLayout, drawBig } from './ui-font.js';
import { drawEvents, causeInfo } from './ui-events.js';
import { drawKeyArt } from './ui-presentation-visual.js';
import { drawWarningVisual } from './ui-warning-visual.js';
import { isTouchUI, startPrompt } from './ui-touch.js';
import { vignette, keyCap } from './ui-art.js';

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
  world.titleZone = world.zone || 'V';
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
function resetRun(world, zone) {
  if (typeof world_.resetRun === 'function') world_.resetRun(world, zone);
}

export function goto(world, scene) {
  const prev = world.scene;
  if ((scene === 'approach' || scene === 'warning') && prev === 'title') resetRun(world, world.titleZone || 'V');
  world.scene = scene;
  world.sceneT = 0;
  world.sceneState = { from: prev, short: false };
  // per-zone bookkeeping for the clear tally (deaths / continues during THIS zone)
  const ev = world.hudState && world.hudState.ev;
  if (scene === 'warning' && ev) { ev.zoneDeaths0 = ev.deaths | 0; ev.zoneCont0 = world.continues | 0; ev.stats0 = { ...(world.stats || {}) }; }
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
export function showsBoss(world) { return ['boss', 'clear', 'continue', 'gameover'].includes(world.scene); }
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
      {
        // zone select: left/right (edge-triggered); touch: drag left/right
        const order = zoneOrder();
        const dx = world.input.x | 0;
        if (dx !== 0 && ss.prevX !== dx && t > 10) {
          const i = Math.max(0, order.indexOf(world.titleZone));
          world.titleZone = order[(i + dx + order.length) % order.length];
          ss.selT = 0;
          audio.sfx('tick');
        }
        ss.prevX = dx;
        ss.selT = (ss.selT || 0) + 1;
        if (!order.includes(world.titleZone)) world.titleZone = order[0];
      }
      {
        // touch: tapping a non-selected zone card only selects it (that tap must not start);
        // tapping the selected card or anywhere else starts as before.
        let tap = null;
        try { tap = typeof touchMod.readTap === 'function' ? touchMod.readTap() : null; } catch (e) { tap = null; }
        if (tap && t <= 2) tap = null; // drop a stale tap from the previous scene
        if (tap && Number.isFinite(tap.x) && Number.isFinite(tap.y)) {
          const py = tap.y - HUD_H;
          const hit = cardRects().find((r) => tap.x >= r.x - 4 && tap.x < r.x + r.w + 4 && py >= r.y - 4 && py < r.y + r.h + 4);
          if (hit && hit.z !== world.titleZone) { world.titleZone = hit.z; ss.selT = 0; audio.sfx('tick'); ss.blockStart = 3; }
        }
      }
      if (world.input.start && t > 20 && !(ss.blockStart > 0)) { audio.sfx('start'); goto(world, 'warning'); break; }
      if (ss.blockStart > 0) ss.blockStart--; // also swallow a start latched a step late
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
      if (t === 1) audio.sfx(ss.short ? 'warningShort' : 'warning', world.zone);
      if (t >= warnLen(world)) goto(world, 'boss');
      break;
    }

    case 'boss': {
      if (bg && t < 60) { bg.darken = 0.55 * (1 - t / 60) * (ss.from === 'warning' ? 1 : 0); bg.tint = 0; }
      if (t === 30 && ss.from !== 'continue') audio.sfx('bossRoar');
      // FINAL FORM mood: persistent pulsing red tint
      if (bg && world.boss && world.boss.phase >= 4) bg.tint = Math.max(bg.tint || 0, 0.22 + 0.08 * Math.sin(t * 0.05));
      // boss dying: lock gameplay input (player module auto-cruises the ship)
      world.inputLocked = !!(world.boss && world.boss.defeated);
      if (world.boss && world.boss.defeated && world.boss.deathDone) goto(world, 'clear');
      else if (world.player && world.player.lives < 0 && !world.player.alive && !(world.boss && world.boss.defeated)) goto(world, 'continue');
      break;
    }

    case 'clear':
      world.inputLocked = true;
      updateClear(world, t);
      break;

    case 'continue': {
      // arcade CONTINUE? 9..0 — START resumes the same fight (boss keeps its state)
      if (t % 60 === 1 && t < CONTINUE_LEN) audio.sfx('count');
      if (world.input.start && t > 20) {
        if (typeof world_.continueRun === 'function') world_.continueRun(world);
        else if (world.player) { world.player.lives = 2; world.player.alive = false; world.player.respawn = 1; world.score = 0; }
        audio.sfx('start');
        goto(world, 'boss');
        world.sceneState.from = 'continue';
      } else if (t >= CONTINUE_LEN) goto(world, 'gameover');
      break;
    }

    case 'gameover':
      if ((world.input.start && t > 90) || t > 720) goto(world, 'title');
      break;

    case 'allclear':
      world.inputLocked = true;
      if ((world.input.start && t > 240) || t > ALLCLEAR_LEN) goto(world, 'title');
      break;
  }
}

// Pre-build sprites used by later scenes while the title idles (avoids a hitch on START).
const WARM = [
  () => { bigText('WARNING', { style: 'red', scale: 4, gap: 5 }); },
  () => { bigText('WARNING', { style: 'gold', scale: 4, gap: 5 }); },
  () => { bigText('WARNING', { style: 'cyan', scale: 4, gap: 5 }); },
  () => { bigText('PERIOPHTHALMUS', { style: 'gold', scale: 2, gap: 2 }); bigText('AMBYSTOMA ROSEA', { style: 'pink', scale: 2, gap: 2 }); },
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
  const deaths = ev ? (ev.deaths | 0) - (ev.zoneDeaths0 | 0) : 0;
  const conts = Math.max(0, (world.continues | 0) - (ev ? ev.zoneCont0 | 0 : 0));
  if (world.hudState) {
    world.hudState.runFrames = (world.hudState.runFrames || 0) + fightFrames;
    world.hudState.zonesCleared = (world.hudState.zonesCleared || 0) + 1;
  }
  const secs = Math.floor(fightFrames / 60);
  const clock = `${Math.floor(secs / 60)}'${String(secs % 60).padStart(2, '0')}"`;
  const timeBonus = fightFrames > 0 ? Math.max(0, Math.round((10800 - fightFrames) / 60) * 1000) : 0;
  // per-zone: world.stats is cumulative across enterZone -> award only this zone's delta
  const st = world.stats || {};
  const s0 = (ev && ev.stats0) || {};
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const wiped = n(st.schoolsWiped) - n(s0.schoolsWiped), stuns = n(st.stuns) - n(s0.stuns);
  // bestChain is a max, not a count: only count it if this zone raised it
  const chain = n(st.bestChain) > n(s0.bestChain) ? n(st.bestChain) : 0;
  const noMiss = deaths === 0 && conts === 0;
  ss.lines = [
    { label: 'BOSS DESTROY BONUS', value: 300000 },
    wiped > 0 && { label: `SCHOOLS WIPED   ${wiped} x 20000`, value: wiped * 20000 },
    chain > 0 && { label: `BEST CHAIN      ${chain} x 2000`, value: chain * 2000 },
    stuns > 0 && { label: `${({ G: 'BLINDED CRASHES', M: 'FLIP-OVERS     ' })[world.zone] || 'BOSS STUNS     '} ${stuns} x 50000`, value: stuns * 50000 },
    { label: `REMAINING SHIP  ${lives} x 100000`, value: lives * 100000 },
    { label: noMiss ? 'DEATHS 0   NO MISS BONUS' : `DEATHS ${deaths}`, value: noMiss ? 200000 : 0 },
    conts > 0 && { label: `CONTINUES ${conts}`, value: 0 },
    { label: `TIME ${clock}  SWIFT KILL`, value: timeBonus },
  ].filter(Boolean);
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
  if ((done && world.input.start) || t >= CLEAR_LEN) {
    // boss rush: next zone keeps score/lives/power; after the last zone -> ALL CLEAR
    const order = zoneOrder();
    const i = order.indexOf(world.zone || 'V');
    const next = i >= 0 ? order[i + 1] : null;
    if (next && typeof world_.enterZone === 'function') {
      world_.enterZone(world, next);
      goto(world, 'warning');
    } else goto(world, 'allclear');
  }
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
    case 'continue': drawContinue(ctx, world); break;
    case 'allclear': drawAllClear(ctx, world); break;
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
  const S = 4, gap = 3, style = 'abyss';
  const full = bigText(text, { style, scale: S, italic: true, gap });
  const x0 = Math.round(cx - full.width / 2);
  if (t >= 60) {
    ctx.globalAlpha = 0.45;
    ctx.drawImage(full, x0 + 1, y - full.pad + 3);
    ctx.globalAlpha = 1;
  }
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
  const pw = 262, ph = 43, px0 = Math.round(W / 2 - pw / 2);
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

}

// touch devices: same panel, touch instructions in key-cap style
function drawTouchControls(ctx, px0, y, alpha) {
  const lx = px0 + 8;
  const rows = [
    ['DRAG ANYWHERE', 'MOVE (AUTO-FIRE)', 'cyan'],
    ['BURST', 'ABYSS BURST  (ON-SCREEN BUTTON)', 'pink'],
    ['TAP', 'START  /  TAP A ZONE CARD TO PICK', 'white'],
  ];
  rows.forEach(([k, label, style], i) => {
    const r = y + 4 + i * 13;
    const x = cap(ctx, lx, r, k, alpha);
    drawText(ctx, label, x + 4, r + 2, { style, alpha });
  });
}

// zone card layout (playfield coords), shared by drawing and tap hit-testing
const CARD_Y = 110, CARD_H = 36, CARD_GAP = 12;
function cardRects() {
  const order = zoneOrder();
  // 140 px cards for two zones; narrower when more zones exist so all cards fit the 426 px width
  const CARD_W = Math.min(140, Math.floor((W - 12 - (order.length - 1) * CARD_GAP) / order.length));
  const total = order.length * CARD_W + (order.length - 1) * CARD_GAP;
  const x0 = Math.round(W / 2 - total / 2);
  return order.map((z, i) => ({ z, x: x0 + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H }));
}

// two zone cards; the selected one is lit with blinking arrows
function drawZoneSelect(ctx, world, y, alpha) {
  for (const r of cardRects()) {
    const sel = r.z === selectedZone(world), d = ZDEF[r.z] || { name: r.z };
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = sel ? '#152a38' : '#050e1b'; ctx.fillRect(r.x, r.y, r.w, r.h);
    drawKeyArt(ctx, r.z, r.x + 3, r.y + 3, 44, 20);
    ctx.strokeStyle = sel ? '#ffd382' : '#415569'; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
    drawText(ctx, (sel ? '> ' : '  ') + 'ZONE ' + r.z, r.x + 51, r.y + 4, {style: sel ? 'gold' : 'grey'});
    drawText(ctx, CARD_AREA[r.z] || '', r.x + 51, r.y + 15, {style:'cyan'});
    drawText(ctx, d.name, r.x + r.w / 2, r.y + 26, {style: sel ? 'white' : 'grey', align:'center'});
    ctx.restore();
  }
}

function drawTitle(ctx, world) {
  const t = world.sceneT;
  drawKeyArt(ctx, selectedZone(world), 0, 0, W, H, t);
  ctx.fillStyle = 'rgba(0,5,15,.24)'; ctx.fillRect(0, 0, W, 61);
  ctx.fillStyle = 'rgba(0,5,15,.85)'; ctx.fillRect(0, 105, W, H - 105);
  ctx.drawImage(vignette(), 0, 0);
  ctx.fillStyle = 'rgba(180,240,255,.38)';
  for (let i = 0; i < 17; i++) { const x = (i * 71 + 13) % W, y = (i * 41 + 216 - t * (0.12 + i % 3 * .04)) % 216; ctx.fillRect(x, (y + 216) % 216, 1, 2); }
  drawLogo(ctx, W / 2, 12, t);
  if (t >= 56) {
    drawBig(ctx, 'AXOLOTL', W / 2, 47, {style:'pink', scale:2, gap:5});
    drawZoneSelect(ctx, world, CARD_Y, clamp((t - 56) / 20, 0, 1));
  }
  if (t >= 70) {
    if ((t - 70) % 60 < 44) drawBig(ctx, startPrompt(), W / 2, 152, {style:'gold', scale:1, gap:2});
    drawControls(ctx, 169, clamp((t - 70) / 16, 0, 1));
  }
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
function drawWarning(ctx, world) {
  drawWarningVisual(ctx, world, zinfo(world), warnLen(world));
}

// --- boss name plate
function drawBossIntro(ctx, world) {
  const t = world.sceneT;
  if (t < 36 || t > 260 || world.sceneState.from === 'continue') return;
  const Z = zinfo(world);
  const k = easeOutCubic(clamp((t - 36) / 18, 0, 1));
  const out = t > 230 ? (260 - t) / 30 : 1;
  const nm = bigText(Z.name, { style: Z.letter === 'V' ? 'pink' : 'gold', scale: 2, gap: 2 });
  const y = H - 50;
  const w = Math.max(nm.width, textWidth(Z.title)) + 14;
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
  drawText(ctx, Z.title, x + 7, y + 4, { style: 'grey', alpha: out });
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
  if (t >= 90 && (t % 60) < 40) drawText(ctx, isTouchUI() ? 'TAP TO RETURN TO TITLE' : 'PUSH START', W / 2, 166, { style: 'white', align: 'center' });
}

// --- continue countdown
function drawContinue(ctx, world) {
  const t = world.sceneT;
  shade(ctx, clamp(t / 20, 0, 1) * 0.55);
  const n = Math.max(0, 9 - Math.floor(t / 60));
  const ph = (t % 60) / 60;
  drawBig(ctx, 'CONTINUE?', W / 2, 52, { style: (t >> 4) & 1 ? 'gold' : 'hot', scale: 3, gap: 2 });
  const sc = 1 + 0.5 * Math.max(0, 1 - ph * 5);
  drawBig(ctx, String(n), W / 2, 92, { style: n <= 3 ? 'red' : 'steel', scale: 4, gap: 2, sx: sc, sy: sc, alpha: 1 - Math.max(0, ph - 0.85) * 4 });
  if ((t % 50) < 36) drawText(ctx, isTouchUI() ? 'TAP TO CONTINUE' : 'PUSH START TO CONTINUE', W / 2, 136, { style: 'white', align: 'center' });
  drawText(ctx, 'FREE PLAY - THE FIGHT RESUMES WHERE YOU FELL', W / 2, 148, { style: 'dim', align: 'center' });
  const d = world.hudState && world.hudState.ev && world.hudState.ev.lastDeath;
  if (d) {
    drawText(ctx, 'HIT BY: ' + d.name, W / 2, 166, { style: 'red', align: 'center' });
    drawText(ctx, String(d.hint || '').slice(0, 64), W / 2, 177, { style: 'green', align: 'center' });
  }
  if (world.continues > 0) drawText(ctx, `CONTINUES USED ${world.continues}`, W / 2, 196, { style: 'grey', align: 'center' });
}

// --- all clear / ending
function drawAllClear(ctx, world) {
  const t = world.sceneT;
  shade(ctx, clamp(t / 60, 0, 1) * 0.6);
  ctx.drawImage(vignette(), 0, 0);
  const k = easeOutCubic(clamp((t - 10) / 20, 0, 1));
  if (t >= 10) drawBig(ctx, 'ALL CLEAR', W / 2, 30, { style: t < 40 && (t >> 2) & 1 ? 'hot' : 'gold', scale: 4, gap: 3, sx: k });
  if (t >= 50) drawBig(ctx, 'CONGRATULATIONS!', W / 2, 66, { style: 'pink', scale: 2, gap: 2, alpha: clamp((t - 50) / 20, 0, 1) });
  const hs = world.hudState || {};
  const secs = Math.floor((hs.runFrames || 0) / 60);
  const rows = [
    ['ZONES CLEARED', String(hs.zonesCleared || zoneOrder().length)],
    ['TOTAL TIME', `${Math.floor(secs / 60)}'${String(secs % 60).padStart(2, '0')}"`],
    ['CONTINUES', String(world.continues | 0)],
    ['TOTAL SCORE', String(world.score).padStart(8, '0')],
  ];
  rows.forEach(([a, b], i) => {
    if (t < 90 + i * 24) return;
    const y = 96 + i * 14;
    drawText(ctx, a, W / 2 - 100, y, { style: i === 3 ? 'cyan' : 'white' });
    drawText(ctx, b, W / 2 + 100, y, { style: 'gold', align: 'right' });
  });
  if (t >= 200) {
    const msg = world.continues > 0 ? 'NEXT TIME, TRY IT WITHOUT CONTINUES!' : 'A FLAWLESS RAID. THE ABYSS IS QUIET AGAIN.';
    drawText(ctx, msg, W / 2, 162, { style: 'green', align: 'center' });
    drawText(ctx, 'THANK YOU FOR PLAYING', W / 2, 178, { style: 'pink', align: 'center' });
  }
  if (t >= 240 && (t % 60) < 40) drawText(ctx, startPrompt(), W / 2, 196, { style: 'white', align: 'center' });
}

export function zoneStyle(letter) { return letter === 'G' ? 'lime' : 'cyan'; }
