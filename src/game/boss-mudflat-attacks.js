import { W, H } from '../config.js';
import { clamp } from '../core/util.js';
import * as bullets from './bullets.js';
import * as player from './player.js';
import { sfx, fxCall, hurtPlayer, aimAt } from './boss-util.js';
import { DIFFICULTY, SURFACE_Y, STAND_Y, PRONE_Y, STAND_A, HOME_X, toWorld } from './boss-mudflat.js';
import { splash } from './boss-mudskipper.js';

export const REX_POOLS = {
  stand: ['stompWalk', 'mawFan', 'eyeVolley'],
  prone: ['crawl', 'mortar', 'eyeBeam'],
};
export const REX_STRONG = new Set(['slam', 'flop', 'eyeBeam']);
const D = (b) => DIFFICULTY[b.phase];
const hint = (b, atk, cause, text, rects = []) => {
  b.safeHint = { cause, atk: atk.id, text, rects: rects.map((q) => {
    const x = Math.max(0, q.x), y = Math.max(0, q.y), w = Math.min(W, q.x + q.w) - x, h = Math.min(H, q.y + q.h) - y;
    return w > 2 && h > 2 ? { x, y, w, h } : null;
  }).filter(Boolean) };
};
const tgt = (world) => { const p = world.player; return p && p.alive ? { x: p.x, y: p.y } : { x: 60, y: 100 }; };
const mouth = (b) => toWorld(b, -82, 12);
const eyes = (b) => [toWorld(b, -55, -44), toWorld(b, -31, -48)];
function lob(world, b, atk, x0, y0, tx, ty, T, cause) {
  const g = D(b).grav;
  b.mud.push({ x: x0, y: y0, vx: (tx - x0) / T, vy: (ty - y0 - 0.5 * g * T * T) / T, g, r: 4, cause, atk: atk.id, tx, ty, mark: 1 });
}

export const REX_ATTACKS = {
  // STAND: stomp-walk toward a spot right of the player; every stomp splashes a shockwave pair
  stompWalk(world, b, atk) {
    const d = D(b), STEP = 34;
    if (atk.t === 0) {
      atk.tx = clamp(tgt(world).x + 170, 170, HOME_X + 10);
      hint(b, atk, 'mfStomp', 'Each stomp sends waves along the water line: stay above it', [{ x: 0, y: 0, w: W, h: SURFACE_Y - 30 }]);
    }
    const k = Math.floor(atk.t / STEP), u = (atk.t % STEP) / STEP;
    if (k >= d.stompN) { b.step = 0; return atk.t >= d.stompN * STEP + 16; }
    b.step = k * Math.PI + u * Math.PI;
    const dir = Math.sign(atk.tx - b.x) || 0;
    b.x += dir * 0.6;
    b.y = STAND_Y - Math.sin(u * Math.PI) * 6;
    b.aT = STAND_A + Math.sin(u * Math.PI) * 0.05;
    if (atk.t % STEP === STEP - 1) {
      const fx0 = toWorld(b, -30, 44).x;
      splash(b, fx0, 26, world, 3.6);
      fxCall('addShake', world, 3); sfx('explodeS');
      b.shocks.push({ x: fx0 - 16, vx: -2.2 * d.spd, atk: atk.id, t: 0 }, { x: fx0 + 16, vx: 2.2 * d.spd, atk: atk.id, t: 0 });
      if (b.phase >= 2) { const m = mouth(b), p = tgt(world); lob(world, b, atk, m.x, m.y - 10, p.x, p.y, 60, 'mfMortar'); }
    }
    return false;
  },
  // STAND: the maw glows, then aimed fans of red orbs
  mawFan(world, b, atk) {
    const d = D(b), T0 = 30, iv = 16, end = T0 + d.mawVol * iv;
    b.jawT = atk.t < end + 6 ? 1 : 0;
    if (atk.t === 0) hint(b, atk, 'mfMaw', d.mawVol + ' fans from the maw: slip into a gap after each fan');
    if (atk.t >= T0 && atk.t < end && (atk.t - T0) % iv === 0) {
      const m = mouth(b), a0 = aimAt(world, m.x, m.y), n = d.mawN, v = (atk.t - T0) / iv;
      for (let k = 0; k < n; k++) bullets.fire(world, { x: m.x, y: m.y, ang: a0 + (k - (n - 1) / 2) * 0.27 + (v % 2 ? 0.135 : 0), spd: 1.8 * d.spd, type: 'orb', r: 4, color: 'red', cause: 'mfMaw', atk: atk.id });
      sfx('missile');
    }
    return atk.t >= end + 24;
  },
  // STAND: turret eyes flash cyan, then aimed bursts
  eyeVolley(world, b, atk) {
    const d = D(b), T0 = 28, iv = 14, end = T0 + d.eyeBursts * iv;
    atk.eyeTell = atk.t < T0 ? ((atk.t >> 2) & 1) * 0.8 : 0;
    if (atk.t === 0) hint(b, atk, 'mfEye', 'Eyes flash cyan, then fire aimed bursts: sidestep each burst');
    if (atk.t >= T0 && atk.t < end && (atk.t - T0) % iv === 0) {
      for (const e of eyes(b)) { const a0 = aimAt(world, e.x, e.y); for (let k = -1; k <= 1; k++) bullets.fire(world, { x: e.x, y: e.y, ang: a0 + k * 0.12, spd: 2.1 * d.spd, type: 'orb', color: 'red', cause: 'mfEye', atk: atk.id }); }
    }
    return atk.t >= end + 20;
  },
  // PRONE: wriggles along the bottom across the screen; sails fire spine fans upward
  crawl(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) {
      atk.tx = b.x > 220 ? 130 : HOME_X;
      atk.fans = 0;
      hint(b, atk, 'mfCrawl', 'It sweeps the low lane: get above it; its sails fire spines upward - stay between the fans');
    }
    const dir = Math.sign(atk.tx - b.x);
    b.f = dir < 0 ? 1 : -1;
    b.x += dir * d.crawlSpd;
    b.wrig += 0.22; b.aT = Math.sin(b.t * 0.22) * 0.07;
    b.y = PRONE_Y + Math.sin(b.t * 0.22) * 2;
    if (b.t % 8 === 0) splash(b, b.x + world.fxRng.range(-100, 100), 4, world, 2.2);
    // sail tips glow 12 f before each fan
    const iv = 34, k = atk.t - 20;
    atk.sailTell = k >= 0 && atk.fans < d.sailFanVol && iv - (k % iv) <= 12 ? 1 : 0;
    if (k >= 0 && k % iv === iv - 1 && atk.fans < d.sailFanVol) {
      atk.fans++;
      b.sails.forEach((s, i) => {
        if (s.state === 'broken') return;
        const top = toWorld(b, [-2, 26, 50][i], [-70, -78, -62][i]);
        const n = d.sailFanN;
        for (let q = 0; q < n; q++) {
          const a = -Math.PI / 2 + (q - (n - 1) / 2) * 0.32 + (atk.fans % 2 ? 0.16 : 0);
          bullets.fire(world, { x: top.x, y: top.y, ang: a, spd: 1.7 * d.spd, type: 'needle', color: 'orange', cause: 'mfSail', atk: atk.id });
        }
      });
      sfx('missile');
    }
    return Math.abs(atk.tx - b.x) < 3 && atk.t > 60;
  },
  // PRONE: mortars from its back arcing onto the ship (cyan landing marks)
  mortar(world, b, atk) {
    const d = D(b);
    if (atk.t === 0) hint(b, atk, 'mfMortar', 'Mortars arc up and fall on the cyan marks: step aside');
    b.wrig += 0.08;
    for (const v of [16, 48]) {
      if (atk.t !== v) continue;
      const src = toWorld(b, 10, -30), p = tgt(world);
      for (let k = 0; k < d.mortarN; k++) lob(world, b, atk, src.x, Math.min(src.y, SURFACE_Y - 6), clamp(p.x + (k - (d.mortarN - 1) / 2) * 26, 8, W - 8), p.y, 62 + k * 6, 'mfMortar');
      sfx('missile');
    }
    return atk.t >= 90;
  },
  // PRONE: eye beams — aim lines track, lock (stop blinking), then fire upward-ish
  eyeBeam(world, b, atk) {
    const d = D(b), TELL = d.beamTell, ON = d.beamTime;
    atk.eyeTell = atk.t < TELL ? 0.6 : 0;
    const es = eyes(b);
    if (atk.t < TELL - 18) atk.aims = es.map((e) => aimAt(world, e.x, e.y));
    const state = atk.t < TELL - 18 ? 'aim' : atk.t < TELL ? 'lock' : atk.t < TELL + ON ? 'fire' : null;
    b.beams.length = 0;
    if (state) es.forEach((e, i) => b.beams.push({ x: e.x, y: e.y, a: atk.aims[i], w: 8, state, atk: atk.id }));
    if (atk.t === 0) { hint(b, atk, 'mfBeam', 'Leave the cyan aim lines when they stop blinking'); sfx('laserCharge'); }
    if (atk.t === TELL) { sfx('laserFire'); fxCall('addShake', world, 3); }
    return atk.t >= TELL + ON + 12;
  },
  // stance change STAND → PRONE: rears up, then crashes onto the striped bottom band
  slam(world, b, atk) {
    const TELL = 48;
    if (atk.t === 0) { atk.x0 = b.x; sfx('bossRoar'); }
    const l = b.x - 130 * b.f - 20, r = b.x + 150;
    b.slamBand = { x0: Math.min(l, r - 0), x1: Math.max(l, r), y0: SURFACE_Y - 34, k: Math.min(1, atk.t / TELL) };
    hint(b, atk, 'mfSlam', 'It crashes onto the striped band: get above it', [{ x: 0, y: 0, w: W, h: SURFACE_Y - 44 }]);
    if (atk.t < TELL) { b.aT = STAND_A + 0.26 * (atk.t / TELL); b.y += (STAND_Y - 8 - b.y) * 0.1; b.jawT = 1; return false; }
    if (atk.t < TELL + 14) { const u = (atk.t - TELL) / 14; b.y = STAND_Y - 8 + (PRONE_Y - STAND_Y + 8) * u * u; b.aT = (STAND_A + 0.26) * (1 - u); b.stance = 'prone'; return false; }
    if (atk.t === TELL + 14) {
      splash(b, b.x - 40, 90, world, 5.5); splash(b, b.x + 60, 50, world, 4);
      fxCall('addShake', world, 7); sfx('explodeL'); world.hitstop = Math.max(world.hitstop, 4);
      const d = D(b);
      b.shocks.push({ x: b.x - 150, vx: -2.6 * d.spd, atk: atk.id, t: 0 }, { x: b.x + 150, vx: 2.6 * d.spd, atk: atk.id, t: 0 });
      b.stance = 'prone'; b.stanceN = 0; b.slamBand = null; b.jawT = 0;
    }
    return atk.t >= TELL + 34;
  },
  // stance change PRONE → STAND: sails glow, it rears up throwing mud
  rise(world, b, atk) {
    if (atk.t === 0) { hint(b, atk, 'mfMortar', 'It rears up and throws mud: watch the cyan marks'); }
    if (atk.t < 26) { atk.sailTell = (atk.t >> 2) & 1; b.aT = Math.sin(b.t * 0.6) * 0.05; return false; }
    const u = Math.min(1, (atk.t - 26) / 30);
    b.y = PRONE_Y + (STAND_Y - PRONE_Y) * (1 - (1 - u) ** 2); b.aT = STAND_A * u; b.stance = 'stand';
    if (atk.t === 30) {
      splash(b, b.x, 70, world, 5); fxCall('addShake', world, 4); sfx('bossRoar');
      const p = tgt(world);
      for (let k = 0; k < 4; k++) lob(world, b, atk, b.x - 40 + k * 30, SURFACE_Y - 6, clamp(p.x + (k - 1.5) * 34, 8, W - 8), p.y, 58 + k * 5, 'mfMortar');
    }
    if (u >= 1) { b.stanceN = 0; return true; }
    return false;
  },
  // FINAL FORM spectacle: leaps over the middle, BELLY FLOPS, two surge walls roll outward
  flop(world, b, atk) {
    const d = D(b), TELL = d.flopTell || 110;
    if (atk.t === 0) { atk.x0 = b.x; atk.y0 = b.y; atk.ix = 220; sfx('bossRoar'); fxCall('screenRumble', world, 60, 2); }
    if (atk.t < TELL) {
      const u = atk.t / TELL;
      b.x = atk.x0 + (atk.ix - atk.x0) * u; b.y = atk.y0 + (40 - atk.y0) * Math.sin(u * Math.PI * 0.5);
      b.aT = -0.2; b.stance = 'stand';
      b.flopShadow = { x: atk.ix, w: 300, k: u };
      hint(b, atk, 'mfFlop', 'Its shadow marks the impact: get clear of it - then ride a tunnel in the surge', [{ x: 0, y: 0, w: atk.ix - 160, h: SURFACE_Y - 20 }, { x: atk.ix + 170, y: 0, w: W, h: SURFACE_Y - 20 }]);
      return false;
    }
    if (atk.t < TELL + 16) { const u = (atk.t - TELL) / 16; b.y = 40 + (PRONE_Y - 40) * u * u; b.aT = 0; return false; }
    if (atk.t === TELL + 16) {
      b.stance = 'prone'; b.stanceN = 0; b.flopShadow = null; b.flopFired = true;
      splash(b, atk.ix, 140, world, 6); fxCall('addShake', world, 9); sfx('explodeL'); world.flash = Math.max(world.flash, 0.4); world.hitstop = Math.max(world.hitstop, 6);
      const p = tgt(world);
      const pick = () => { let g = clamp(p.y + world.rng.range(-50, 50), 36, H - 30); if (Math.abs(g - p.y) < 28) g = clamp(g + (g < H / 2 ? 46 : -46), 36, H - 30); return g; };
      const gl = pick(), gr = clamp(gl + world.rng.sign() * world.rng.range(40, 70), 36, H - 30);
      b.surges.push({ x: atk.ix - 150, dir: -1, spd: d.surgeSpd || 2.6, g0: gl - (d.surgeGap || 44) / 2, g1: gl + (d.surgeGap || 44) / 2, state: 'run', atk: atk.id, born: atk.t });
      b.surges.push({ x: atk.ix + 170, dir: 1, spd: d.surgeSpd || 2.6, g0: gr - (d.surgeGap || 44) / 2, g1: gr + (d.surgeGap || 44) / 2, state: 'run', atk: atk.id, born: atk.t });
    }
    if (b.surges.length) {
      const rs = b.surges.map((s) => ({ x: s.dir < 0 ? 0 : s.x, y: s.g0 + 3, w: s.dir < 0 ? s.x : W - s.x, h: s.g1 - s.g0 - 6 }));
      hint(b, atk, 'mfSurge', 'Be inside the striped tunnel when the surge passes', rs);
    }
    return atk.t > TELL + 20 && !b.surges.length;
  },
};

// ---- beams + surges ---------------------------------------------------------------
export function updateRexHazards(world, b) {
  const hb = player.playerHitbox(world);
  b.lasers.length = 0;
  for (const L of b.beams) {
    b.lasers.push({ x: L.x, y: L.y, a: L.a, w: L.w, state: L.state, atk: L.atk });
    if (L.state !== 'fire' || !hb || b.beamCd > 0) continue;
    const dx = Math.cos(L.a), dy = Math.sin(L.a), rx = hb.x - L.x, ry = hb.y - L.y;
    if (rx * dx + ry * dy > 0 && Math.abs(rx * dy - ry * dx) < L.w / 2 + hb.r) { b.beamCd = 24; hurtPlayer(world, { kind: 'laser', cause: 'mfBeam', atk: L.atk, x: L.x, y: L.y }); }
  }
  if (b.beamCd > 0) b.beamCd--;
  for (let i = b.surges.length - 1; i >= 0; i--) {
    const s = b.surges[i];
    s.x += s.dir * s.spd;
    const x0 = s.dir < 0 ? s.x : s.x - 50, x1 = x0 + 50;
    if (hb && hb.x > x0 && hb.x < x1 && (hb.y < s.g0 + 2 || hb.y > s.g1 - 2) && !(b.surgeCd > 0)) { b.surgeCd = 20; hurtPlayer(world, { kind: 'laser', cause: 'mfSurge', atk: s.atk, x: s.x, y: hb.y }); }
    if (s.x < -70 || s.x > W + 70) b.surges.splice(i, 1);
  }
  if (b.surgeCd > 0) b.surgeCd--;
  for (let i = b.shocks.length - 1; i >= 0; i--) {
    const q = b.shocks[i];
    q.t++; q.x += q.vx;
    if (hb && Math.abs(hb.x - q.x) < 8 + hb.r && hb.y > SURFACE_Y - 24 && hb.y < SURFACE_Y + 6) hurtPlayer(world, { kind: 'bullet', cause: 'mfStomp', atk: q.atk, x: q.x, y: SURFACE_Y - 4 });
    if (q.x < -20 || q.x > W + 20) b.shocks.splice(i, 1);
  }
  if (!b.atk || b.atk.name !== 'stompWalk') b.step = 0;
}

function hatch(ctx, x0, y0, w, h, t, color, alpha) {
  if (w <= 0 || h <= 0) return;
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.fillRect(Math.round(x0), Math.round(y0), Math.round(w), 1);
  ctx.fillRect(Math.round(x0), Math.round(y0 + h - 1), Math.round(w), 1);
  const off = (t >> 1) % 14;
  for (let x = x0 - h + off; x < x0 + w; x += 14) for (let k = 0; k < h; k += 2) {
    const px = Math.round(x + k * 0.5 + h * 0.5);
    if (px >= x0 && px < x0 + w) ctx.fillRect(px, Math.round(y0 + k), 3, 1);
  }
  ctx.globalAlpha = 1;
}

export function drawRexHazards(ctx, world, b, S, layer) {
  if (layer === 'under') {
    if (b.slamBand) { const s = b.slamBand; hatch(ctx, Math.max(0, s.x0), s.y0, Math.min(W, s.x1) - Math.max(0, s.x0), H - s.y0, b.t, '#c8faff', 0.25 + 0.25 * s.k); }
    if (b.flopShadow) {
      const s = b.flopShadow, w = s.w * (0.4 + 0.6 * s.k);
      ctx.globalAlpha = 0.35 + 0.4 * s.k;
      ctx.drawImage(S.shadow, Math.round(s.x - w / 2), SURFACE_Y - 8, Math.round(w), 16);
      ctx.globalAlpha = 1;
      hatch(ctx, s.x - 160, SURFACE_Y - 60, 330, H - SURFACE_Y + 60, b.t, '#c8faff', 0.2 + 0.25 * s.k);
    }
    for (const L of b.beams) {
      if (L.state === 'fire') continue;
      if (L.state === 'aim' && (b.t >> 2) & 1) continue;
      ctx.save(); ctx.translate(Math.round(L.x), Math.round(L.y)); ctx.rotate(L.a);
      ctx.fillStyle = L.state === 'lock' ? '#e8ffff' : '#9ef6ff';
      for (let k = 6; k < 460; k += 6) ctx.fillRect(k, -1, 3, L.state === 'lock' ? 2 : 1);
      ctx.restore();
    }
    // sail tips glow before spine fans / rising
    if (b.atk && b.atk.sailTell) {
      ctx.globalCompositeOperation = 'lighter';
      b.sails.forEach((s, i) => { if (s.state === 'broken') return; const p = toWorld(b, [-2, 26, 50][i], [-70, -78, -62][i]); ctx.drawImage(S.tellGlow, Math.round(p.x) - 8, Math.round(p.y) - 8); });
      ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  for (const L of b.beams) {
    if (L.state !== 'fire') continue;
    ctx.save(); ctx.translate(Math.round(L.x), Math.round(L.y)); ctx.rotate(L.a);
    ctx.fillStyle = '#ff3a40'; ctx.fillRect(0, -4, 460, 8);
    ctx.fillStyle = '#ffb0a0'; ctx.fillRect(0, -2, 460, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, -1, 460, 2);
    ctx.restore();
  }
  for (const s of b.surges) {
    const x = Math.round(s.dir < 0 ? s.x : s.x - 50), g0 = Math.round(s.g0), g1 = Math.round(s.g1);
    hatch(ctx, s.dir < 0 ? 0 : x + 50, g0, s.dir < 0 ? x : W - x - 50, g1 - g0, b.t, '#c8faff', 0.3);
    const band = (y0, y1) => {
      const cols = ['#0e2c46', '#16405e', '#205a7c', '#2c7298', '#4a98bc'];
      for (let i = 0; i < 5; i++) { ctx.fillStyle = cols[s.dir < 0 ? 4 - i : i]; ctx.fillRect(x + i * 10, y0, 10, y1 - y0); }
      ctx.fillStyle = '#e8fbff';
      for (let y = y0 + ((b.t * 3) % 9); y < y1; y += 9) ctx.fillRect(x + (s.dir < 0 ? 2 : 44) + ((y * 7) % 5), y, 2, 4);
    };
    band(0, g0); band(g1, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, g0 - 3, 54, 3); ctx.fillRect(x - 2, g1, 54, 3);
  }
}
