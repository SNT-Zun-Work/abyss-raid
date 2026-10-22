// Fun-pass feedback UI, driven by world.lastEvents (each event seen once):
//   CHAIN readout (top-left of playfield, scale-pop, fades ~1 s after the chain ends)
//   "SCHOOL WIPED!" slam banner + bonus (placed on the half away from the player)
//   "GILL n/6" popups at the torn gill, and a 6-pip gill tracker under the boss gauge
//   "STUN!" banner + "BREAK CHANCE" countdown bar
// State lives in world.hudState.ev (reset with the HUD). Banners/chain draw in
// PLAYFIELD coords (called from scenes.draw); the gill tracker in SCREEN coords (hud.draw).
import { W, H, HUD_H } from '../config.js';
import { clamp, easeOutCubic } from '../core/util.js';
import { drawText, bigText, drawBig, textWidth } from './ui-font.js';
import { alarmBand, hazard, HAZ_P } from './ui-art.js';
import * as bossMod from './boss.js'; // circular, read at runtime only (GILL_REGROW / gillRegrowLeft)

const CHAIN_GAP = 45, CHAIN_FADE = 60;
const N_GILLS = 6;

export function initEvents(hs) {
  hs.ev = { chain: 0, chainT: 9999, chainPop: 0, banners: [], popups: [], stun: null, gillFallback: Array(N_GILLS).fill('alive'), gillFlash: 0, regrowIn: 420, hint: null, hintShown: false, prevGill: null, links: [], estLeft: Array(N_GILLS).fill(0), death: null, lastDeath: null, deaths: 0, lastSafe: null, final: null };
}

export function updateEvents(world) {
  const hs = world.hudState;
  if (!hs) return;
  if (!hs.ev) initEvents(hs);
  const S = hs.ev;
  const evs = Array.isArray(world.lastEvents) ? world.lastEvents : [];
  for (const e of evs) {
    if (!e || typeof e.type !== 'string') continue;
    switch (e.type) {
      case 'fishKill': {
        const c = Number(e.chain) || 1;
        S.chain = c;
        S.chainT = 0;
        if (c >= 3) S.chainPop = 6;
        break;
      }
      case 'schoolEscaped':
        S.chainT = Math.max(S.chainT, CHAIN_GAP); // let the readout fade now
        break;
      case 'chainBreak':
        S.chainT = Math.max(S.chainT, CHAIN_GAP + CHAIN_FADE - 18); // quick fade
        break;
      case 'schoolWiped': {
        const py = world.player ? world.player.y : H / 2;
        S.banners.push({ kind: 'wipe', t: 0, life: 52, bonus: Number(e.bonus) || 0, size: Number(e.size) || 0, y: py < H / 2 ? Math.round(H * 0.66) : Math.round(H * 0.2) });
        if (S.banners.length > 3) S.banners.shift();
        break;
      }
      case 'gillKill': {
        const left = clamp(Number(e.left) || 0, 0, N_GILLS);
        // the final gill folds into the STUN display (no separate popup)
        if (left > 0) S.popups.push({ text: `GILL ${N_GILLS - left}/${N_GILLS}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'red' });
        if (Number(e.regrowIn) > 0) S.regrowIn = Number(e.regrowIn);
        S.estLeft = S.estLeft.map((v) => (v > 0 ? v + 300 : v)); // fallback: kills stall other stumps
        S.pendKill = (S.pendKill || []).concat([{ x: Number(e.x), y: Number(e.y) }]);
        if (!S.hintShown) { S.hintShown = true; S.hint = { t: 0 }; }
        const i = S.gillFallback.indexOf('alive');
        if (i >= 0) S.gillFallback[i] = 'dead';
        S.gillFlash = 16;
        break;
      }
      case 'gillRegrow': {
        S.pendRegrow = (S.pendRegrow || []).concat([{ x: Number(e.x), y: Number(e.y) }]);
        const i = S.gillFallback.indexOf('dead');
        if (i >= 0) S.gillFallback[i] = 'alive';
        break;
      }
      case 'stunStart':
        S.stun = { t: 0, frames: Math.max(30, Number(e.frames) || 240) };
        S.popups.length = 0;
        S.hint = null;
        for (const bn of S.banners) bn.t = Math.max(bn.t, bn.life - 8); // clear the stage for STUN
        break;
      case 'stunEnd':
        if (S.stun) S.stun.end = true;
        break;
      case 'playerDeath': {
        const info = causeInfo(e.cause);
        const b = world.boss;
        let safe = null;
        // exact attack only: player's snapshot first, else our last hint if its attack id matches
        const snap = e.safe;
        if (snap && Array.isArray(snap.rects)) safe = { cause: snap.cause ?? e.cause, atk: snap.atk, rects: snap.rects.map((r) => ({ ...r })), text: snap.text };
        else if (S.lastSafe && e.atk !== undefined && e.atk !== null && S.lastSafe.atk === e.atk) safe = S.lastSafe;
        void b;
        S.deaths++;
        S.death = { t: 0, x: Number(e.x), y: Number(e.y), cause: e.cause, name: info.name, hint: (safe && safe.text) || info.hint, safe };
        S.lastDeath = S.death;
        break;
      }
      case 'phaseChange':
        if (Number(e.to) === 4) {
          S.final = { t: 0 };
          world.flash = Math.max(world.flash || 0, 0.9);
        }
        break;
    }
  }
  S.chainT++;
  if (S.chainPop > 0) S.chainPop--;
  if (S.gillFlash > 0) S.gillFlash--;
  for (let i = S.banners.length - 1; i >= 0; i--) if (++S.banners[i].t > S.banners[i].life) S.banners.splice(i, 1);
  for (let i = S.popups.length - 1; i >= 0; i--) if (++S.popups[i].t > S.popups[i].life) S.popups.splice(i, 1);
  if (S.popups.length > 6) S.popups.splice(0, S.popups.length - 6);
  if (S.hint && ++S.hint.t > 130) S.hint = null;
  if (S.death && ++S.death.t > 160) S.death = null;
  if (S.final && ++S.final.t > 170) S.final = null;
  // remember the most recent safe-zone hint (attacks may clear it before the death event lands)
  const sh = world.boss && world.boss.safeHint;
  if (sh && Array.isArray(sh.rects) && sh.rects.length) S.lastSafe = { cause: sh.cause, atk: sh.atk, rects: sh.rects.map((r) => ({ ...r })), text: sh.text, frame: world.frame };
  trackGills(world, S);
  if (S.stun) {
    // follow gameplay time: prefer the boss's own stun clock (pauses with hitstop)
    const b = world.boss;
    if (b && typeof b.stunT === 'number' && typeof b.stunFrames === 'number' && b.stunFrames > 0) {
      S.stun.t = b.stunFrames - b.stunT; S.stun.frames = b.stunFrames; // boss.stunT counts DOWN
      if (b.stunned === false && S.stun.t > 4) S.stun.end = true;
    } else if (!(world.hitstop > 0)) S.stun.t++;
    S.stun.anim = (S.stun.anim || 0) + (world.hitstop > 0 ? 0 : 1); // banner animation clock
    if (S.stun.end || S.stun.t > S.stun.frames + 20) { S.stun.outT = (S.stun.outT || 0) + 1; if (S.stun.outT > 16) S.stun = null; }
  }
}

// Cause id -> {name, hint} via the boss's CAUSES table (guarded), else a readable fallback.
export function causeInfo(cause) {
  const C = bossMod.CAUSES;
  const c = C && cause && C[cause];
  const fallbackName = cause ? String(cause).replace(/[_-]+/g, ' ').toUpperCase() : 'UNKNOWN';
  return {
    name: String((c && c.name) || fallbackName).toUpperCase(),
    hint: String((c && c.hint) || 'WATCH THE WIND-UP AND MOVE EARLY').toUpperCase(),
  };
}

function gillPos(b, i) {
  const q = b && b.pose && b.pose.gills && b.pose.gills[i];
  const m = q && (q.mid || q.tip || q.base);
  return m && Number.isFinite(m.x) ? { x: m.x, y: m.y } : null;
}
function trackGills(world, S) {
  const b = world.boss;
  const gills = b && Array.isArray(b.gills) ? b.gills : null;
  for (let i = S.links.length - 1; i >= 0; i--) if (++S.links[i].t > 14) S.links.splice(i, 1);
  for (let i = 0; i < S.estLeft.length; i++) if (S.estLeft[i] > 0) S.estLeft[i]--;
  if (!gills) { S.pendKill = S.pendRegrow = null; return; }
  const now = gills.map((g) => g && g.state);
  if (S.prevGill && S.prevGill.length === now.length) {
    for (let i = 0; i < now.length; i++) {
      const was = S.prevGill[i], is = now[i];
      if (was !== 'dead' && is === 'dead') {
        const ev = S.pendKill && S.pendKill.shift();
        const at = ev && Number.isFinite(ev.x) ? ev : gillPos(b, i);
        if (at) S.links.push({ i, x: at.x, y: at.y, t: 0, kind: 'kill' });
        S.estLeft[i] = S.regrowIn;
      } else if (was !== 'alive' && is === 'alive') {
        const ev = S.pendRegrow && S.pendRegrow.shift();
        const at = ev && Number.isFinite(ev.x) ? ev : gillPos(b, i);
        if (at) S.links.push({ i, x: at.x, y: at.y, t: 0, kind: 'regrow' });
      }
    }
  }
  S.prevGill = now;
  S.pendKill = S.pendRegrow = null;
}

// Frames until gill i starts regrowing, from live boss state (best source first).
function regrowLeft(world, S, i) {
  const b = world.boss, g = b && b.gills && b.gills[i];
  if (!g || g.state !== 'dead') return Infinity;
  if (typeof bossMod.gillRegrowLeft === 'function') {
    const v = bossMod.gillRegrowLeft(world, i);
    if (Number.isFinite(v)) return v;
  }
  const R = bossMod.GILL_REGROW;
  const total = R && typeof R === 'object' ? R[b.phase] : typeof R === 'number' ? R : null;
  if (Number.isFinite(total) && Number.isFinite(g.t)) return b.mode === 'stun' ? Infinity : total - g.t;
  return S.estLeft[i] > 0 ? S.estLeft[i] : Infinity;
}

// --------------------------------------------------------------- drawing
export function drawEvents(ctx, world) {
  const S = world.hudState && world.hudState.ev;
  if (!S) return;
  drawChain(ctx, S, world);
  for (const p of S.popups) {
    const k = p.t / p.life;
    const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const x = clamp(p.x, 30, W - 30), y = clamp(p.y - 10 - easeOutCubic(Math.min(1, p.t / 20)) * 12, 14, H - 10);
    drawText(ctx, p.text, x, y, { style: p.t < 6 && (p.t & 2) ? 'white' : p.style, align: 'center', alpha: a });
  }
  for (const b of S.banners) drawWipe(ctx, b, world);
  if (S.stun) drawStun(ctx, S.stun);
  if (S.death) drawDeath(ctx, S.death, world);
  if (S.final) drawFinal(ctx, S.final, world);
}

// Wrap text to a max width in characters.
function wrap(str, maxChars) {
  const out = [];
  let line = '';
  for (const w of String(str).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}

// After a death: where you were (red X), where you should have been (SAFE rects), and why.
function drawDeath(ctx, d, world) {
  const t = d.t;
  const a = t < 8 ? t / 8 : t > 140 ? (160 - t) / 20 : 1;
  if (a <= 0) return;
  // safe zones: dashed green boxes
  if (d.safe && d.safe.rects) {
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    for (const r of d.safe.rects) {
      const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
      if (!(w > 0 && h > 0)) continue;
      ctx.fillStyle = 'rgba(60,255,140,0.10)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#5cff9a';
      const dash = 4, off = (t >> 1) % (dash * 2);
      for (let k = -off; k < w; k += dash * 2) { const sx = Math.max(0, k), ex = Math.min(w, k + dash); if (ex > sx) { ctx.fillRect(x + sx, y, ex - sx, 1); ctx.fillRect(x + sx, y + h - 1, ex - sx, 1); } }
      for (let k = -off; k < h; k += dash * 2) { const sy = Math.max(0, k), ey = Math.min(h, k + dash); if (ey > sy) { ctx.fillRect(x, y + sy, 1, ey - sy); ctx.fillRect(x + w - 1, y + sy, 1, ey - sy); } }
      ctx.restore(); ctx.save(); ctx.globalAlpha = a;
      drawText(ctx, 'SAFE', clamp(x + w / 2, 14, W - 14), clamp(y + h / 2 - 3, 2, H - 9), { style: 'green', align: 'center' });
      ctx.globalAlpha = a * 0.9;
    }
    ctx.restore();
  }
  // red X at the death position
  if (Number.isFinite(d.x) && Number.isFinite(d.y) && ((t >> 3) & 1 || t > 40)) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ff3040';
    const cx = Math.round(d.x), cy = Math.round(d.y);
    for (let k = -5; k <= 5; k++) { ctx.fillRect(cx + k, cy + k, 2, 1); ctx.fillRect(cx - k, cy + k, 2, 1); }
    ctx.globalAlpha = 1;
  }
  // cause panel: bottom, on the half away from the respawn point (ship respawns left-centre)
  const lines = wrap(d.hint, 36);
  // panel at the TOP of the playfield (under the boss gauge, centred) so lower escape routes stay visible
  const pw = 230, ph = 16 + lines.length * 9;
  const S = world.hudState && world.hudState.ev;
  const px = Math.round(W / 2 - pw / 2), py = S && S.stun ? 34 : 12;
  ctx.globalAlpha = a * 0.85;
  ctx.fillStyle = 'rgba(16,2,8,0.85)';
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = '#ff3040';
  ctx.fillRect(px, py, 2, ph);
  ctx.globalAlpha = 1;
  drawText(ctx, 'HIT BY: ' + d.name, px + 7, py + 4, { style: 'red', alpha: a });
  lines.forEach((l, i) => drawText(ctx, l, px + 7, py + 14 + i * 9, { style: i === 0 ? 'green' : 'white', alpha: a }));
}

// FINAL FORM interlude: flash, red warning ticker, name re-announce.
function drawFinal(ctx, f, world) {
  const t = f.t;
  const a = t < 10 ? t / 10 : t > 150 ? (170 - t) / 20 : 1;
  const band = alarmBand(16), hz = hazard(4);
  const y = 40;
  const slide = Math.round((1 - easeOutCubic(clamp(t / 14, 0, 1))) * W);
  ctx.globalAlpha = a * 0.92;
  ctx.drawImage(band, slide, y);
  const s1 = ((t * 1.5) % HAZ_P);
  ctx.drawImage(hz, -s1 - HAZ_P + slide, y - 4);
  ctx.drawImage(hz, s1 - HAZ_P + slide, y + 16);
  ctx.globalAlpha = 1;
  const msg = 'WARNING  !!  FINAL FORM  !!  ';
  const mw = textWidth(msg) + 6;
  const off = (t * 1.4) % mw;
  for (let x = -off; x < W; x += mw) drawText(ctx, msg, Math.round(x) + slide, y + 4, { style: 'white', alpha: a });
  if (t > 16) {
    const k = easeOutCubic(clamp((t - 16) / 10, 0, 1));
    drawBig(ctx, 'AMBYSTOMA ROSEA', W / 2, 70, { style: (t >> 2) & 1 && t < 50 ? 'hot' : 'pink', scale: 2, gap: 2, sx: 1.6 - 0.6 * k, sy: k, alpha: a });
    drawBig(ctx, '- FINAL FORM -', W / 2, 92, { style: 'red', scale: 2, gap: 2, alpha: a * k });
  }
}

// one-time teaching hint, right side under the gill tracker (screen coords)
export function drawGillHint(ctx, world) {
  const S = world.hudState && world.hudState.ev;
  if (!S || !S.hint) return;
  const t = S.hint.t;
  const a = t < 8 ? t / 8 : t > 110 ? (130 - t) / 20 : 1;
  const msg = 'BREAK ALL 6 GILLS → STUN';
  const x = W - 8, y = HUD_H + 24;
  ctx.globalAlpha = a * 0.8;
  ctx.fillStyle = '#0a0410';
  ctx.fillRect(x - msg.length * 6 - 4, y - 2, msg.length * 6 + 6, 11);
  ctx.globalAlpha = 1;
  drawText(ctx, msg, x, y, { style: (t >> 3) & 1 ? 'gold' : 'white', align: 'right', alpha: a });
}

const CHAIN_BOX = { x: 10, y: 16, w: 70, h: 18 };
function drawChain(ctx, S, world) {
  if (S.chain < 3) return;
  const fadeT = S.chainT - CHAIN_GAP;
  let a = fadeT <= 0 ? 1 : 1 - fadeT / CHAIN_FADE;
  if (a <= 0) return;
  // keep the ship readable: drop to 40% when it is near the readout box
  const p = world.player;
  if (p && p.alive !== false) {
    const B = CHAIN_BOX;
    const dx = Math.max(B.x - p.x, 0, p.x - (B.x + B.w)), dy = Math.max(B.y - p.y, 0, p.y - (B.y + B.h));
    if (dx * dx + dy * dy < 40 * 40) a *= 0.4;
  }
  const pop = S.chainPop / 6; // 1 -> 0
  const sc = 1 + 0.25 * pop; // capped pop
  const num = String(Math.min(999, S.chain));
  const style = S.chain >= 20 ? 'gold' : S.chain >= 10 ? 'pink' : 'cyan';
  const img = bigText(num, { style: pop > 0.5 ? 'hot' : style, scale: 2, gap: 1 });
  const prevA = ctx.globalAlpha;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // scale number + label together around the box's left-centre
  ctx.translate(CHAIN_BOX.x, CHAIN_BOX.y + 7);
  ctx.scale(sc, sc);
  ctx.globalAlpha = prevA * a;
  ctx.drawImage(img, -img.pad, -7 - img.pad);
  ctx.globalAlpha = prevA;
  drawText(ctx, 'CHAIN', img.width - 2 * img.pad + 3, -1, { style, alpha: a });
  ctx.restore();
}

function drawWipe(ctx, b, world) {
  const t = b.t, L = b.life;
  // slam in (0..6), hold, stretch out (L-8..L)
  let sx = 1, sy = 1, a = 1;
  if (t < 6) { const k = easeOutCubic(t / 6); sx = 2.6 - 1.6 * k; sy = 0.4 + 0.6 * k; a = 0.4 + 0.6 * k; }
  else if (t > L - 8) { const k = (t - (L - 8)) / 8; sx = 1 + k * 0.8; sy = 1 - k * 0.8; a = 1 - k; }
  const cx = Math.round(W * 0.56);
  const style = t < 10 && (t & 2) ? 'hot' : 'gold';
  if (t < 4) { ctx.fillStyle = `rgba(255,240,200,${0.18 * (1 - t / 4)})`; ctx.fillRect(0, b.y - 6, W, 34); }
  drawBig(ctx, 'SCHOOL WIPED!', cx, b.y, { style, scale: 2, gap: 2, sx, sy, alpha: a });
  if (t >= 4 && b.bonus > 0) drawText(ctx, `BONUS ${b.bonus}`, cx, b.y + 18, { style: 'gold', align: 'center', alpha: a });
}

function drawStun(ctx, st) {
  const out = st.outT ? 1 - st.outT / 16 : 1;
  const left = clamp(1 - st.t / st.frames, 0, 1);
  const an = st.anim || 0;
  const bw = 132, x0 = Math.round(W / 2 - bw / 2), y0 = 26;
  // 0..22: "STUN!" slams in big; 22..32: it shrinks up into the countdown plate
  if (an < 32) {
    const k = easeOutCubic(clamp(an / 6, 0, 1));
    const m = an < 22 ? 0 : easeOutCubic((an - 22) / 10);
    const scale = 1 - 0.7 * m;
    const y = Math.round((1 - m) * 46 + m * (y0 - 9));
    const style = an < 22 && (an >> 2) & 1 ? 'red' : 'hot';
    drawBig(ctx, 'STUN!', Math.round(W / 2 + (x0 + 15 - W / 2) * m), y, { style, scale: 4, gap: 3, sx: (1.7 - 0.7 * k) * scale, sy: k * scale, alpha: out * (1 - m) });
    if (an < 22) return;
  }
  const pa = clamp((an - 25) / 6, 0, 1) * out;
  ctx.globalAlpha = pa;
  ctx.fillStyle = 'rgba(24,0,10,0.78)';
  ctx.fillRect(x0 - 3, y0 - 11, bw + 6, 18);
  ctx.fillStyle = '#ff3a4a';
  ctx.fillRect(x0 - 3, y0 - 11, bw + 6, 1);
  ctx.globalAlpha = 1;
  drawText(ctx, 'STUN!', x0, y0 - 9, { style: 'red', alpha: pa });
  drawText(ctx, 'BREAK CHANCE', x0 + bw, y0 - 9, { style: (an >> 3) & 1 ? 'gold' : 'white', align: 'right', alpha: pa });
  ctx.globalAlpha = pa;
  ctx.fillStyle = '#3a0814';
  ctx.fillRect(x0, y0, bw, 4);
  ctx.fillStyle = left < 0.25 && (an >> 2) & 1 ? '#ffffff' : '#ffcc30';
  ctx.fillRect(x0, y0, Math.round(bw * left), 4);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(x0, y0, Math.round(bw * left), 1);
  ctx.globalAlpha = 1;
}

// Gill tracker under the boss gauge (SCREEN coords). Reads boss.gills when present.
export function drawGillTracker(ctx, world, t) {
  const b = world.boss;
  const S = world.hudState && world.hudState.ev;
  const gills = b && Array.isArray(b.gills) && b.gills.length ? b.gills : null;
  const n = gills ? Math.min(8, gills.length) : N_GILLS;
  const y = HUD_H + 12;
  const x0 = W - 8 - n * 9;
  ctx.fillStyle = 'rgba(2,2,10,0.82)';
  ctx.fillRect(x0 - 36, y - 2, n * 9 + 42, 11);
  ctx.fillStyle = '#5a1838';
  ctx.fillRect(x0 - 36, y + 9, n * 9 + 42, 1);
  const flash = S && S.gillFlash > 0 && (S.gillFlash >> 1) & 1;
  drawText(ctx, 'GILLS', x0 - 32, y, { style: flash ? 'white' : 'pink', shadow: false });
  for (let i = 0; i < n; i++) {
    const g = gills ? gills[i] : { state: S ? S.gillFallback[i] : 'alive' };
    const x = x0 + i * 9;
    const state = g && g.state;
    const soon = (state === 'dead' && S && regrowLeft(world, S, i) <= 120) || state === 'regrow';
    if (soon && (t >> 2) & 1) {
      // about to regrow: blink the pip bright pink (race warning)
      ctx.fillStyle = '#ffd0ea'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#ff6ab4'; ctx.fillRect(x + 1, y + 1, 5, 5);
    } else if (state === 'dead') {
      // broken pip: dark socket with a red crack
      ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 1, 5, 5);
      ctx.fillStyle = '#ff4050';
      for (let k = 0; k < 5; k++) { ctx.fillRect(x + 1 + k, y + 1 + k, 1, 1); ctx.fillRect(x + 5 - k, y + 1 + k, 1, 1); }
    } else if (state === 'regrow') {
      // budding: grows from the bottom, pulsing
      const s = clamp(typeof g.scale === 'number' ? g.scale : 0.5, 0, 1);
      ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 1, 5, 5);
      const h = Math.max(1, Math.round(6 * s));
      ctx.fillStyle = (t >> 3) & 1 ? '#ff8cc8' : '#c04c88';
      ctx.fillRect(x + 1, y + 6 - Math.min(5, h), 5, Math.min(5, h));
    } else {
      ctx.fillStyle = '#5a1838'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#ff6ab4'; ctx.fillRect(x + 1, y + 1, 5, 5);
      ctx.fillStyle = '#ffd0ea'; ctx.fillRect(x + 1, y + 1, 3, 1);
    }
  }
  drawGillLinks(ctx, world);
}

// Thin flash line from a tracker pip to the gill it represents (~14 frames), SCREEN coords.
function drawGillLinks(ctx, world) {
  const S = world.hudState && world.hudState.ev;
  const b = world.boss;
  if (!S || !S.links.length) return;
  const n = b && Array.isArray(b.gills) && b.gills.length ? Math.min(8, b.gills.length) : N_GILLS;
  const x0 = W - 8 - n * 9, py = HUD_H + 12 + 3;
  for (const L of S.links) {
    const a = 1 - L.t / 14;
    const px = x0 + L.i * 9 + 3;
    const gx = Math.round(L.x), gy = Math.round(L.y + HUD_H);
    const col = L.kind === 'kill' ? '255,80,96' : '255,150,210';
    ctx.strokeStyle = `rgba(${col},${(0.85 * a).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + 4.5);
    ctx.lineTo(gx + 0.5, gy + 0.5);
    ctx.stroke();
    // matching flashes at both ends
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    ctx.fillRect(px - 2, py - 4, 9, 9);
    const r = 3 + Math.round(L.t / 3);
    ctx.strokeStyle = `rgba(${col},${a.toFixed(2)})`;
    ctx.strokeRect(gx - r + 0.5, gy - r + 0.5, r * 2, r * 2);
  }
}
