// ZONE G "SUNSET TIDELANDS" — pre-rendered pixel art (bg/fx agent). Built
// lazily the first time zone G is entered, then cached.
//
// Silhouette technique: shapes are drawn as masks (R = id * 20: 1 body,
// 2 lighter metal, 3+ emissive; G = shade modifier, 128 neutral), then shaded
// as sunset back-lit silhouettes: dark body, warm rim light on top/left edges
// (sun low on the left), haze lift toward the horizon, localised dithering.

import { makeSprite } from '../core/util.js';
import { makeRng } from '../core/rng.js';
import { fbm1, fbm2, ramp, rampBand, pixelSprite, bayer, hash } from './bg-noise.js';
import { M, BW, BH, TW } from './bg-art.js';
import { W, H } from '../config.js';

export const SURF_DEFAULT = Math.round(H * 0.66);   // playfield y of the sea surface
export const SUN_X = 70;                            // playfield x of the low sun
export const SKY_EXTRA = 60;                        // sky sprite is taller so surfaceY can move

const ms = (id, mod = 128) => `rgb(${id * 20},${mod},0)`;

// ------------------------------------------------------------ sky + sea
const SKY = ramp('#0b0d2a', '#10133a', '#171a48', '#211f56', '#2e2560', '#3f2b68', '#55306c', '#6e3569', '#8a3c62',
  '#a8485a', '#c45a4e', '#dc7046', '#ec8a44', '#f6a84c', '#fcc664', '#ffe08a');
const SEA = ramp('#04061a', '#070a22', '#0b0f2c', '#111536', '#181b40', '#22224a');
function makeSky() {
  const h = BH + SKY_EXTRA;
  const hy = SURF_DEFAULT + M + SKY_EXTRA / 2; // horizon row inside this sprite
  return {
    hy,
    img: pixelSprite(BW, h, (x, y) => {
      const gx = x - M;
      if (y < hy) {
        const t = y / hy;
        const dx = (gx - SUN_X) / 120, dy = (y - hy + 8) / 60;
        const glow = Math.exp(-(dx * dx + dy * dy));
        const v = Math.pow(t, 1.6) * 0.82 + glow * 0.35;
        // sun disk
        const sd = Math.hypot(gx - SUN_X, y - (hy - 9));
        if (sd < 9) return sd < 7 ? [255, 236, 170] : [255, 210, 120];
        return rampBand(SKY, v, x, y, 0.35);
      }
      // sea body (seen through the translucent water below the surface)
      const d = (y - hy) / (h - hy);
      const glint = Math.exp(-Math.pow((gx - SUN_X) / (16 + d * 30), 2)) * (1 - d) * 0.5;
      return rampBand(SEA, 0.75 - d * 0.75 + glint, x, y, 0.3);
    }),
  };
}

// ----------------------------------------------------------------- clouds
// dramatic band clouds: lit (orange/pink) undersides, dark violet tops
const CLOUD = ramp('#1a1640', '#261c4c', '#3a2456', '#552c5c', '#76365c', '#9c4458', '#c45c50', '#e8804c', '#ffb066');
function makeClouds(seed, storm) {
  const ch = 120;
  const dens = (x, y) => {
    const band = Math.exp(-Math.pow((y - 30) / 22, 2)) * 0.9 + Math.exp(-Math.pow((y - 78) / 14, 2)) * 0.75;
    return fbm2(x / 50, y / 12, TW / 50, 0, seed, 4) * band * (storm ? 1.5 : 1.15);
  };
  const STORM = ramp('#0a0a18', '#121226', '#1a1a34', '#24223e', '#2e2a48', '#3a3352');
  return pixelSprite(TW, ch, (x, y) => {
    const d = dens(x, y);
    if (d < (storm ? 0.42 : 0.52)) return null;
    const under = dens(x, y + 3) < d - 0.03;   // underside → lit by the low sun
    const top = dens(x, y - 3) < 0.5;
    if (storm) return [...rampBand(STORM, 0.3 + (top ? 0.3 : 0) + (d - 0.5) * 0.5, x, y, 0.25), 235];
    let v = 0.25 + (y / ch) * 0.35 + (under ? 0.35 : 0) - (top ? 0.12 : 0) + (d - 0.6) * 0.4;
    return [...rampBand(CLOUD, v, x, y, 0.25), 255];
  });
}

// ------------------------------------------------- silhouette shading
function shadeSil(mk, w, h, pal, horizon, wrap = true) {
  const src = mk.getContext('2d').getImageData(0, 0, w, h).data;
  const N = w * h, id = new Uint8Array(N), md = new Float32Array(N);
  for (let i = 0; i < N; i++) if (src[i * 4 + 3] >= 110) { id[i] = Math.round(src[i * 4] / 20); md[i] = (src[i * 4 + 1] - 128) / 128; }
  const solid = (x, y) => { if (y < 0 || y >= h) return false; if (x < 0 || x >= w) { if (!wrap) return false; x = (x + w) % w; } return id[y * w + x] > 0; };
  return pixelSprite(w, h, (x, y) => {
    const k = id[y * w + x];
    if (!k) return null;
    if (pal.emit[k]) return pal.emit[k];
    const topEdge = !solid(x, y - 1), top2 = !solid(x, y - 2), leftEdge = !solid(x - 1, y);
    if (topEdge && pal.rim) return pal.rim;
    if ((leftEdge || top2) && pal.rim2) return pal.rim2;
    let v = pal.base + (k === 2 ? 0.12 : 0) + md[i(x, y)] * 0.4;
    if (horizon) v += Math.max(0, 1 - Math.abs(horizon - y) / 40) * 0.18;   // haze glow near horizon
    v += (fbm2(x / 8, y / 8, wrap ? w / 8 : 0, 0, 77, 2) < 0.4 ? -0.08 : 0);
    return rampBand(pal.ramp, v, x, y, 0.25);
  });
  function i(x, y) { return y * w + x; }
}

// layer masks drawn in buffer coordinates where the horizon (surface) is at
// row HZ; layers are then drawn shifted by (surfaceY - SURF_DEFAULT).
const HZ = SURF_DEFAULT + M;
function mask(w, h, draw) {
  return makeSprite(w, h, (ctx) => {
    const wrap = (fn) => { for (const ox of [0, -w, w]) { ctx.save(); ctx.translate(ox, 0); fn(); ctx.restore(); } };
    draw(ctx, wrap);
  });
}

// ------------------------------------------------------- distant rigs
export const G_LIGHTS = { rigs: [], city: [], flares: [] };
function makeRigs() {
  const mk = mask(TW, BH, (ctx, wrap) => {
    wrap(() => {
      const rng = makeRng(707);
      for (const x of [230, 330, 470, 560, 690]) {
        const h = rng.range(20, 34), w = rng.range(16, 26);
        ctx.fillStyle = ms(1);
        for (const lx of [x, x + w * 0.45, x + w - 2]) ctx.fillRect(Math.round(lx), Math.round(HZ - h * 0.55), 2, Math.round(h * 0.55) + 1);
        ctx.strokeStyle = ms(1); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, HZ); ctx.lineTo(x + w * 0.45, HZ - h * 0.5); ctx.lineTo(x + w - 2, HZ); ctx.stroke();
        ctx.fillRect(Math.round(x - 3), Math.round(HZ - h * 0.55 - 4), Math.round(w + 6), 4);       // deck
        ctx.fillRect(Math.round(x + 2), Math.round(HZ - h * 0.55 - 9), 8, 5);                       // module
        ctx.fillRect(Math.round(x + w * 0.6), Math.round(HZ - h), 2, Math.round(h * 0.45));          // derrick
        ctx.beginPath(); ctx.moveTo(x + w * 0.6 - 3, HZ - h * 0.55 - 4); ctx.lineTo(x + w * 0.6 + 1, HZ - h); ctx.lineTo(x + w * 0.6 + 5, HZ - h * 0.55 - 4); ctx.stroke();
        ctx.fillStyle = ms(3); ctx.fillRect(Math.round(x + w * 0.6), Math.round(HZ - h - 1), 1, 1);
        if (rng.next() < 0.7) G_LIGHTS.rigs.push({ x: Math.round(x + w * 0.6), y: Math.round(HZ - h - 1), per: 80 + rng.int(0, 60), ph: rng.int(0, 99) });
        for (let k = 0; k < 3; k++) { ctx.fillStyle = ms(4); ctx.fillRect(Math.round(x + rng.range(0, w)), Math.round(HZ - h * 0.55 - 2), 1, 1); }
      }
      // long pier
      ctx.fillStyle = ms(1); ctx.fillRect(380, HZ - 9, 70, 2);
      for (let k = 0; k < 8; k++) ctx.fillRect(382 + k * 9, HZ - 8, 1, 8);
    });
  });
  return shadeSil(mk, TW, BH, { ramp: ramp('#1c1438', '#24183f', '#2c1c46'), base: 0.4, rim: [150, 70, 80], rim2: null, emit: { 3: [255, 70, 50], 4: [255, 150, 70] } }, HZ);
}

// --------------------------------------------- coastal refinery city
function makeCity() {
  const rng0 = 909;
  const mk = mask(TW, BH, (ctx, wrap) => {
    wrap(() => {
      const rng = makeRng(rng0);
      const lit = (x, y, red = false) => { ctx.fillStyle = ms(red ? 3 : 4); ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
      // big elevated platform (left) on legs over the water
      const P = { x: -10, w: 190, y: HZ - 62 };
      ctx.fillStyle = ms(1);
      ctx.fillRect(P.x, P.y, P.w, 10);
      ctx.fillStyle = ms(2); ctx.fillRect(P.x, P.y, P.w, 2);
      ctx.fillStyle = ms(1);
      for (let lx = P.x + 8; lx < P.x + P.w - 4; lx += 22) { ctx.fillRect(lx, P.y + 10, 4, HZ - P.y - 10); ctx.fillRect(lx - 3, HZ - 4, 10, 4); }
      ctx.strokeStyle = ms(1); ctx.lineWidth = 1;
      for (let lx = P.x + 8; lx < P.x + P.w - 26; lx += 22) { ctx.beginPath(); ctx.moveTo(lx + 4, P.y + 12); ctx.lineTo(lx + 22, HZ - 20); ctx.moveTo(lx + 22, P.y + 12); ctx.lineTo(lx + 4, HZ - 20); ctx.stroke(); }
      for (let lx = P.x + 4; lx < P.x + P.w; lx += 5) if (rng.next() < 0.6) lit(lx, P.y + 6, rng.next() < 0.3);
      // dripping struts under the platform
      for (let k = 0; k < 14; k++) { ctx.fillStyle = ms(1); ctx.fillRect(Math.round(P.x + rng.range(4, P.w - 4)), P.y + 10, 1, rng.int(3, 9)); }
      // spires on the platform (cathedral-industrial)
      for (const [sx, sh, sw] of [[22, 92, 12], [48, 70, 9], [80, 118, 14], [104, 64, 8], [132, 86, 11], [160, 50, 8]]) {
        const b = P.y;
        ctx.fillStyle = ms(1);
        let y = b, ww = sw;
        for (let s = 0; s < 4; s++) {
          const sh2 = sh * 0.2;
          ctx.fillStyle = ms(1);
          ctx.fillRect(Math.round(sx - ww / 2), Math.round(y - sh2), Math.round(ww), Math.round(sh2) + 1);
          ctx.fillRect(Math.round(sx - ww / 2 - 1), Math.round(y - sh2), Math.round(ww + 2), 1);
          for (let yy = y - sh2 + 2; yy < y - 1; yy += 3) if (rng.next() < 0.35) lit(sx - ww / 2 + 1 + rng.int(0, Math.max(0, ww - 3)), yy, rng.next() < 0.25);
          y -= sh2; ww *= 0.78;
        }
        ctx.fillStyle = ms(1);
        ctx.beginPath(); ctx.moveTo(sx - ww / 2, y); ctx.lineTo(sx, y - sh * 0.22); ctx.lineTo(sx + ww / 2, y); ctx.fill();
        ctx.fillRect(Math.round(sx), Math.round(y - sh * 0.22 - 6), 1, 6);
        G_LIGHTS.city.push({ x: Math.round(sx), y: Math.round(y - sh * 0.22 - 7), per: 70 + rng.int(0, 70), ph: rng.int(0, 99) });
        // flying buttress pipes
        ctx.strokeStyle = ms(1);
        ctx.beginPath(); ctx.moveTo(sx + sw / 2, b - sh * 0.35); ctx.quadraticCurveTo(sx + sw * 1.4, b - sh * 0.3, sx + sw * 1.6, b); ctx.stroke();
      }
      // storage tanks + flare stack on the right end of the platform
      for (const [tx, tr] of [[196, 12], [224, 9]]) {
        ctx.fillStyle = ms(2);
        ctx.fillRect(tx - tr, HZ - 22, tr * 2, 22);
        ctx.beginPath(); ctx.ellipse(tx, HZ - 22, tr, 4, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = ms(1, 70); ctx.fillRect(tx + tr - 3, HZ - 21, 2, 21);
        lit(tx - tr + 2, HZ - 12, true);
      }
      ctx.fillStyle = ms(1); ctx.fillRect(250, HZ - 74, 3, 74); ctx.fillRect(247, HZ - 76, 9, 2);
      G_LIGHTS.flares.push({ x: 251, y: HZ - 78 });
      // cranes + secondary blocks along the coast
      ctx.strokeStyle = ms(1); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(290, HZ); ctx.lineTo(296, HZ - 52); ctx.lineTo(330, HZ - 48); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(326, HZ - 48); ctx.lineTo(326, HZ - 30); ctx.stroke();
      ctx.fillStyle = ms(1);
      for (const [bx, bw, bh] of [[600, 30, 26], [636, 18, 40], [660, 40, 18], [740, 22, 34]]) {
        ctx.fillStyle = ms(1); ctx.fillRect(bx, HZ - bh, bw, bh);
        for (let yy = HZ - bh + 3; yy < HZ - 2; yy += 4) for (let xx = bx + 2; xx < bx + bw - 2; xx += 3) if (rng.next() < 0.25) lit(xx, yy, rng.next() < 0.2);
      }
      ctx.fillStyle = ms(1); ctx.fillRect(700, HZ - 60, 3, 60); G_LIGHTS.flares.push({ x: 701, y: HZ - 62 });
      // shoreline rubble
      for (let x = 0; x < TW; x += 3) { const hh = Math.max(0, Math.round(3 + 3 * Math.sin(x * 0.05) + rng.range(-1, 1))); ctx.fillStyle = ms(1); ctx.fillRect(x, HZ - hh, 3, hh); }
    });
  });
  return shadeSil(mk, TW, BH, {
    ramp: ramp('#0c0818', '#120c22', '#18102a', '#201634', '#2a1c3e', '#36244a'),
    base: 0.35, rim: [255, 150, 90], rim2: [170, 80, 80], emit: { 3: [255, 60, 40], 4: [255, 170, 80] },
  }, HZ);
}

// --------------------------------------------------------- mud seabed
function makeMud() {
  const mk = mask(TW, BH, (ctx, wrap) => {
    const top = new Float32Array(TW);
    for (let x = 0; x < TW; x++) top[x] = H + M - 22 + 7 * (fbm1(x / 50, 16, 61, 4) - 0.5) * 2;
    ctx.fillStyle = ms(1);
    for (let x = 0; x < TW; x++) ctx.fillRect(x, Math.round(top[x]), 1, BH - top[x]);
    wrap(() => {
      const rng = makeRng(616);
      for (let i = 0; i < 26; i++) {
        const x = rng.range(0, TW), r = rng.range(3, 12), y = top[Math.floor(((x % TW) + TW) % TW)] + 2;
        ctx.fillStyle = ms(2, rng.int(90, 170));
        ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r, 0, Math.PI, 0); ctx.fill();
      }
      for (let i = 0; i < 18; i++) { ctx.fillStyle = ms(1, 60); ctx.fillRect(Math.round(rng.range(0, TW)), Math.round(H + M - rng.range(4, 16)), rng.int(4, 12), 1); }
    });
  });
  return shadeSil(mk, TW, BH, { ramp: ramp('#0a0812', '#120e1a', '#1a1422', '#241a2a', '#302232', '#3e2c3a'), base: 0.35, rim: [120, 80, 90], rim2: [80, 56, 70], emit: {} }, 0);
}

// ---------------------------------------------- surface strip frames
export const GS_W = 128, GS_H = 14, GS_FR = 12;
function makeSurface() {
  const fr = [];
  const TAU = Math.PI * 2;
  for (let f = 0; f < GS_FR; f++) {
    const T = (f / GS_FR) * TAU;
    fr.push(pixelSprite(GS_W, GS_H, (x, y) => {
      const u = (x / GS_W) * TAU;
      const ys = 5 + 1.6 * Math.sin(2 * u + T) + 0.9 * Math.sin(5 * u - 2 * T) + 0.5 * Math.sin(11 * u + 3 * T);
      const d = y - ys;
      if (d < -0.6) return null;
      if (d < 0.6) return [255, 214, 170, 255];                     // sunlit crest line
      if (d < 1.6) return [200, 120, 130, 230];
      const s = Math.abs(Math.sin(7 * u + 2 * Math.sin(3 * u - T) + d * 0.5 + T));
      if ((1 - s) ** 4 * (1 - d / GS_H) > 0.2 + bayer(x, y) * 0.5) return [230, 150, 140, 170];
      return null;
    }));
  }
  return fr;
}

// underwater tint (drawn over the boss region below the surface)
function makeUnder() {
  return pixelSprite(W, H, (x, y) => {
    const a = 0.2 + 0.3 * Math.min(1, y / 70);
    const q = Math.round(a * 8) / 8;
    return [16, 26, 70, Math.round(q * 255)];
  });
}

// front rocks (dark, warm rim) + gulls
function makeFrontRock(w, h, seed) {
  const mk = makeSprite(w, h, (ctx) => {
    const rng = makeRng(seed);
    ctx.fillStyle = ms(1);
    const n = Math.round(w / 12);
    for (let i = 0; i < n; i++) {
      const f = i / Math.max(1, n - 1);
      const pk = Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.2)), 0.7);
      ctx.beginPath(); ctx.ellipse(6 + f * (w - 12) + rng.range(-3, 3), h + 2, rng.range(7, 13), Math.max(5, (h - 2) * pk * rng.range(0.7, 1)), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = ms(1, 60);
    for (let k = 0; k < 10; k++) ctx.fillRect(Math.round(rng.range(6, w - 6)), Math.round(rng.range(h * 0.4, h - 2)), rng.int(2, 6), 1);
  });
  return shadeSil(mk, w, h, { ramp: ramp('#040306', '#08060c', '#0e0a12', '#150f18', '#1e1520'), base: 0.4, rim: [150, 90, 90], rim2: [90, 56, 70], emit: {} }, 0, false);
}
function makeGull(f) {
  const rows = f ? ['.......', '##...##', '..#.#..', '...#...'] : ['.#...#.', '#.#.#.#', '...#...', '.......'];
  return pixelSprite(7, 4, (x, y) => (rows[y][x] === '#' ? [24, 16, 34] : null));
}
function makeFlare() {
  return [0, 1, 2].map((f) => pixelSprite(7, 12, (x, y) => {
    const cx = 3 + Math.sin(y * 0.8 + f * 2) * (y < 8 ? 1 : 0);
    const d = Math.abs(x - cx) / (1 + (11 - y) * 0.22);
    if (d > 1 || y < f) return null;
    return d < 0.4 && y > 6 ? [255, 240, 170] : y > 5 ? [255, 150, 50] : [255, 90, 40, 200];
  }));
}

let ART = null;
export function getGArt() {
  if (ART) return ART;
  G_LIGHTS.rigs.length = G_LIGHTS.city.length = G_LIGHTS.flares.length = 0;
  ART = {
    sky: makeSky(),
    clouds: makeClouds(31, false),
    cloudsFar: makeClouds(37, false),
    storm: makeClouds(41, true),
    rigs: makeRigs(),
    city: makeCity(),
    mud: makeMud(),
    surface: makeSurface(),
    under: makeUnder(),
    rock: makeFrontRock(130, 30, 71),
    rock2: makeFrontRock(70, 18, 72),
    gull: [makeGull(0), makeGull(1)],
    flare: makeFlare(),
    lights: G_LIGHTS,
    HZ,
  };
  for (const k of Object.keys(G_LIGHTS)) { const seen = new Set(); G_LIGHTS[k] = G_LIGHTS[k].filter((L) => { const key = L.x + "," + L.y; if (seen.has(key)) return false; seen.add(key); return true; }); }
  ART.lights = G_LIGHTS;
  return ART;
}
