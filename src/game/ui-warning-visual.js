import { W, H } from '../config.js';
import { clamp, easeOutCubic } from '../core/util.js';
import { drawText, drawBig } from './ui-font.js';
import { drawKeyArt } from './ui-presentation-visual.js';

// Presentation frames only: no RNG and no writes to the world.
export function drawWarningVisual(c, world, Z, length) {
  // G and M share the amber tidelands look; V is the red/cyan abyss.
  const t = world.sceneT, g = Z.letter === 'G' || Z.letter === 'M';
  const accent = g ? '#ffc16d' : '#76e9f2';
  const alarm = g ? '255,108,24' : '255,36,65';
  c.save(); c.globalAlpha = clamp((length - t) / 22, 0, 1);
  c.fillStyle = '#030912'; c.fillRect(0, 0, W, H);
  const pulse = (1 + Math.cos(t * Math.PI / 42)) / 2;
  c.fillStyle = `rgba(${alarm},${0.06 + pulse * 0.12})`; c.fillRect(0, 0, W, H);
  for (const [y, dir] of [[8, 1], [198, -1]]) {
    c.fillStyle = `rgba(${alarm},0.28)`; c.fillRect(0, y, W, 12);
    c.fillStyle = accent; c.fillRect(0, y, W, 1);
    c.save(); c.beginPath(); c.rect(0, y + 2, W, 9); c.clip();
    const offset = ((t * dir * 0.65) % 168 + 168) % 168;
    for (let x = -168 + offset; x < W; x += 168)
      drawText(c, 'CAUTION / HOSTILE SIGNAL /', x, y + 3, { style: g ? 'gold' : 'red', shadow: false });
    c.restore();
  }
  if (t >= 14) {
    const impact = 1 - clamp((t - 14) / 12, 0, 1);
    const glitch = (t % 83 < 3 || impact > 0) ? 2 : 0;
    drawBig(c, 'WARNING', W / 2 - glitch, 31, { style: 'cyan', scale: 4, gap: 5, alpha: 0.5 });
    drawBig(c, 'WARNING', W / 2 + glitch, 32, { style: g ? 'gold' : 'red', scale: 4, gap: 5, sy: 1 + impact * 0.5 });
    c.fillStyle = `rgba(255,240,215,${impact * 0.22})`; c.fillRect(0, 26, W, 36);
  }
  const x = 27, y = 72, w = 218, h = 98;
  c.fillStyle = '#04131e'; c.fillRect(x, y, w, h);
  c.strokeStyle = accent; c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  const reveal = easeOutCubic(clamp((t - 38) / 112, 0, 1));
  c.save(); c.beginPath(); c.rect(x, y, w * reveal, h); c.clip();
  drawKeyArt(c, Z.letter, x, y, w, h);
  c.fillStyle = g ? 'rgba(52,14,0,.24)' : 'rgba(0,25,40,.24)'; c.fillRect(x, y, w, h);
  c.restore();
  c.fillStyle = g ? 'rgba(255,194,109,.13)' : 'rgba(118,233,242,.13)';
  for (let xx = x + 10; xx < x + w; xx += 20) c.fillRect(xx, y, 1, h);
  for (let yy = y + 10; yy < y + h; yy += 20) c.fillRect(x, yy, w, 1);
  const scan = x + Math.floor((t * 1.8) % w);
  c.fillStyle = accent; c.fillRect(scan, y, 1, h);
  c.fillStyle = 'rgba(255,255,255,.13)'; c.fillRect(Math.max(x, scan - 7), y, Math.min(7, scan - x), h);
  drawText(c, t < 150 ? 'ACQUIRING TARGET' : 'TARGET LOCKED', x + 5, y + 5, { style: g ? 'gold' : 'cyan' });
  drawText(c, 'ZONE ' + Z.letter + ' / LIVE SCAN', x + 5, y + h - 12, { style: 'white' });
  const dx = 258;
  // (the small HUD font has no '.', so no "EST." — it rendered as "EST?")
  const ROWS = {
    V: ['ABYSS BATTLESHIP', 'APPROX 412M', 'EXTREME / ARMORED'],
    G: ['TIDAL FLAT DESTROYER', 'APPROX 400M', 'EXTREME / EVASIVE'],
    M: ['SIEGE BEHEMOTH', 'APPROX 530M', 'EXTREME / BRUTE'],
  };
  const rows = ROWS[Z.letter] || ROWS.V;
  [['CLASS', rows[0]], ['NAME', Z.name], ['SIZE', rows[1]], ['THREAT', rows[2]]].forEach(([label, value], i) => {
    const yy = 74 + i * 24;
    drawText(c, label, dx, yy, { style: g ? 'gold' : 'cyan', alpha: 0.7 });
    const n = Math.max(0, Math.floor((t - 48 - i * 16) / 2));
    drawText(c, value.slice(0, n), dx, yy + 10, { style: 'white' });
  });
  if (t >= 208 || length < 200) {
    const slamT = length < 200 ? 40 : 208;
    const k = clamp((t - slamT) / 10, 0, 1);
    drawBig(c, Z.name, W / 2, 179, { style: g ? 'gold' : 'pink', scale: 2, gap: 2, sx: 1 + (1 - k) * 0.35, alpha: k });
  } else drawText(c, 'IDENTIFICATION IN PROGRESS', W / 2, 181, { style: 'grey', align: 'center' });
  c.restore();
}
