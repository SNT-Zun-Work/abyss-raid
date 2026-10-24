// Arcade HUD band (screen coords, black band of HUD_H px on top):
//   row 1: "1P" + score, ship stock, burst stock      | ZONE box |  "2P INSERT COIN(S)" (blinking)
//   row 2: weapon gauges                                |          |  HI score (+ MUTE)
//   row 2: LASER / W WAVE / HOMING / SHIELD gauges (icon box + name + segmented bar), bomb stock
// Boss vitality gauge sits just under the band inside the playfield, with a
// fill-up animation on reveal and a white damage "ghost" trail.
// Player fields are read defensively (names changed during development).
import { W, H, HUD_H } from '../config.js';
import { drawText, bigText } from './ui-font.js';
import { isTouchUI } from './ui-touch.js';
import * as scenesMod from './scenes.js'; // circular, runtime only (title zone select)
import { initEvents, updateEvents, drawGillTracker, drawGillHint, drawEyeTracker, drawPartTracker, drawHybridTracker } from './ui-events.js';
import { shipIcon, holeIcon, gaugeFill, weaponIcon } from './ui-art.js';

const num = (...vals) => {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
};
const pad8 = (n) => String(Math.max(0, Math.floor(n || 0))).padStart(8, '0').slice(-8);

// Returns {laser,wave,homing,shield} as {v,max} plus bombs.
export function weaponLevels(p) {
  const out = { laser: { v: 0, max: 5 }, wave: { v: 0, max: 5 }, homing: { v: 0, max: 5 }, shield: { v: 0, max: 12 }, bombs: 0 };
  if (!p) return out;
  const lv = p.lv || p.levels || p.weapons || {};
  out.laser = { v: num(p.laserLv, lv.laser, p.missileLv, p.redLv, p.shotLv) ?? 0, max: num(p.laserMax, p.LASER_MAX, p.missileMax) ?? 5 };
  out.wave = { v: num(p.waveLv, lv.wave, p.bombLv, p.greenLv) ?? 0, max: num(p.waveMax, p.WAVE_MAX) ?? (p.waveLv === undefined && p.bombLv !== undefined ? 3 : 5) };
  out.homing = { v: num(p.homingLv, lv.homing) ?? 0, max: num(p.homingMax, p.HOMING_MAX) ?? 5 };
  out.shield = { v: num(p.shieldHp, lv.shield, p.armHp, p.blueLv) ?? 0, max: num(p.shieldMax, p.armMax) ?? 12 };
  out.bombs = num(p.burstStock, p.bursts, p.bombStock, p.bhStock, p.blackHoles) ?? 0;
  return out;
}

const GAUGES = [
  ['laser', 'LASER', '#ff4a3a', '#ffb0a0'],
  ['wave', 'W WAVE', '#38d058', '#c8ffc0'],
  ['homing', 'HOMING', '#3a80ff', '#b8d4ff'],
  ['shield', 'SHIELD', '#38b8f8', '#c8f4ff'],
];
const SEGS = 10;
export const ZONE_LETTER = 'V';

export function init(world) {
  world.hudState = { gauge: 0, ghost: 1, ghostHold: 0, lastFrac: 1, gaugeOn: false, blink: 0, disp: {}, glow: {} };
  initEvents(world.hudState);
}

export function update(world) {
  const hs = world.hudState;
  if (!hs) return;
  if (world.score > world.hiScore) world.hiScore = world.score;
  updateEvents(world);
  // weapon gauges animate toward their target (segments light up one by one)
  const L = weaponLevels(world.player);
  for (const [k] of GAUGES) {
    const target = L[k].max > 0 ? Math.max(0, Math.min(1, L[k].v / L[k].max)) * SEGS : 0;
    const cur = hs.disp[k] ?? target;
    if (target > cur + 0.01) { hs.disp[k] = Math.min(target, cur + 0.25); hs.glow[k] = 30; }
    else hs.disp[k] = target < cur ? Math.max(target, cur - 0.5) : target;
    if (hs.glow[k] > 0) hs.glow[k]--;
  }
  const b = world.boss;
  const want = !!(b && b.active && !b.deathDone && (world.scene === 'boss' || world.scene === 'clear'));
  if (want && !hs.gaugeOn) { hs.gaugeOn = true; hs.gauge = 0; hs.ghost = 0; }
  if (!want) hs.gaugeOn = false;
  if (hs.gaugeOn) {
    const frac = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0;
    if (hs.gauge < 1) {
      hs.gauge = Math.min(1, hs.gauge + 1 / 70);
      hs.ghost = Math.min(frac, hs.gauge);
    } else {
      if (frac < hs.lastFrac - 1e-6) hs.ghostHold = 24;
      if (hs.ghostHold > 0) hs.ghostHold--;
      else hs.ghost = Math.max(frac, hs.ghost - 0.004);
      if (hs.ghost < frac) hs.ghost = frac;
    }
    hs.lastFrac = frac;
  }
  hs.blink++;
}

function drawGauge(ctx, x, y, key, name, col, hi, disp, glow, blink) {
  ctx.drawImage(weaponIcon(key), x, y);
  drawText(ctx, name, x + 15, y - 1, { style: 'white', shadow: false });
  const by = y + 7;
  for (let i = 0; i < SEGS; i++) {
    const sx = x + 15 + i * 3;
    const fill = Math.max(0, Math.min(1, disp - i));
    ctx.fillStyle = '#343a52';
    ctx.fillRect(sx, by, 2, 4);
    if (fill > 0) {
      const fresh = glow > 0 && i >= Math.floor(disp) - 1 && (blink >> 1) & 1;
      ctx.fillStyle = fresh ? '#ffffff' : col;
      ctx.fillRect(sx, by + Math.round((1 - fill) * 4), 2, Math.max(1, Math.round(fill * 4)));
      ctx.fillStyle = hi;
      if (fill >= 1) ctx.fillRect(sx, by, 2, 1);
    }
  }
}

export function draw(ctx, world) {
  const hs = world.hudState;
  if (!hs) return;
  const prevS = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, HUD_H);
  const title = world.scene === 'title';

  // row 1: score / stock / hi
  drawText(ctx, '1P', 4, 2, { style: 'cyan', shadow: false });
  drawText(ctx, pad8(world.score), 20, 2, { style: 'white', shadow: false });
  const p = world.player;
  if (!title && p) {
    const lives = Math.max(0, num(p.lives) ?? 0);
    const icon = shipIcon();
    if (lives <= 3) for (let i = 0; i < lives; i++) ctx.drawImage(icon, 72 + i * 11, 3);
    else { ctx.drawImage(icon, 72, 3); drawText(ctx, 'x' + Math.min(99, lives), 83, 2, { shadow: false }); }
  }
  // touch: the DOM FULL button covers the top-right corner -> HI moves to row 1 left of it, no 2P text
  const touchUI = isTouchUI();
  const hiX = touchUI ? W - 62 - 62 : W - 66, hiY = touchUI ? 2 : 14;
  drawText(ctx, 'HI', hiX, hiY, { style: 'red', shadow: false });
  drawText(ctx, pad8(world.hiScore), hiX + 14, hiY, { style: world.score >= world.hiScore && world.score > 0 ? 'gold' : 'grey', shadow: false });

  // row 2: weapon gauges
  if (!title) {
    const L = weaponLevels(p);
    GAUGES.forEach(([k, name, col, hi], i) => drawGauge(ctx, 3 + i * 60, 11, k, name, col, hi, hs.disp[k] ?? 0, hs.glow[k] || 0, hs.blink));
    const bombs = Math.max(0, Math.min(3, L.bombs));
    for (let i = 0; i < bombs; i++) ctx.drawImage(holeIcon(), 112 + i * 9, 2);
    if ((world.continues | 0) > 0) drawText(ctx, 'CONTINUE ' + Math.min(99, world.continues | 0), 146, 2, { style: 'dim', shadow: false });
  }

  // zone box
  const zw = touchUI ? 62 : 66, zh = 18, zx = touchUI ? 238 : Math.round((240 + (W - 110)) / 2 - zw / 2), zy = 3;
  ctx.fillStyle = '#9aa4bc';
  ctx.fillRect(zx, zy, zw, zh);
  ctx.fillStyle = '#04050a';
  ctx.fillRect(zx + 1, zy + 1, zw - 2, zh - 2);
  ctx.fillStyle = '#3a4258';
  ctx.fillRect(zx + 2, zy + zh - 2, zw - 4, 1);
  drawText(ctx, 'ZONE', zx + 8, zy + 6, { style: 'white', shadow: false });
  const zLetter = String((title && typeof scenesMod.selectedZone === 'function' ? scenesMod.selectedZone(world) : world.zone) || ZONE_LETTER);
  const zl = bigText(zLetter, { style: zLetter === 'G' ? 'lime' : 'gold', scale: 2, gap: 1 });
  ctx.drawImage(zl, zx + zw - 10 - (zl.width - 2 * zl.pad), zy + 2 - zl.pad);
  ctx.fillStyle = '#ff4a5a';
  ctx.fillRect(zx + 3, zy + 3, 2, zh - 6);

  // 2P insert coin (blinking) + mute indicator
  if (!touchUI && (hs.blink % 64) < 44) drawText(ctx, '2P  INSERT COIN(S)', W - 4, 2, { style: 'cyan', align: 'right', shadow: false });
  if (world.muted) drawText(ctx, 'MUTE', touchUI ? W - 64 : W - 72, 14, { style: 'dim', align: 'right', shadow: false });

  // boss vitality gauge (just under the band, inside the playfield)
  if (hs.gaugeOn && world.boss) {
    const b = world.boss;
    const frac = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0;
    const y0 = HUD_H + 3, x0 = 34, bw = W - x0 - 6, bh = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, HUD_H, W, 10);
    drawText(ctx, 'BOSS', 5, HUD_H + 1, { style: (hs.blink >> 3) & 1 && frac < 0.3 ? 'gold' : 'red' });
    ctx.fillStyle = '#ff8cc0';
    ctx.fillRect(x0 - 2, y0 - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#100410';
    ctx.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
    const shown = Math.min(frac, hs.gauge);
    const gw = Math.round(bw * shown), ghw = Math.round(bw * Math.min(hs.ghost, 1));
    if (ghw > gw) { ctx.fillStyle = '#fff6f0'; ctx.fillRect(x0 + gw, y0, ghw - gw, bh); }
    if (gw > 0) ctx.drawImage(gaugeFill(bw, bh), 0, 0, gw, bh, x0, y0, gw, bh);
    if (hs.gauge < 1) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 + Math.round(bw * hs.gauge) - 2, y0 - 1, 2, bh + 2); }
    for (const t of [0.65, 0.3]) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 + Math.round(bw * t), y0 - 2, 1, 1); }
    if (hs.gauge >= 1 && world.boss.half !== undefined) drawHybridTracker(ctx, world, hs.blink);
    else if (hs.gauge >= 1 && (Array.isArray(world.boss.sails) || Array.isArray(world.boss.fins))) drawPartTracker(ctx, world, hs.blink);
    else if (hs.gauge >= 1 && Array.isArray(world.boss.gills) && world.boss.gills.length) drawGillTracker(ctx, world, hs.blink);
    else if (hs.gauge >= 1 && Array.isArray(world.boss.eyes) && world.boss.eyes.length) drawEyeTracker(ctx, world, hs.blink);
    if (hs.gauge >= 1) drawGillHint(ctx, world);
  }
  ctx.imageSmoothingEnabled = prevS;
}
