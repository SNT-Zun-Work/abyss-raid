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
      case 'skimBonus': {
        // zone G: flying low over the water pays out; popup just above the ship
        const p = world.player;
        const v = Math.max(0, Number(e.value) || 0);
        const x = p && Number.isFinite(p.x) ? p.x + 6 : Number(e.x) || W / 2;
        const y = p && Number.isFinite(p.y) ? p.y - 12 : Number(e.y) || H / 2;
        S.popups.push({ text: `SKIM +${v}`, x, y, t: 0, life: 40, style: 'cyan' });
        S.skimT = 0;
        if (!S.skimHintShown) { S.skimHintShown = true; S.hint = { t: 0, msg: 'FLY LOW OVER THE WATER: SKIM BONUS' }; }
        break;
      }
      case 'thread': {
        // zone G chase: threading a mud-wall gate / shooting one open / breaking the cannon nozzle
        const v = Math.max(0, Number(e.value) || 0);
        const p = world.player;
        const lab = typeof e.label === 'string' ? e.label.slice(0, 16) : 'THREAD';
        const x = lab === 'THREAD' && p && Number.isFinite(p.x) ? p.x + 6 : Number(e.x) || W / 2;
        const y = lab === 'THREAD' && p && Number.isFinite(p.y) ? p.y - 12 : Number(e.y) || H / 2;
        S.popups.push({ text: `${lab} +${v}`, x: clamp(x, 10, W - 90), y: clamp(y, 30, H - 10), t: 0, life: 44, style: lab === 'THREAD' ? 'cyan' : 'gold' });
        if (!S.threadHintShown && lab === 'THREAD') { S.threadHintShown = true; S.hint = { t: 0, msg: 'THREAD THE GLOWING GATES' }; }
        break;
      }
      case 'escape':
        S.escape = { t: 0 };
        S.popups.length = 0;
        break;
      case 'chainBreak':
        S.chainT = Math.max(S.chainT, CHAIN_GAP + CHAIN_FADE - 18); // quick fade
        break;
      case 'schoolWiped': {
        const py = world.player ? world.player.y : H / 2;
        S.banners.push({ kind: 'wipe', label: e.kind === 'gull' ? 'FLOCK WIPED!' : 'SCHOOL WIPED!', t: 0, life: 52, bonus: Number(e.bonus) || 0, size: Number(e.size) || 0, y: py < H / 2 ? Math.round(H * 0.66) : Math.round(H * 0.2) });
        if (S.banners.length > 3) S.banners.shift();
        break;
      }
      case 'gillKill': {
        if (e.part === 'mud') {
          // new zone G: breakable mud armor plates
          const total = Math.max(1, Number(e.total) || 1);
          const mleft = clamp(Number(e.left) || 0, 0, total);
          S.popups.push({ text: 'MUD ' + (total - mleft) + '/' + total, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'sand' });
          if (!S.mudHintShown) { S.mudHintShown = true; S.hint = { t: 0, msg: 'PEEL THE MUD ARMOR' }; }
          S.gillFlash = 16;
          break;
        }
        if (e.part === 'tail') {
          // new zone G chase: "TAIL n/5"
          const total = Math.max(1, Number(e.total) || 5);
          const tleft = clamp(Number(e.left) || 0, 0, total);
          S.popups.push({ text: `TAIL ${total - tleft}/${total}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'gold' });
          S.gillFlash = 16;
          break;
        }
        if (e.part === 'eye' && world.boss && world.boss.half !== undefined) {
          // new zone G (hybrid): eyes are just glowing parts, no BLINDED
          const total = Math.max(1, Number(e.total) || 2);
          const eleft = clamp(Number(e.left) || 0, 0, total);
          S.popups.push({ text: `EYE ${total - eleft}/${total}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'red' });
          S.gillFlash = 16;
          break;
        }
        if (e.part === 'sail' && world.boss && world.boss.half !== undefined) {
          const total = Math.max(1, Number(e.total) || 1);
          const sleft = clamp(Number(e.left) || 0, 0, total);
          S.popups.push({ text: total > 1 ? `SAIL ${total - sleft}/${total}` : 'SAIL BROKEN!', x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'gold' });
          S.gillFlash = 16;
          break;
        }
        if (e.part === 'sail' || e.part === 'fin') {
          // zone M: "SAIL n/3" / "FIN n/2"
          const total = Math.max(1, Number(e.total) || (e.part === 'sail' ? 3 : 2));
          const pleft = clamp(Number(e.left) || 0, 0, total);
          S.popups.push({ text: `${e.part === 'sail' ? 'SAIL' : 'FIN'} ${total - pleft}/${total}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: e.part === 'sail' ? 'gold' : 'red' });
          if (!S.flipHintShown) { S.flipHintShown = true; S.hint = { t: 0, msg: 'BREAK THE SAILS \u2192 FLIP IT OVER' }; }
          S.gillFlash = 16;
          break;
        }
        if (e.part === 'eye') {
          // zone G eye turrets: "EYE n/2"; the last one folds into the BLINDED display
          const total = Math.max(1, Number(e.total) || 2);
          const eleft = clamp(Number(e.left) || 0, 0, total);
          if (eleft > 0) S.popups.push({ text: `EYE ${total - eleft}/${total}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'red' });
          if (Number(e.regrowIn) > 0) S.eyeRegen = Number(e.regrowIn);
          if (!S.eyeHintShown) { S.eyeHintShown = true; S.hint = { t: 0, msg: 'SHOOT BOTH EYES \u2192 BLINDED' }; }
          S.gillFlash = 16;
          break;
        }
        const left = clamp(Number(e.left) || 0, 0, N_GILLS);
        // the final gill folds into the STUN display (no separate popup)
        if (left > 0) S.popups.push({ text: `GILL ${N_GILLS - left}/${N_GILLS}`, x: Number(e.x) || W / 2, y: Number(e.y) || H / 2, t: 0, life: 44, style: 'red' });
        if (Number(e.regrowIn) > 0) S.regrowIn = Number(e.regrowIn);
        S.estLeft = S.estLeft.map((v) => (v > 0 ? v + 300 : v)); // fallback: kills stall other stumps
        S.pendKill = (S.pendKill || []).concat([{ x: Number(e.x), y: Number(e.y) }]);
        if (!S.hintShown) { S.hintShown = true; S.hint = { t: 0, msg: 'BREAK ALL 6 GILLS \u2192 STUN' }; }
        const i = S.gillFallback.indexOf('alive');
        if (i >= 0) S.gillFallback[i] = 'dead';
        S.gillFlash = 16;
        break;
      }
      case 'gillRegrow': {
        if (e.part === 'eye' || e.part === 'sail' || e.part === 'fin') break;
        S.pendRegrow = (S.pendRegrow || []).concat([{ x: Number(e.x), y: Number(e.y) }]);
        const i = S.gillFallback.indexOf('dead');
        if (i >= 0) S.gillFallback[i] = 'alive';
        break;
      }
      case 'stunStart':
        S.stun = { t: 0, frames: Math.max(30, Number(e.frames) || 240), reason: e.reason || 'stun' };
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
        if (Number(e.to) === 2 && world.boss && world.boss.half !== undefined && !S.tailHintShown) {
          S.tailHintShown = true; S.hint = { t: 0, msg: 'SHOOT THE GLOWING TAIL SEGMENT' };
        }
        if (Number(e.to) === 4) {
          S.final = { t: 0 };
          world.flash = Math.max(world.flash || 0, 0.9);
        }
        break;
    }
  }
  S.chainT++;
  S.skimT = (S.skimT ?? 999) + 1;
  if (S.chainPop > 0) S.chainPop--;
  if (S.gillFlash > 0) S.gillFlash--;
  for (let i = S.banners.length - 1; i >= 0; i--) if (++S.banners[i].t > S.banners[i].life) S.banners.splice(i, 1);
  for (let i = S.popups.length - 1; i >= 0; i--) if (++S.popups[i].t > S.popups[i].life) S.popups.splice(i, 1);
  if (S.popups.length > 6) S.popups.splice(0, S.popups.length - 6);
  if (S.hint && ++S.hint.t > 130) S.hint = null;
  if (S.escape && ++S.escape.t > 150) S.escape = null;
  // new zone G: one-time "glowing parts" hint once the fight starts (first half)
  const bb = world.boss;
  if (bb && bb.half !== undefined && world.scene === 'boss' && !S.partsHintShown && world.sceneT > 90 && Number(bb.half) !== 2) {
    S.partsHintShown = true; S.hint = { t: 0, msg: 'SHOOT THE GLOWING PARTS' };
  }
  if (bb && Number(bb.half) === 2 && !S.tailHintShown) { S.tailHintShown = true; S.hint = { t: 0, msg: 'SHOOT THE GLOWING TAIL SEGMENT' }; }
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
  drawSkim(ctx, S, world);
  for (const p of S.popups) {
    const k = p.t / p.life;
    const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const x = clamp(p.x, 30, W - 30), y = clamp(p.y - 10 - easeOutCubic(Math.min(1, p.t / 20)) * 12, 14, H - 10);
    drawText(ctx, p.text, x, y, { style: p.t < 6 && (p.t & 2) ? 'white' : p.style, align: 'center', alpha: a });
  }
  for (const b of S.banners) drawWipe(ctx, b, world);
  if (S.stun) drawStun(ctx, S.stun);
  if (S.escape) drawEscape(ctx, S.escape);
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
  const msg = S.hint.msg || 'BREAK ALL 6 GILLS → STUN';
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
  drawBig(ctx, b.label || 'SCHOOL WIPED!', cx, b.y, { style, scale: 2, gap: 2, sx, sy, alpha: a });
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
    drawBig(ctx, stunLabel(st), Math.round(W / 2 + (x0 + (stunLabel(st).length > 5 ? 24 : 15) - W / 2) * m), y, { style, scale: 4, gap: 3, sx: (1.7 - 0.7 * k) * scale, sy: k * scale, alpha: out * (1 - m) });
    if (an < 22) return;
  }
  const pa = clamp((an - 25) / 6, 0, 1) * out;
  ctx.globalAlpha = pa;
  ctx.fillStyle = 'rgba(24,0,10,0.78)';
  ctx.fillRect(x0 - 3, y0 - 11, bw + 6, 18);
  ctx.fillStyle = '#ff3a4a';
  ctx.fillRect(x0 - 3, y0 - 11, bw + 6, 1);
  ctx.globalAlpha = 1;
  drawText(ctx, stunLabel(st), x0, y0 - 9, { style: 'red', alpha: pa });
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

// Zone G: 2-pip EYES tracker under the boss gauge (SCREEN coords), from boss.eyes[i].state.
export function drawEyeTracker(ctx, world, t) {
  const b = world.boss;
  const S = world.hudState && world.hudState.ev;
  const eyes = b && Array.isArray(b.eyes) ? b.eyes : null;
  if (!eyes || !eyes.length) return;
  const n = Math.min(4, eyes.length);
  const y = HUD_H + 12;
  const x0 = W - 8 - n * 11;
  ctx.fillStyle = 'rgba(2,2,10,0.82)';
  ctx.fillRect(x0 - 34, y - 2, n * 11 + 40, 11);
  ctx.fillStyle = '#5a2010';
  ctx.fillRect(x0 - 34, y + 9, n * 11 + 40, 1);
  const flash = S && S.gillFlash > 0 && (S.gillFlash >> 1) & 1;
  drawText(ctx, 'EYES', x0 - 30, y, { style: flash ? 'white' : 'red', shadow: false });
  const regen = (S && S.eyeRegen) || 600;
  for (let i = 0; i < n; i++) {
    const e = eyes[i];
    const x = x0 + i * 11;
    ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y, 7, 7);
    if (e && e.state === 'ok') {
      ctx.fillStyle = '#3a0808'; ctx.fillRect(x + 1, y + 1, 5, 5);
      ctx.fillStyle = '#ff3a30'; ctx.fillRect(x + 2, y + 2, 3, 3);
      ctx.fillStyle = '#ffd0c0'; ctx.fillRect(x + 2, y + 2, 1, 1);
    } else {
      // destroyed / rebuilding: dark socket with an X, filling up as it rebuilds
      ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 1, 5, 5);
      const k = e && typeof e.t === 'number' ? clamp(e.t / regen, 0, 1) : 0;
      const h = Math.round(5 * k);
      if (h > 0) { ctx.fillStyle = k > 0.8 && (t >> 2) & 1 ? '#ffb0a0' : '#8a2a20'; ctx.fillRect(x + 1, y + 6 - h, 5, h); }
      ctx.fillStyle = '#ff4050';
      for (let q = 0; q < 5; q++) { ctx.fillRect(x + 1 + q, y + 1 + q, 1, 1); ctx.fillRect(x + 5 - q, y + 1 + q, 1, 1); }
    }
  }
}

// subtle teal glow on the water just under the ship while a skim streak continues
function drawSkim(ctx, S, world) {
  if (!(S.skimT < 110)) return;
  const p = world.player;
  if (!p || p.alive === false || !Number.isFinite(p.x)) return;
  const a = (S.skimT < 90 ? 1 : (110 - S.skimT) / 20) * (0.55 + 0.25 * Math.sin((world.frame || 0) * 0.3));
  let sy = p.y + 8;
  try { const m = typeof bossMod.current === 'function' ? bossMod.current(world) : null; if (m && Number.isFinite(m.SURFACE_Y)) sy = m.SURFACE_Y; } catch (e) { /* guard */ }
  if (sy - p.y > 30 || sy < p.y) sy = p.y + 8; // only meaningful when right above the surface
  const x = Math.round(p.x - 14), y = Math.round(sy);
  ctx.fillStyle = `rgba(120,255,230,${(0.5 * a).toFixed(2)})`;
  ctx.fillRect(x, y, 30, 1);
  ctx.fillStyle = `rgba(200,255,250,${(0.8 * a).toFixed(2)})`;
  ctx.fillRect(x + 8, y, 14, 1);
  ctx.fillStyle = `rgba(120,255,230,${(0.22 * a).toFixed(2)})`;
  ctx.fillRect(x + 4, y - 1, 22, 1);
  ctx.fillRect(x + 4, y + 1, 22, 1);
}

const STUN_LABEL = { blinded: 'BLINDED!', flipped: 'FLIPPED!' };
function stunLabel(st) { return STUN_LABEL[st && st.reason] || 'STUN!'; }

// Zone M: "SAILS ■■■ FINS ■■" tracker (SCREEN coords) from boss.sails / boss.fins.
export function drawPartTracker(ctx, world, t) {
  const b = world.boss;
  const S = world.hudState && world.hudState.ev;
  const sails = b && Array.isArray(b.sails) ? b.sails : [];
  const fins = b && Array.isArray(b.fins) ? b.fins : [];
  if (!sails.length && !fins.length) return;
  const y = HUD_H + 12;
  const wS = 34 + sails.length * 9, wF = 28 + fins.length * 9;
  const x0 = W - 8 - (wS + wF + 6);
  ctx.fillStyle = 'rgba(2,2,10,0.82)';
  ctx.fillRect(x0 - 4, y - 2, wS + wF + 14, 11);
  ctx.fillStyle = '#5a3a10';
  ctx.fillRect(x0 - 4, y + 9, wS + wF + 14, 1);
  const flash = S && S.gillFlash > 0 && (S.gillFlash >> 1) & 1;
  const pip = (x, q, col, hi) => {
    const st = q && q.state;
    ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y, 7, 7);
    ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 1, 5, 5);
    if (st === 'ok' || st === 'cracked') {
      const k = q && q.max > 0 ? clamp(q.hp / q.max, 0, 1) : 1;
      const h = Math.max(1, Math.round(5 * k));
      ctx.fillStyle = col; ctx.fillRect(x + 1, y + 6 - h, 5, h);
      ctx.fillStyle = hi; ctx.fillRect(x + 1, y + 6 - h, 5, 1);
      if (st === 'cracked') { ctx.fillStyle = '#120810'; ctx.fillRect(x + 3, y + 1, 1, 3); ctx.fillRect(x + 2, y + 3, 1, 2); }
    } else if (st === 'broken') {
      ctx.fillStyle = '#ff4050';
      for (let k = 0; k < 5; k++) { ctx.fillRect(x + 1 + k, y + 1 + k, 1, 1); ctx.fillRect(x + 5 - k, y + 1 + k, 1, 1); }
    } else {
      // regrowing: pulsing bud
      ctx.fillStyle = (t >> 3) & 1 ? hi : col; ctx.fillRect(x + 2, y + 3, 3, 3);
    }
  };
  let x = x0;
  drawText(ctx, 'SAILS', x, y, { style: flash ? 'white' : 'gold', shadow: false });
  x += 32;
  sails.forEach((q) => { pip(x, q, '#e0a030', '#fff0a0'); x += 9; });
  x += 6;
  drawText(ctx, 'FINS', x, y, { style: flash ? 'white' : 'red', shadow: false });
  x += 26;
  fins.forEach((q) => { pip(x, q, '#d04040', '#ffb0a0'); x += 9; });
}

// "TARGET ESCAPING": red bar with hazard chevrons (top-left of the playfield), ~2.5 s
function drawEscape(ctx, e) {
  const t = e.t;
  const a = t < 6 ? t / 6 : t > 130 ? (150 - t) / 20 : 1;
  const w = 196, h = 14, x0 = 16, y0 = 14;
  const slide = Math.round((1 - easeOutCubic(clamp(t / 10, 0, 1))) * -(w + 20));
  const x = x0 + slide;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(30,0,6,0.85)';
  ctx.fillRect(x, y0, w, h);
  ctx.fillStyle = '#ff2a3a';
  ctx.fillRect(x, y0, w, 1); ctx.fillRect(x, y0 + h - 1, w, 1);
  // chevrons at both ends (scrolling)
  const off = (t >> 1) % 6;
  for (const [cx, dir] of [[x + 4, 1], [x + w - 34, 1]]) {
    for (let k = 0; k < 4; k++) {
      const bx = cx + k * 7 + (dir > 0 ? off % 7 : 0);
      for (let r = 0; r < h - 4; r++) {
        const sx = bx + Math.abs(r - (h - 4) / 2) * -0.6 + 3;
        ctx.fillRect(Math.round(sx), y0 + 2 + r, 3, 1);
      }
    }
  }
  ctx.restore();
  if ((t >> 3) & 1 || t > 60) drawText(ctx, 'TARGET ESCAPING', x + w / 2, y0 + 4, { style: 'red', align: 'center', alpha: a });
}

// New zone G tracker (SCREEN coords): first half "EYES ■■ SAIL ■", chase "TAIL ■■■■■".
const isDead = (q) => {
  if (q === null || q === undefined) return true;
  if (typeof q !== 'object') return !q;
  return q.state === 'broken' || q.state === 'dead' || q.state === 'destroyed' || q.dead === true || (typeof q.hp === 'number' && q.hp <= 0 && q.state !== 'ok');
};
export function drawHybridTracker(ctx, world, t) {
  const b = world.boss;
  if (!b) return;
  const S = world.hudState && world.hudState.ev;
  const arr = (...c) => { for (const v of c) if (Array.isArray(v)) return v; for (const v of c) if (v && typeof v === 'object') return [v]; return []; };
  // b.mud is the boss's flying mud-clod list in zone G: the armour plates are b.mudPlates / b.armor
  const mud = arr(b.mudPlates, b.armor);
  const groups = (Number(b.half) === 2
    ? [['TAIL', arr(b.tail, b.tailSegs, b.segments), '#e0a030', '#fff0a0', 'gold']]
    : [['EYES', arr(b.eyes), '#ff3a30', '#ffd0c0', 'red'], ['SAIL', arr(b.sail, b.sails), '#e0a030', '#fff0a0', 'gold']])
    .concat(mud.length ? [['MUD', mud, '#9a6a3a', '#e0c090', 'sand']] : []);
  // long lists (16 mud plates) use compact 5px cells
  const cell = (list) => (list.length > 8 ? 6 : 9);
  const widths = groups.map(([lab, list]) => lab.length * 6 + 4 + list.length * cell(list));
  const total = widths.reduce((a2, b2) => a2 + b2, 0) + (groups.length - 1) * 8;
  const y = HUD_H + 12;
  let x = W - 8 - total;
  ctx.fillStyle = 'rgba(2,2,10,0.82)';
  ctx.fillRect(x - 4, y - 2, total + 8, 11);
  ctx.fillStyle = '#5a3a10';
  ctx.fillRect(x - 4, y + 9, total + 8, 1);
  const flash = S && S.gillFlash > 0 && (S.gillFlash >> 1) & 1;
  groups.forEach(([lab, list, col, hi, style], gi) => {
    drawText(ctx, lab, x, y, { style: flash ? 'white' : style, shadow: false });
    x += lab.length * 6 + 4;
    const step = cell(list);
    if (step < 9) {
      for (const q of list) {
        ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y + 1, 5, 6);
        if (isDead(q)) { ctx.fillStyle = '#3a2430'; ctx.fillRect(x + 1, y + 2, 3, 4); ctx.fillStyle = '#ff4050'; ctx.fillRect(x + 2, y + 3, 1, 2); }
        else {
          const k = q && typeof q === 'object' && q.max > 0 && typeof q.hp === 'number' ? clamp(q.hp / q.max, 0, 1) : 1;
          const h = Math.max(1, Math.round(4 * k));
          ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 2, 3, 4);
          ctx.fillStyle = col; ctx.fillRect(x + 1, y + 6 - h, 3, h);
          ctx.fillStyle = hi; ctx.fillRect(x + 1, y + 6 - h, 3, 1);
        }
        x += step;
      }
      x += 8;
      return;
    }
    for (const q of list) {
      ctx.fillStyle = '#6a5a70'; ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = '#120810'; ctx.fillRect(x + 1, y + 1, 5, 5);
      if (isDead(q)) {
        ctx.fillStyle = '#ff4050';
        for (let k = 0; k < 5; k++) { ctx.fillRect(x + 1 + k, y + 1 + k, 1, 1); ctx.fillRect(x + 5 - k, y + 1 + k, 1, 1); }
      } else {
        const k = q && typeof q === 'object' && q.max > 0 && typeof q.hp === 'number' ? clamp(q.hp / q.max, 0, 1) : 1;
        const h = Math.max(1, Math.round(5 * k));
        const lit = q && typeof q === 'object' && (q.lit || q.glow || q.state === 'lit' || q.state === 'up' || q.hittable);
        ctx.fillStyle = lit && (t >> 2) & 1 ? '#ffffff' : col; ctx.fillRect(x + 1, y + 6 - h, 5, h);
        ctx.fillStyle = hi; ctx.fillRect(x + 1, y + 6 - h, 5, 1);
        if (q && q.state === 'cracked') { ctx.fillStyle = '#120810'; ctx.fillRect(x + 3, y + 1, 1, 3); ctx.fillRect(x + 2, y + 3, 1, 2); ctx.fillRect(x + 4, y + 4, 1, 2); }
      }
      x += 9;
    }
    x += 8;
    void gi;
  });
}
