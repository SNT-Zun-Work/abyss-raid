// Procedural pixel-art painting for the sunken-city cavern zone (bg/fx agent).
// Everything here runs ONCE at boot (cached at module level) and produces
// offscreen canvases that background.js composes each frame.
//
// Technique: shapes are drawn as flat "material masks" with the canvas path
// API (R = material id * 14, G = shade modifier, 128 = neutral), then a shader
// pass turns each solid pixel into a palette colour with rim-light, shadowed
// right/under sides, texture noise and 4x4 ordered dithering — a 90s painted
// look rather than smooth vector gradients. Emissive materials (windows, red
// lights) keep a flat colour. Blinking lights are recorded per layer and
// drawn live by background.js.

import { W, H } from '../config.js';
import { makeSprite } from '../core/util.js';
import { makeRng } from '../core/rng.js';
import { fbm1, fbm2, ramp, rampPick, rampBand, pixelSprite } from './bg-noise.js';

export const M = 12;            // margin around the playfield (covers shake + raster wobble)
export const BW = W + M * 2;
export const BH = H + M * 2;
export const TW = 800;          // layer tile width (seamless wrap)

// Depth layering: far = hazy, light, low contrast; mid = medium-dark, flat
// metal planes; near = darkest with strong lit rims (most contrast).
// `band` = dither band width (localised dithering only at tone boundaries).
const MATS = {
  // far city haze (narrow, light ramp → reads as distance)
  1: { rp: ramp('#143a52', '#173f58', '#1a455e', '#1e4c66', '#23546e', '#2a5e78'), base: 0.35, rim: 0.3, dl: 60, dd: 0.1, tex: 0.04, vl: 0.06, band: 0.2 },
  // far ceiling rock
  2: { rp: ramp('#0b2234', '#0d283c', '#102e44', '#13354c', '#173c54'), base: 0.35, rim: 0.1, rimBot: 0.35, dl: 30, dd: 0.1, tex: 0.2, vl: 0, band: 0.2 },
  // mid city metal (flat planes, panel seams carry the detail)
  3: { rp: ramp('#08141d', '#0b1a25', '#0f212e', '#132938', '#193244', '#213e52', '#2c4e62', '#3d6476'), base: 0.27, rim: 0.48, dl: 70, dd: 0.18, tex: 0.04, vl: 0.06, band: 0.2 },
  // mid rock cliffs / crumbling masonry
  4: { rp: ramp('#06101a', '#081520', '#0b1a27', '#0e202f', '#132838', '#1a3242', '#243f4f'), base: 0.28, rim: 0.48, dl: 40, dd: 0.3, tex: 0.25, vl: 0.04, band: 0.2 },
  // near city metal (dark, high-contrast rims)
  5: { rp: ramp('#03080d', '#050c12', '#081119', '#0b1721', '#101f2b', '#1a2f3d', '#2b4757', '#4b6e7e'), base: 0.2, rim: 0.7, dl: 26, dd: 0.18, tex: 0.04, vl: 0.03, band: 0.2 },
  // near rock
  6: { rp: ramp('#02060a', '#040a0f', '#060e15', '#09141b', '#0d1b23', '#14262e', '#20383e', '#33524e'), base: 0.2, rim: 0.62, dl: 22, dd: 0.22, tex: 0.3, vl: 0, band: 0.2 },
  // cavern ceiling rock (lit faintly from below at the tips, mossy teal)
  7: { rp: ramp('#010407', '#03080c', '#050d12', '#081319', '#0c1a20', '#112428', '#183130', '#22403a'), base: 0.2, rim: 0.05, rimBot: 0.45, dl: 20, dd: 0.05, tex: 0.35, vl: 0, band: 0.2 },
  // emissive: windows (pale teal), far windows, static red light, dim red light, pale blue windows
  8: { emit: [96, 186, 196] },
  9: { emit: [255, 62, 48] },
  10: { emit: [58, 118, 136] },
  11: { emit: [150, 30, 30] },
  12: { emit: [150, 210, 235] },
  // foreground rock + weeds
  13: { rp: ramp('#010304', '#030709', '#060c0e', '#0a1314', '#0f1b1b', '#162522', '#1f312b', '#2b4136'), base: 0.24, rim: 0.65, dl: 14, dd: 0.18, tex: 0.4, vl: 0, band: 0.2 },
  14: { rp: ramp('#010407', '#02080c', '#030d11', '#051416', '#081d1d', '#0d2a27', '#143a32'), base: 0.1, rim: 0.4, dl: 6, dd: 0.1, tex: 0.25, vl: 0, band: 0.2 },
  // massive near rock formation: faceted (G channel = facet light), mossy lit crests
  15: { rp: ramp('#03070b', '#060c11', '#0a1218', '#0f1a20', '#152429', '#1c2f33', '#253c3d', '#314c47', '#426052', '#5a7a62'), base: 0.36, rim: 0.75, rimLeft: 0.22, dl: 46, dd: 0.18, tex: 0.22, vl: 0.1, band: 0.2 },
  // distant skyline haze (very low contrast, nearly flat)
  16: { rp: ramp('#18435c', '#1b4961', '#1f5068', '#24586f'), base: 0.3, rim: 0.5, dl: 80, dd: 0.05, tex: 0, vl: 0.1, band: 0.2 },
  17: { emit: [70, 140, 160] },
  // mid-distance rock wall (lighter + hazier than the near rock)
  18: { rp: ramp('#07131d', '#0a1924', '#0e202c', '#132835', '#19323f', '#213d4a', '#2c4b57', '#3b5d66'), base: 0.34, rim: 0.6, rimLeft: 0.15, dl: 50, dd: 0.16, tex: 0.2, vl: 0.06, band: 0.2 },
};

const matStyle = (id, mod = 128) => `rgb(${id * 14},${mod},0)`;

// Draw a mask (w x h) in playfield coordinates (translated by M vertically).
// draw(ctx, wrap, light): wrap(fn) repeats fn at x-offsets 0,-w,+w (seamless
// tile); light(x,y,opts) records a blinking light once (offset 0 only).
function mask(w, h, draw, lights) {
  return makeSprite(w, h, (ctx) => {
    ctx.translate(0, M);
    let cur = 0;
    const wrap = (fn) => {
      for (const ox of [0, -w, w]) { cur = ox; ctx.save(); ctx.translate(ox, 0); fn(); ctx.restore(); }
      cur = 0;
    };
    const light = (x, y, o = {}) => {
      ctx.fillStyle = matStyle(11);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (cur === 0 && lights) lights.push({ x: ((Math.round(x) % w) + w) % w, y: Math.round(y) + M, per: o.per || 90, ph: o.ph || 0, duty: o.duty || 0.5, big: !!o.big });
    };
    draw(ctx, wrap, light);
  });
}

// Shade a material mask into a palette-dithered sprite.
function shade(maskCv, w, h, seed, opt = {}) {
  const src = maskCv.getContext('2d').getImageData(0, 0, w, h).data;
  const N = w * h;
  const id = new Uint8Array(N), md = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (src[i * 4 + 3] >= 110) { id[i] = Math.round(src[i * 4] / 14); md[i] = (src[i * 4 + 1] - 128) / 128; }
  }
  const top = new Uint8Array(N), bot = new Uint8Array(N), left = new Uint8Array(N), right = new Uint8Array(N);
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) { const i = y * w + x; if (id[i]) { top[i] = run < 255 ? run : 255; run++; } else run = 0; }
    run = 0;
    for (let y = h - 1; y >= 0; y--) { const i = y * w + x; if (id[i]) { bot[i] = run < 255 ? run : 255; run++; } else run = 0; }
  }
  const wrapX = opt.wrap !== false;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let xx = wrapX ? -w : 0; xx < w; xx++) {
      const x = xx < 0 ? xx + w : xx, i = y * w + x;
      if (id[i]) { if (xx >= 0) left[i] = run < 255 ? run : 255; run++; } else run = 0;
    }
    run = 0;
    for (let xx = wrapX ? 2 * w - 1 : w - 1; xx >= 0; xx--) {
      const x = xx >= w ? xx - w : xx, i = y * w + x;
      if (id[i]) { if (xx < w) right[i] = run < 255 ? run : 255; run++; } else run = 0;
    }
  }
  const cell = 8, pxp = wrapX ? w / cell : 0;
  return pixelSprite(w, h, (x, y) => {
    const i = y * w + x;
    const m = MATS[id[i]];
    if (!m) return null;
    if (m.emit) return m.emit;
    const t = top[i], b = bot[i];
    let v = m.base;
    v += t === 0 ? m.rim : t === 1 ? m.rim * 0.55 : t < 4 ? m.rim * 0.22 : 0;
    v -= Math.min(t, m.dl) / m.dl * m.dd;
    if (m.rimBot) v += b === 0 ? m.rimBot : b === 1 ? m.rimBot * 0.5 : b < 4 ? m.rimBot * 0.18 : 0;
    else if (b < 2 && t > 2) v -= 0.12;
    if (left[i] < 2) v += m.rimLeft ?? 0.1; else if (m.rimLeft && left[i] < 4) v += m.rimLeft * 0.4;
    if (right[i] < 2) v -= 0.1;
    { // posterised texture → flat patches; dithering only where patches meet
      const tn = fbm2(x / cell, y / cell, pxp, 0, seed + id[i], 3);
      v += (tn < 0.42 ? -1 : tn > 0.58 ? 1 : 0) * m.tex * 0.6;
    }
    v += md[i] * 0.4;
    v += (1 - (y - M) / H) * m.vl;
    return rampBand(m.rp, v, x, y, m.band ?? 0.3);
  });
}

// ---------------------------------------------------------------- water
// Deep blue-teal haze, brighter toward the upper-left where light enters.
const WATER = ramp('#030a14', '#040e1b', '#061423', '#081a2c', '#0a2135', '#0d283f', '#103049', '#143953', '#18425e',
  '#1d4c68', '#235873', '#2a657f');
function makeWater() {
  return pixelSprite(BW, BH, (x, y) => {
    const gx = x - M, gy = y - M;
    const vert = 1 - Math.max(0, gy) / H;
    const bx = (gx - 120) / 190, by = (gy - 10) / 150;
    const bloom = Math.exp(-(bx * bx + by * by));
    const v = 0.08 + 0.32 * vert + 0.5 * bloom;
    return rampBand(WATER, v, x, y, 0.35);
  });
}

// --------------------------------------------------------------- god rays
export const RAY_W = 72, RAY_H = 250;
function makeRay() {
  return pixelSprite(RAY_W, RAY_H, (x, y) => {
    const hw = 7 + (y / RAY_H) * 30;
    const e = 1 - Math.abs(x + 0.5 - RAY_W / 2) / hw;
    if (e <= 0) return null;
    const inten = Math.pow(e, 1.2) * Math.pow(1 - y / RAY_H, 1.2);
    const q = Math.round(inten * 6) / 6; // banded = 90s translucency look
    if (q <= 0) return null;
    return [120, 215, 235, Math.round(q * 64)];
  });
}

// ------------------------------------------------------- city builders
function makeBuilders(ctx, rng, light, mat) {
  const { metal, win, red, winDim } = mat;
  const windows = (x, y, w, h, dens = 0.45, step = 3) => {
    for (let yy = y; yy < y + h; yy += step) {
      for (let xx = x; xx < x + w; xx += 2) {
        if (rng.next() < dens) { const q = rng.next(); ctx.fillStyle = matStyle(q < 0.8 ? win : q < 0.9 ? red : winDim); ctx.fillRect(xx, yy, 1, 1); }
      }
    }
  };
  const antenna = (x, y, len, blink = true) => {
    ctx.fillStyle = matStyle(metal);
    ctx.fillRect(Math.round(x), Math.round(y - len), 1, len);
    if (blink) light(x, y - len - 1, { per: 60 + rng.int(0, 80), ph: rng.int(0, 100), duty: 0.45, big: true });
  };
  // stacked tiered tower with spire
  const tower = (x, base, h, w, o = {}) => {
    let y = base, ww = w;
    const segs = o.segs || Math.max(2, Math.round(h / 22));
    const segH = h / segs;
    for (let s = 0; s < segs; s++) {
      const y0 = Math.round(y - segH);
      ctx.fillStyle = matStyle(metal);
      ctx.fillRect(Math.round(x - ww / 2), y0, Math.round(ww), Math.round(y - y0));
      ctx.fillRect(Math.round(x - ww / 2 - 2), y0, Math.round(ww + 4), 2);           // ledge
      ctx.fillStyle = matStyle(metal, 70);
      ctx.fillRect(Math.round(x + ww / 2 - 2), y0 + 2, 1, Math.round(y - y0 - 2));   // shadow seam
      windows(Math.round(x - ww / 2 + 1), y0 + 4, Math.round(ww - 3), Math.round(y - y0 - 6), o.dens ?? 0.4);
      if (rng.next() < 0.5) { ctx.fillStyle = matStyle(red); ctx.fillRect(Math.round(x - ww / 2 - 2), y0 + 2, 1, 1); ctx.fillRect(Math.round(x + ww / 2 + 1), y0 + 2, 1, 1); }
      y = y0; ww *= o.taper ?? 0.82;
    }
    ctx.fillStyle = matStyle(metal);
    const sh = o.spire ?? Math.round(ww * 2.2);
    ctx.beginPath(); ctx.moveTo(x - ww / 2, y); ctx.lineTo(x, y - sh); ctx.lineTo(x + ww / 2, y); ctx.fill();
    if (o.antenna !== false) antenna(x, y - sh + 1, rng.int(4, 12));
  };
  // saucer platform on a pillar
  const saucer = (x, base, h, rx, o = {}) => {
    const top = base - h, ry = Math.max(3, Math.round(rx * 0.17));
    // massive support: thick column, buttressed flared foot, diagonal braces, collar
    const pw = o.pw || Math.max(6, Math.round(rx * 0.42));
    ctx.fillStyle = matStyle(metal);
    ctx.fillRect(Math.round(x - pw / 2), top, pw, h);
    const fw = pw * 2.6, fh = Math.min(h * 0.32, 26);
    ctx.beginPath(); ctx.moveTo(x - fw / 2, base + 2); ctx.lineTo(x - pw / 2, base - fh); ctx.lineTo(x + pw / 2, base - fh); ctx.lineTo(x + fw / 2, base + 2); ctx.fill();
    for (const s of [-1, 1]) { // buttress fins
      ctx.beginPath(); ctx.moveTo(x + s * fw * 0.62, base + 2); ctx.lineTo(x + s * pw * 0.5, base - fh * 1.5); ctx.lineTo(x + s * pw * 0.5, base + 2); ctx.fill();
    }
    ctx.fillStyle = matStyle(metal, 70);
    ctx.fillRect(Math.round(x + pw / 2 - 3), top + 4, 2, h - 8);                       // shadow side
    ctx.fillStyle = matStyle(metal, 175);
    ctx.fillRect(Math.round(x - pw / 2 + 1), top + 4, 1, h - 8);                       // lit edge
    for (let yy = top + 12; yy < base - fh; yy += 11) {
      ctx.fillStyle = matStyle(metal); ctx.fillRect(Math.round(x - pw / 2 - 2), yy, pw + 4, 3);
      ctx.fillStyle = matStyle(metal, 60); ctx.fillRect(Math.round(x - pw / 2 - 2), yy + 3, pw + 4, 1);
    }
    windows(Math.round(x - pw / 2 + 2), top + rx * 0.5, Math.max(1, pw - 5), Math.max(0, h - rx * 0.5 - fh - 4), 0.18, 4);
    ctx.fillStyle = matStyle(metal);
    ctx.lineWidth = Math.max(2, Math.round(rx * 0.08)); ctx.strokeStyle = matStyle(metal);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * pw / 2, top + rx * 0.9); ctx.lineTo(x + s * rx * 0.72, top + 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x - rx * 0.75, top + 1); ctx.lineTo(x + rx * 0.75, top + 1); ctx.lineTo(x + pw * 0.75, top + rx * 0.5); ctx.lineTo(x - pw * 0.75, top + rx * 0.5); ctx.fill();
    ctx.fillStyle = matStyle(metal, 60); ctx.fillRect(Math.round(x - pw * 0.75), Math.round(top + rx * 0.5), Math.round(pw * 1.5), 2);
    ctx.fillStyle = matStyle(metal);
    ctx.beginPath(); ctx.ellipse(x, top, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = matStyle(metal, 60); ctx.fillRect(Math.round(x - rx + 2), top + 1, Math.round(rx * 2 - 4), 1);
    ctx.fillStyle = matStyle(metal);
    ctx.beginPath(); ctx.ellipse(x, top - ry + 1, rx * 0.45, rx * 0.26, 0, Math.PI, 0); ctx.fill();
    for (let k = -2; k <= 2; k++) if (k && rng.next() < 0.7) { const bw = rng.int(3, 6), bh = rng.int(3, 8); ctx.fillRect(Math.round(x + k * rx * 0.33 - bw / 2), top - ry - bh + 2, bw, bh); }
    windows(Math.round(x - rx * 0.35), Math.round(top - ry - rx * 0.18), Math.round(rx * 0.7), Math.round(rx * 0.16), 0.5, 2);
    for (let xx = Math.round(x - rx + 3); xx < x + rx - 2; xx += 4) { ctx.fillStyle = matStyle(rng.next() < 0.8 ? red : win); ctx.fillRect(xx, top, 1, 1); }
    light(x - rx + 1, top, { per: 50 + rng.int(0, 40), ph: rng.int(0, 60), duty: 0.5 });
    light(x + rx - 2, top, { per: 50 + rng.int(0, 40), ph: rng.int(0, 60), duty: 0.5 });
    if (o.antenna !== false) antenna(x, top - ry - rx * 0.26 + 1, rng.int(6, 14));
  };
  // dome hall
  const dome = (x, base, r) => {
    ctx.fillStyle = matStyle(metal);
    ctx.fillRect(Math.round(x - r), base - Math.round(r * 0.5), Math.round(r * 2), Math.round(r * 0.5));
    ctx.beginPath(); ctx.ellipse(x, base - r * 0.5, r, r * 0.8, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = matStyle(metal, 80); ctx.lineWidth = 1;
    for (let a = -2.6; a <= -0.5; a += 0.42) { ctx.beginPath(); ctx.moveTo(x, base - r * 1.3); ctx.lineTo(x + Math.cos(a) * r, base - r * 0.5 + Math.sin(a) * r * 0.1); ctx.stroke(); }
    windows(Math.round(x - r + 2), base - Math.round(r * 0.45), Math.round(r * 2 - 4), Math.round(r * 0.35), 0.5, 3);
  };
  // flat deck / platform with a red light strip
  const deck = (x, y, w, h, legs = 3) => {
    ctx.fillStyle = matStyle(metal);
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), h);
    ctx.fillRect(Math.round(x - 2), Math.round(y), Math.round(w + 4), 2);
    for (let k = 0; k < legs; k++) { const lx = x + 4 + (k * (w - 10)) / Math.max(1, legs - 1); ctx.fillRect(Math.round(lx), Math.round(y + h), 4, H + M - y - h); }
    for (let xx = Math.round(x + 2); xx < x + w - 2; xx += 3) { ctx.fillStyle = matStyle(rng.next() < 0.75 ? red : winDim); ctx.fillRect(xx, Math.round(y + h - 2), 2, 1); }
    for (let k = 0; k < 3; k++) { const bw = rng.int(4, 9), bh = rng.int(3, 9); ctx.fillStyle = matStyle(metal); ctx.fillRect(Math.round(x + rng.range(2, w - bw - 2)), Math.round(y - bh), bw, bh); }
  };
  // sunken submarine silhouette
  const sub = (x, y, len, ang) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = matStyle(metal);
    const r = len * 0.11;
    ctx.beginPath(); ctx.ellipse(0, 0, len / 2, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-len * 0.12, -r - len * 0.09, len * 0.2, len * 0.1);
    ctx.fillRect(-len * 0.06, -r - len * 0.15, 2, len * 0.07);
    ctx.beginPath(); ctx.moveTo(len * 0.42, 0); ctx.lineTo(len * 0.6, -r * 1.8); ctx.lineTo(len * 0.56, 0); ctx.lineTo(len * 0.6, r * 1.8); ctx.fill();
    ctx.fillStyle = matStyle(metal, 70); ctx.fillRect(-len * 0.4, 0, len * 0.8, 1);
    for (let k = 0; k < 6; k++) { ctx.fillStyle = matStyle(k % 3 ? winDim : win); ctx.fillRect(-len * 0.32 + k * len * 0.1, -2, 1, 1); }
    ctx.restore();
  };
  // massive crumbling block building: floors, recessed windows, broken top,
  // blown-out hole, exposed girders, rubble at the foot
  const ruin = (x, base, w, h, o = {}) => {
    const top = base - h;
    ctx.fillStyle = matStyle(metal);
    ctx.fillRect(Math.round(x), Math.round(top), Math.round(w), Math.round(h + 4));
    ctx.fillRect(Math.round(x - 2), Math.round(base - 6), Math.round(w + 4), 8);       // plinth
    for (let yy = Math.round(top + 9); yy < base - 6; yy += 10) {
      ctx.fillStyle = matStyle(metal, 170); ctx.fillRect(Math.round(x), yy, Math.round(w), 1);
      ctx.fillStyle = matStyle(metal, 70); ctx.fillRect(Math.round(x), yy + 1, Math.round(w), 1);
    }
    for (let yy = Math.round(top + 3); yy < base - 8; yy += 10) {
      for (let xx = Math.round(x + 3); xx < x + w - 4; xx += 5) {
        if (rng.next() < 0.85) { const q = rng.next(); ctx.fillStyle = q < 0.08 ? matStyle(win) : q < 0.11 ? matStyle(red) : matStyle(metal, 30); ctx.fillRect(xx, yy, 2, q < 0.11 ? 3 : 4); }
      }
    }
    ctx.fillStyle = matStyle(metal, 60); ctx.fillRect(Math.round(x + w - 2), Math.round(top), 2, Math.round(h));   // shadow side
    ctx.globalCompositeOperation = 'destination-out';
    // broken top (falls away toward one side)
    const side = o.side ?? (rng.next() < 0.5 ? 1 : -1);
    const depth = h * (o.break ?? 0.45);
    ctx.beginPath();
    const steps = 8;
    const sx = side > 0 ? x + w * 0.3 : x + w * 0.7, ex = side > 0 ? x + w + 2 : x - 2;
    ctx.moveTo(sx, top - 2);
    for (let k = 1; k <= steps; k++) { const f = k / steps; ctx.lineTo(sx + (ex - sx) * f, top + depth * f * f + rng.range(-3, 5)); }
    ctx.lineTo(ex, top - 2); ctx.fill();
    // blown-out hole (optional)
    const hx = x + w * rng.range(0.2, 0.45), hy = top + h * rng.range(0.35, 0.5), hw = w * 0.28, hh = h * 0.16;
    if (o.hole !== false) {
      ctx.beginPath();
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.lineTo(hx + Math.cos(a) * hw * rng.range(0.45, 1), hy + Math.sin(a) * hh * rng.range(0.45, 1.1)); }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // a sagging girder across the hole + bent beams poking out of the break
    ctx.strokeStyle = matStyle(metal); ctx.lineWidth = 1;
    if (o.hole !== false) { ctx.beginPath(); ctx.moveTo(hx - hw, hy - 1); ctx.lineTo(hx + hw * 0.4, hy + hh * 0.8); ctx.stroke(); }
    for (let k = 0; k < 3; k++) {
      const f = rng.range(0.15, 0.85), bx = sx + (ex - sx) * f, by = top + depth * f * f + 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + side * rng.range(2, 6), by - rng.range(5, 11)); ctx.stroke();
    }
    if (o.rubble) rockMass(ctx, side > 0 ? x + w : x, base + 2, w * 0.6, 12, rng, o.rubble);
  };
  return { tower, saucer, dome, deck, sub, windows, antenna, ruin };
}

function rockMass(ctx, x, base, w, h, rng, id) {
  ctx.fillStyle = matStyle(id);
  for (let i = 0; i < 7; i++) {
    const ex = x + rng.range(-w / 2, w / 2), eh = h * rng.range(0.4, 1);
    ctx.beginPath(); ctx.ellipse(ex, base, w * rng.range(0.2, 0.35), eh, 0, Math.PI, 0); ctx.fill();
  }
  ctx.fillStyle = matStyle(id, 70);
  for (let k = 0; k < 6; k++) ctx.fillRect(Math.round(x + rng.range(-w / 3, w / 3)), Math.round(base - rng.range(4, h - 4)), rng.int(3, 7), 1);
}

// ------------------------------------------------- distant skyline (haze)
// A dense cluster of small city silhouettes deep in the haze: nearly flat
// colour, faint windows — gives the far depth plane behind the far layer.
function makeSkyline() {
  const ridge = new Float32Array(TW);
  for (let x = 0; x < TW; x++) ridge[x] = 186 - 10 * (fbm1(x / 100, 8, 51, 3) - 0.5) * 2;
  const ry = (x) => ridge[((Math.round(x) % TW) + TW) % TW];
  const mk = mask(TW, BH, (ctx, wrap) => {
    ctx.fillStyle = matStyle(16);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, Math.round(ridge[x]), 1, H + M - ridge[x]);
    wrap(() => {
      const rng = makeRng(5151);
      // dense clusters: heights peak in the cluster centre
      for (const [cx, span, hmax] of [[120, 150, 96], [400, 120, 78], [640, 170, 110]]) {
        for (let x = cx - span / 2; x < cx + span / 2; x += rng.range(5, 11)) {
          const f = 1 - Math.abs(x - cx) / (span / 2);
          const h = hmax * (0.25 + 0.75 * f) * rng.range(0.6, 1), w = rng.int(4, 9), b = ry(x) + 2;
          ctx.fillStyle = matStyle(16);
          ctx.fillRect(Math.round(x), Math.round(b - h), w, Math.round(h));
          const t = rng.next();
          if (t < 0.35) { ctx.beginPath(); ctx.moveTo(x, b - h); ctx.lineTo(x + w / 2, b - h - rng.range(6, 18)); ctx.lineTo(x + w, b - h); ctx.fill(); }
          else if (t < 0.5) { ctx.beginPath(); ctx.ellipse(x + w / 2, b - h, w * 1.6, 2, 0, 0, Math.PI * 2); ctx.fill(); }
          for (let yy = b - h + 3; yy < b - 3; yy += 4) if (rng.next() < 0.25) { ctx.fillStyle = matStyle(17); ctx.fillRect(Math.round(x + 1 + rng.int(0, Math.max(0, w - 3))), Math.round(yy), 1, 1); }
        }
      }
    });
  });
  return shade(mk, TW, BH, 505);
}

// ----------------------------------------------------------- far layer
export const LIGHTS = { far: [], mid: [], near: [] };
function makeFar() {
  const ridge = new Float32Array(TW);
  for (let x = 0; x < TW; x++) ridge[x] = 196 - 26 * (fbm1(x / 80, 10, 11, 4) - 0.5) * 2;
  const ry = (x) => ridge[((Math.round(x) % TW) + TW) % TW];
  const mk = mask(TW, BH, (ctx, wrap, light) => {
    ctx.fillStyle = matStyle(1);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, Math.round(ridge[x]), 1, H + M - ridge[x]);
    const mkB = (rng) => makeBuilders(ctx, rng, light, { metal: 1, win: 10, red: 11, winDim: 1 });
    wrap(() => {
      const rng = makeRng(1101), B = mkB(rng); // same random stream for every wrap copy (seamless)
      // cathedral-like spire clusters
      for (const [cx, n, hmax] of [[90, 5, 150], [330, 3, 110], [560, 5, 160], [740, 3, 100]]) {
        for (let k = 0; k < n; k++) {
          const x = cx + (k - n / 2) * 15 + rng.range(-3, 3);
          const h = hmax * (0.45 + 0.55 * (1 - Math.abs(k - n / 2) / (n / 2))) * rng.range(0.8, 1);
          B.tower(x, ry(x) + 4, h * 0.75, rng.range(11, 18), { spire: Math.round(h * 0.2), segs: 3, dens: 0.25, taper: 0.86 });
        }
      }
      B.saucer(220, ry(220) + 4, 92, 30);
      B.ruin(262, ry(280) + 4, 50, 72, { side: 1, hole: false });
      B.ruin(405, ry(430) + 4, 62, 100, { side: -1, break: 0.3 });
      B.saucer(490, ry(490) + 4, 70, 24);
      B.sub(640, 52, 64, 0.06);
      B.sub(150, 40, 40, -0.04);
    });
  }, LIGHTS.far);
  return shade(mk, TW, BH, 101);
}

// --------------------------------------------------- ceiling builders
function ceilingMask(id, seed, maxLen, thick, cables) {
  const base = new Float32Array(TW);
  for (let x = 0; x < TW; x++) base[x] = thick + 7 * (fbm1(x / 40, 20, seed, 4) - 0.5) * 2;
  const by = (x) => base[((Math.round(x) % TW) + TW) % TW];
  return mask(TW, BH, (ctx, wrap) => {
    ctx.fillStyle = matStyle(id);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, -M, 1, M + Math.round(base[x]));
    wrap(() => {
      const rng = makeRng(seed);
      ctx.fillStyle = matStyle(id);
      for (let i = 0; i < 40; i++) { const x = rng.range(0, TW); ctx.beginPath(); ctx.ellipse(x, by(x), rng.range(6, 18), rng.range(3, 7), 0, 0, Math.PI * 2); ctx.fill(); }
      for (let i = 0; i < 46; i++) {
        const x = rng.range(0, TW), y0 = by(x) - 2;
        const long = rng.next() < 0.22;
        const len = long ? rng.range(maxLen * 0.6, maxLen) : rng.range(5, maxLen * 0.45);
        const w = long ? rng.range(9, 16) : rng.range(4, 10);
        const pts = 6, jx = rng.range(-2, 2);
        ctx.beginPath(); ctx.moveTo(x - w / 2, y0);
        for (let k = 1; k <= pts; k++) { const f = k / pts; ctx.lineTo(x - (w / 2) * Math.pow(1 - f, 0.8) + jx * f + rng.range(-0.8, 0.8), y0 + len * f); }
        for (let k = pts - 1; k >= 0; k--) { const f = k / pts; ctx.lineTo(x + (w / 2) * Math.pow(1 - f, 0.8) + jx * f + rng.range(-0.8, 0.8), y0 + len * f); }
        ctx.fill();
        if (long && rng.next() < 0.6) {
          const x2 = x + rng.sign() * w * 0.5, l2 = len * rng.range(0.3, 0.55);
          ctx.beginPath(); ctx.moveTo(x2 - 3, y0); ctx.lineTo(x2, y0 + l2); ctx.lineTo(x2 + 3, y0); ctx.fill();
        }
      }
      if (cables) {
        ctx.strokeStyle = matStyle(id); ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const x = rng.range(0, TW), span = rng.range(20, 60), sag = rng.range(8, 22);
          ctx.beginPath(); ctx.moveTo(x, by(x) - 1); ctx.quadraticCurveTo(x + span / 2, by(x) + sag * 2, x + span, by(x + span) - 1); ctx.stroke();
          if (rng.next() < 0.5) { ctx.beginPath(); ctx.moveTo(x + span * 0.3, by(x) + sag * 0.6); ctx.lineTo(x + span * 0.32, by(x) + sag * 0.6 + rng.range(6, 14)); ctx.stroke(); }
        }
      }
    });
  });
}

// ----------------------------------------------------------- mid layer
function makeMid() {
  const ridge = new Float32Array(TW);
  for (let x = 0; x < TW; x++) ridge[x] = 200 - 16 * (fbm1(x / 50, 16, 23, 4) - 0.5) * 2;
  const ry = (x) => ridge[((Math.round(x) % TW) + TW) % TW];
  const mk = mask(TW, BH, (ctx, wrap, light) => {
    ctx.fillStyle = matStyle(4);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, Math.round(ridge[x]), 1, H + M - ridge[x]);
    const mkB = (rng) => makeBuilders(ctx, rng, light, { metal: 3, win: 8, red: 9, winDim: 10 });
    wrap(() => {
      const rng = makeRng(2303), B = mkB(rng); // same random stream for every wrap copy (seamless)
      for (const [x, w, h] of [[70, 80, 50], [300, 90, 36], [500, 110, 40], [700, 80, 30]]) rockMass(ctx, x, ry(x) + 6, w, h, rng, 4);
      // left cluster: fewer, thicker towers
      B.tower(62, ry(62) - 34, 112, 24, { spire: 20, segs: 5, taper: 0.86 });
      B.tower(92, ry(92) - 30, 76, 18, { spire: 14, taper: 0.85 });
      B.tower(36, ry(36) - 26, 58, 15, { spire: 10 });
      ctx.fillStyle = matStyle(3); ctx.fillRect(44, ry(60) - 98, 52, 3);
      B.saucer(176, ry(176) + 2, 120, 40);
      B.ruin(222, ry(240) + 4, 46, 74, { side: 1, rubble: 4 });
      B.saucer(318, ry(318) - 18, 72, 30);
      B.dome(384, ry(384) - 8, 22);
      B.ruin(440, ry(470) + 4, 66, 96, { side: -1, break: 0.38, rubble: 4 });
      bigRock(ctx, 512, 92, 88, rng, { mat: 18, wall: true });          // thick rock wall
      fallenBridge(ctx, 336, 128, 96, 3, rng, light);
      girderPile(ctx, 288, ry(288) + 3, 3, rng);
      B.saucer(616, ry(616) + 2, 92, 30);
      B.ruin(676, ry(690) + 4, 40, 58, { side: 1, rubble: 4 });
      B.tower(752, ry(752) + 2, 64, 16, { spire: 16 });
    });
  }, LIGHTS.mid);
  return shade(mk, TW, BH, 202);
}

// ----------------------------------------------------------- near layer
// Massive rock formation. Silhouette = crag skyline (or a flat-topped wall
// when opts.wall); its body is built from stacked boulders, each shaded
// lit-top-left / mid / shadow-bottom-right via the G channel, so faces read
// as solid planes (not a black cut-out). Plus strata, cracks, lit ledges.
function bigRock(ctx, x0, w, peakY, rng, opts = {}) {
  const mat = opts.mat || 15, wall = !!opts.wall;
  const bottom = H + M;
  const pts = [];
  const n = Math.round(w / 6);
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const prof = wall
      ? Math.min(1, f * 7, (1 - f) * 5)
      : Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.1 + 0.02)), 0.55);
    const y = bottom - (bottom - peakY) * prof * rng.range(wall ? 0.86 : 0.82, 1) - (k % 3 === 0 ? rng.range(0, 8) : 0) + (wall && k % 4 === 2 ? rng.range(0, 10) : 0);
    pts.push([x0 + f * w + rng.range(-2, 2), y]);
  }
  const outline = () => { ctx.beginPath(); ctx.moveTo(x0 - 4, bottom); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.lineTo(x0 + w + 4, bottom); ctx.closePath(); };
  ctx.fillStyle = matStyle(mat, 95);
  outline(); ctx.fill();
  if (!wall) { // overhanging ledge near the summit
    const pk = pts[Math.round(n * 0.4)];
    ctx.beginPath(); ctx.ellipse(pk[0] + w * 0.12, pk[1] + 14, w * 0.2, 5, -0.08, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  outline(); ctx.clip();
  // boulders, bottom rows first so upper boulders' lit crowns overlap
  const rows = Math.max(2, Math.round((bottom - peakY) / 22));
  for (let r = 0; r < rows; r++) {
    const yC = bottom - 6 - r * ((bottom - peakY) / rows);
    const cols = Math.max(2, Math.round(w / 30));
    for (let c = 0; c < cols; c++) {
      const cx = x0 + (c + 0.5 + rng.range(-0.3, 0.3)) * (w / cols), cy = yC + rng.range(-5, 5);
      const rx = rng.range(14, 24) * (wall ? 1.2 : 1), ry = rng.range(10, 17) * (wall ? 0.7 : 1);
      const poly = [];
      const nv = rng.int(6, 8);
      for (let k = 0; k < nv; k++) { const a = (k / nv) * Math.PI * 2 + rng.range(-0.2, 0.2); const q = rng.range(0.75, 1); poly.push([cx + Math.cos(a) * rx * q, cy + Math.sin(a) * ry * q]); }
      const path = (dx, dy, s) => { ctx.beginPath(); for (const [px, py] of poly) ctx.lineTo(cx + (px - cx) * s + dx, cy + (py - cy) * s + dy); ctx.closePath(); };
      ctx.save();
      path(0, 0, 1); ctx.clip();
      ctx.fillStyle = matStyle(mat, 185); path(0, 0, 1); ctx.fill();                 // lit face
      ctx.fillStyle = matStyle(mat, 125); path(rx * 0.22, ry * 0.3, 1); ctx.fill();   // mid face
      ctx.fillStyle = matStyle(mat, 70); path(rx * 0.55, ry * 0.65, 1); ctx.fill();   // shadow face
      ctx.restore();
      ctx.strokeStyle = matStyle(mat, 40); ctx.lineWidth = 1; path(0, 0, 1); ctx.stroke(); // crevice
    }
  }
  if (wall) { // strata
    for (let y = peakY + 6; y < bottom; y += rng.int(7, 11)) {
      ctx.fillStyle = matStyle(mat, 200); ctx.fillRect(x0, Math.round(y), w, 1);
      ctx.fillStyle = matStyle(mat, 45); ctx.fillRect(x0, Math.round(y) + 1, w, 1);
    }
  }
  // cracks
  ctx.strokeStyle = matStyle(mat, 35); ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = x0 + rng.range(w * 0.1, w * 0.9), y = rng.range(peakY + 10, bottom - 10);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += rng.range(-5, 5); y += rng.range(3, 8); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // lit ledges with a shadow line beneath
  for (let i = 0; i < 9; i++) {
    const lx = Math.round(x0 + rng.range(4, w - 20)), ly = Math.round(rng.range(peakY + 10, bottom - 14)), lw = rng.int(8, 20);
    ctx.fillStyle = matStyle(mat, 225); ctx.fillRect(lx, ly, lw, 1);
    ctx.fillStyle = matStyle(mat, 160); ctx.fillRect(lx + 1, ly + 1, lw - 2, 1);
    ctx.fillStyle = matStyle(mat, 35); ctx.fillRect(lx + 2, ly + 2, lw - 3, 2);
  }
  ctx.restore();
}

// Collapsed horizontal structure: a truss bridge / deck snapped in the
// middle — one half still level on its pier, the other sagging down.
function fallenBridge(ctx, x0, y0, len, mat, rng, light) {
  const brk = len * rng.range(0.45, 0.6), drop = rng.range(16, 30);
  const seg = (ax, ay, bx, by) => {
    const ang = Math.atan2(by - ay, bx - ax), L = Math.hypot(bx - ax, by - ay);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
    ctx.fillStyle = matStyle(mat); ctx.fillRect(0, -3, L, 5);                         // deck slab
    ctx.fillStyle = matStyle(mat, 190); ctx.fillRect(0, -3, L, 1);                     // lit top edge
    ctx.fillStyle = matStyle(mat, 60); ctx.fillRect(0, 1, L, 1);
    ctx.strokeStyle = matStyle(mat); ctx.lineWidth = 1;                                // truss below
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(L, 2); ctx.moveTo(0, 9); ctx.lineTo(L, 9);
    for (let k = 0; k < L - 6; k += 8) { ctx.moveTo(k, 2); ctx.lineTo(k + 4, 9); ctx.lineTo(k + 8, 2); }
    ctx.stroke();
    ctx.restore();
  };
  // piers
  ctx.fillStyle = matStyle(mat);
  ctx.fillRect(Math.round(x0 + 4), Math.round(y0 + 8), 8, H + M - y0);
  ctx.fillRect(Math.round(x0 + len - 12), Math.round(y0 + drop + 8), 8, H + M - y0);
  seg(x0, y0, x0 + brk, y0 + 1);                                                       // level half
  seg(x0 + brk + 4, y0 + 6, x0 + len, y0 + drop);                                      // fallen half
  // torn ends: bent beams + dangling cable
  ctx.strokeStyle = matStyle(mat); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0 + brk, y0); ctx.lineTo(x0 + brk + 5, y0 - 5); ctx.moveTo(x0 + brk, y0 + 4); ctx.lineTo(x0 + brk + 2, y0 + 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0 + brk - 6, y0 + 9); ctx.quadraticCurveTo(x0 + brk - 2, y0 + 24, x0 + brk + 3, y0 + 30); ctx.stroke();
  for (let k = 0; k < Math.floor(brk / 10); k++) { ctx.fillStyle = matStyle(9); ctx.fillRect(Math.round(x0 + 6 + k * 10), Math.round(y0 - 1), 1, 1); }
  if (light) light(x0 + 3, y0 - 2, { per: 70, ph: rng.int(0, 60), duty: 0.5 });
}

// pile of broken I-beams lying on the floor
function girderPile(ctx, x, base, mat, rng) {
  for (let i = 0; i < 4; i++) {
    const L = rng.range(18, 40), a = rng.range(-0.5, 0.5);
    ctx.save(); ctx.translate(x + rng.range(-14, 14), base - rng.range(2, 8)); ctx.rotate(a);
    ctx.fillStyle = matStyle(mat); ctx.fillRect(-L / 2, -3, L, 4);
    ctx.fillStyle = matStyle(mat, 195); ctx.fillRect(-L / 2, -3, L, 1);
    ctx.fillStyle = matStyle(mat, 50); for (let k = -L / 2 + 3; k < L / 2 - 2; k += 5) ctx.fillRect(Math.round(k), -1, 2, 1);
    ctx.restore();
  }
}

function makeNear() {
  const ridge = new Float32Array(TW);
  for (let x = 0; x < TW; x++) ridge[x] = Math.round((210 - 12 * (fbm1(x / 80, 10, 37, 4) - 0.5) * 2) / 2) * 2;
  const ry = (x) => ridge[((Math.round(x) % TW) + TW) % TW];
  const mk = mask(TW, BH, (ctx, wrap, light) => {
    ctx.fillStyle = matStyle(6);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, ridge[x], 1, H + M - ridge[x]);
    const mkB = (rng) => makeBuilders(ctx, rng, light, { metal: 5, win: 12, red: 9, winDim: 11 });
    wrap(() => {
      const rng = makeRng(3707), B = mkB(rng); // same random stream for every wrap copy (seamless)
      bigRock(ctx, -14, 168, 92, rng);
      bigRock(ctx, 470, 130, 126, rng);
      for (const [x, w, h] of [[300, 90, 22], [690, 70, 18]]) rockMass(ctx, x, ry(x) + 4, w, h, rng, 6);
      fallenBridge(ctx, 168, 168, 112, 5, rng, light);
      bigRock(ctx, 262, 104, 134, rng);
      B.deck(370, 194, 70, 5, 3);
      B.saucer(650, ry(650) + 2, 48, 22);
      fallenBridge(ctx, 686, 180, 100, 5, rng, light);
      girderPile(ctx, 425, ry(425) + 2, 5, rng);
      for (const [x0, y, n] of [[374, 197, 4]]) for (let k = 0; k < n; k++) light(x0 + k * 18, y, { per: 48, ph: k * 8, duty: 0.35 });
    });
  }, LIGHTS.near);
  return shade(mk, TW, BH, 303);
}

// ------------------------------------------------------- foreground pieces
function makeKelpBlades() {
  const blades = [];
  for (let v = 0; v < 4; v++) {
    const w = 11, h = 9;
    const mk = makeSprite(w, h, (ctx) => {
      ctx.fillStyle = matStyle(14);
      ctx.fillRect(5, 0, 2, h);
      const side = v % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(5.5 + side * 3, 4.5 + (v > 1 ? 1 : -1), 3.6, 2.2, side * -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = matStyle(14, 200); ctx.fillRect(5, 0, 1, h);
    });
    blades.push(shade(mk, w, h, 500 + v, { wrap: false }));
  }
  return blades;
}
// dark rock outcrop (bottom-left in the reference); kept low so it never hides bullets.
function makeFrontRock(w, h, seed) {
  const rng = makeRng(seed);
  const mk = makeSprite(w, h, (ctx) => {
    ctx.fillStyle = matStyle(13);
    const n = Math.round(w / 14);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const peak = Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.25)), 0.7);
      ctx.beginPath();
      ctx.ellipse(8 + f * (w - 16) + rng.range(-4, 4), h + 2, rng.range(9, 16), Math.max(6, (h - 2) * peak * rng.range(0.75, 1)), rng.range(-0.15, 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.ellipse(rng.range(10, w - 10), h - rng.range(2, h * 0.6), rng.range(3, 7), rng.range(2, 4), 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = matStyle(13, 55);
    for (let k = 0; k < 14; k++) ctx.fillRect(Math.round(rng.range(8, w - 8)), Math.round(rng.range(h * 0.35, h - 2)), rng.int(3, 8), 1);
  });
  return shade(mk, w, h, seed, { wrap: false });
}

// ------------------------------------------------------------ bubbles
export function makeBubbles() {
  return [1.5, 2, 3].map((r) => {
    const s = Math.ceil(r * 2 + 1);
    const c = (s - 1) / 2;
    return pixelSprite(s, s, (x, y) => {
      const dx = x - c, dy = y - c, d = Math.sqrt(dx * dx + dy * dy);
      if (d > r + 0.3) return null;
      if (r > 1.5 && Math.round(dx) === -1 && Math.round(dy) === -1) return [255, 255, 255, 255];
      if (d > r - 0.8) return [150, 220, 245, dy > 0 ? 120 : 185];
      return [120, 200, 240, r < 2 ? 25 : 50];
    });
  });
}

// light glow sprite (additive) for blinking city lights
function makeGlow(r, col) {
  const S = r * 2 + 1;
  return pixelSprite(S, S, (x, y) => {
    const d = Math.hypot(x - r, y - r) / (r + 0.5);
    if (d >= 1) return null;
    if (d < 0.2) return [255, 230, 220, 255];
    const q = Math.round((1 - d) ** 1.6 * 4) / 4;
    return q > 0 ? [...col, Math.round(q * 200)] : null;
  });
}

let ART = null;
export function getArt() {
  if (ART) return ART;
  LIGHTS.far.length = LIGHTS.mid.length = LIGHTS.near.length = 0;
  ART = {
    water: makeWater(),
    ray: makeRay(),
    skyline: makeSkyline(),
    far: makeFar(),
    farCeil: shade(ceilingMask(2, 61, 30, 10, false), TW, BH, 61),
    mid: makeMid(),
    near: makeNear(),
    ceil: shade(ceilingMask(7, 71, 40, 6, true), TW, BH, 71),
    kelp: makeKelpBlades(),
    frontRock: makeFrontRock(150, 44, 555),
    frontRock2: makeFrontRock(70, 22, 556),
    bubbles: makeBubbles(),
    glowBig: makeGlow(3, [255, 60, 40]),
    glow: makeGlow(2, [255, 60, 40]),
    lights: LIGHTS,
  };
  return ART;
}
