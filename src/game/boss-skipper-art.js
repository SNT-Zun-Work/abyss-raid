import { W, H } from '../config.js';
import { makeSprite } from '../core/util.js';
import { visualAssets } from './g-visual-assets.js';
import { paintedCell } from './g-painted-fx.js';

const DS = 3;
// tiny deterministic LCG for cosmetic texture (never Math.random)
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let ART = null;
export function getSkArt() {
  if (ART) return ART;
  ART = { seg: segSprites(), chimney: chimneySprites(), mudCache: new Map() };
  return ART;
}

// ---- tail segment (local 14 x 26, centred) ---------------------------------------------
function segSprites() {
  const w = 14, h = 26;
  const mk = (kind) => {
    const img = makeSprite(w * DS, h * DS, (c) => {
      c.scale(DS, DS);
      const R = lcg(kind === 'lit' ? 7 : 3);
      const body = (x0, x1) => {
        c.fillStyle = '#16120f'; rr(c, x0, 0, x1 - x0, h, 4); c.fill();
        const g = c.createLinearGradient(0, 1, 0, h - 1);
        g.addColorStop(0, '#d9d2c4'); g.addColorStop(0.3, '#9c9284'); g.addColorStop(0.7, '#5e564c'); g.addColorStop(1, '#2c2621');
        c.fillStyle = g; rr(c, x0 + 1, 1, x1 - x0 - 2, h - 2, 3); c.fill();
      };
      if (kind === 'broken') {
        c.fillStyle = '#16120f';
        c.beginPath(); c.moveTo(0, 4); c.lineTo(7, 2); c.lineTo(10, 7); c.lineTo(6, 12); c.lineTo(11, 17); c.lineTo(7, 22); c.lineTo(0, 22); c.closePath(); c.fill();
        c.fillStyle = '#4a4038'; c.fillRect(1, 5, 5, 16);
        c.fillStyle = '#ff7a2a'; for (const [x, y] of [[7, 3], [9, 8], [6, 12], [10, 17], [7, 21]]) c.fillRect(x - 1, y - 1, 2, 2);
        return;
      }
      body(0, w);
      // Small warm facets and cool scratches tie the spring to the painted hull.
      for (let j = 0; j < 44; j++) {
        const x = 1 + R() * (w - 2), y = 2 + R() * (h - 4);
        c.fillStyle = y < h * .45 ? '#c5b299' : '#493d36';
        c.globalAlpha = .45;
        c.fillRect(Math.round(x * DS) / DS, Math.round(y * DS) / DS, .67 + R(), .33);
      }
      c.globalAlpha = 1;
      // ring grooves + rivets
      c.fillStyle = '#2a241f'; c.fillRect(3, 2, 1, h - 4); c.fillRect(w - 4, 2, 1, h - 4);
      c.fillStyle = '#efe6d4'; for (const y of [5, 13, 21]) { c.fillRect(1, y, 1, 1); c.fillRect(w - 2, y, 1, 1); }
      // rust speckle
      for (let i = 0; i < 18; i++) { c.fillStyle = R() < 0.5 ? '#7a4a2a' : '#5a3a24'; c.fillRect(Math.floor(1 + R() * (w - 2)), Math.floor(1 + R() * (h - 2)), 1, 1); }
      if (kind === 'lit') {
        // the coiled-spring core blazes: bright core + outer rim (same window language as eyes/sails)
        c.fillStyle = '#3a0e04'; c.fillRect(4, 3, w - 8, h - 6);
        c.fillStyle = '#ff5a14'; c.fillRect(5, 4, w - 10, h - 8);
        c.fillStyle = '#ffb040'; c.fillRect(6, 6, w - 12, h - 12);
        c.fillStyle = '#fff4c8'; c.fillRect(6, 9, w - 12, h - 18);
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, 1); c.fillRect(0, h - 1, w, 1);
      } else {
        c.fillStyle = '#ff6a28'; c.fillRect(6, 4, 2, h - 8);
        c.fillStyle = '#5a1a0a'; c.fillRect(6, 8, 2, h - 16);
      }
    });
    return { img, px: w / 2, py: h / 2, w, h };
  };
  return { ok: mk('ok'), lit: mk('lit'), broken: mk('broken') };
}

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

// ---- mud chimney (24 x 22, base centre at bottom) ---------------------------------------
function chimneySprites() {
  const w = 24, h = 22;
  const mk = (broken) => makeSprite(w * DS, h * DS, (c) => {
    c.scale(DS, DS);
    const R = lcg(broken ? 11 : 5);
    c.fillStyle = '#1a120c';
    c.beginPath();
    if (broken) { c.moveTo(0, h); c.lineTo(4, h - 7); c.lineTo(9, h - 5); c.lineTo(13, h - 10); c.lineTo(18, h - 6); c.lineTo(24, h); }
    else { c.moveTo(0, h); c.lineTo(7, 3); c.lineTo(17, 3); c.lineTo(24, h); }
    c.closePath(); c.fill();
    c.save(); c.clip();
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#3a2a1c'); g.addColorStop(0.45, '#7a5e40'); g.addColorStop(1, '#2a1c12');
    c.fillStyle = g; c.fillRect(1, 1, w - 2, h);
    for (let i = 0; i < 40; i++) { c.fillStyle = ['#5a4430', '#8a6c4a', '#2e2016'][Math.floor(R() * 3)]; c.fillRect(Math.floor(R() * w), Math.floor(R() * h), 2, 1); }
    c.restore();
    if (!broken) {
      c.fillStyle = '#0c0806'; c.fillRect(8, 2, 8, 3);
      c.fillStyle = '#a07a52'; c.fillRect(7, 2, 1, 2); c.fillRect(16, 2, 1, 2);
    }
  });
  return { ok: { img: mk(false), w, h }, broken: { img: mk(true), w, h } };
}

// ---- dried-mud overlay for a painted part (lazy, cached per sprite) ----------------------
export function mudVariant(s, seed = 1) {
  const A = getSkArt();
  let v = A.mudCache.get(s);
  if (v) return v;
  const img = s.img, w = img.width, h = img.height;
  v = makeSprite(w, h, (c) => {
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    const R = lcg(seed * 97 + 13);
    // crusty clumps: patches made of many small blobs (dense centre, ragged edge) + dry highlights
    const pal = ['#4e3a26', '#5e472f', '#6c5438', '#3e2e1e', '#7a6040'];
    const n = Math.round((w * h) / 5000);
    for (let i = 0; i < n; i++) {
      const cx = R() * w, cy = R() * h, Rr = 10 + R() * 34, m = Math.round(Rr * Rr / 5);
      for (let k = 0; k < m; k++) {
        const a = R() * Math.PI * 2, d = Rr * Math.sqrt(R()) * (0.6 + 0.4 * R());
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8, r = 2 + R() * 4;
        c.fillStyle = pal[Math.floor(R() * pal.length)];
        c.fillRect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
      }
      c.fillStyle = '#9a805c';
      for (let k = 0; k < m / 10; k++) { const a = R() * Math.PI * 2, d = Rr * Math.sqrt(R()) * 0.8; c.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.8 - 2), 3, 2); }
      c.fillStyle = '#2a1e14';
      for (let k = 0; k < 3; k++) { let x = cx + (R() - 0.5) * Rr, y = cy + (R() - 0.5) * Rr; for (let j = 0; j < 6; j++) { c.fillRect(Math.round(x), Math.round(y), 2, 2); x += (R() - 0.5) * 8; y += (R() - 0.3) * 6; } }
    }
    if(visualAssets.coat){c.globalAlpha=.65;for(let y=0;y<h;y+=192)for(let x=0;x<w;x+=192)c.drawImage(visualAssets.coat,0,0,192,192,x,y,192,192);c.globalAlpha=1;}
  });
  A.mudCache.set(s, v);
  return v;
}

// ---- MUD ARMOR plate (local radius r; stage 0 intact, 1 cracked, 2 crumbling) ------------
const plateCache = new Map();
export function plateSprite(r, stage, seed) {
  const key = r + ':' + stage + ':' + seed;
  let v = plateCache.get(key);
  if (v) return v;
  const w = Math.ceil(r * 2 + 4), h = Math.ceil(r * 1.7 + 4);
  const img = makeSprite(w * DS, h * DS, (c) => {
    c.scale(DS, DS);
    const R = lcg(seed * 31 + 7), cx = w / 2, cy = h / 2, rx = r, ry = r * 0.82;
    // lumpy outline: dark rim, crust body, lighter dry top
    const pts = [];
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, j = 0.82 + R() * 0.22; pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]); }
    const poly = (sc, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], k) => { const X = cx + (x - cx) * sc, Y = cy + (y - cy) * sc; k ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fill(); };
    poly(1, '#1e150d'); poly(0.9, '#4a3624'); poly(0.78, '#5e472f');
    c.save(); c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip();
    for (let k = 0; k < r * 5; k++) { c.fillStyle = ['#6c5438', '#7a6040', '#3e2e1e', '#8a6e4a'][Math.floor(R() * 4)]; c.fillRect(cx + (R() - 0.5) * rx * 1.8, cy + (R() - 0.6) * ry * 1.6, 1, 1); }
    c.fillStyle = '#a08460'; for (let k = 0; k < r; k++) c.fillRect(cx + (R() - 0.5) * rx * 1.2, cy - ry * 0.5 + R() * ry * 0.4, 1, 1);
    // Broken specular strokes on the wet upper crust, shaded runoff below.
    for (let k = 0; k < 5; k++) {
      const x = cx + (R() - .5) * rx, y = cy - ry * .5 + R() * ry * .4;
      c.fillStyle = '#b49b77'; c.fillRect(x, y, 1 + R() * 2, .33);
      c.fillStyle = '#37261d'; c.fillRect(x + 1, y + 2, .33, 1 + R() * 2);
    }
    if(visualAssets.coat){c.globalAlpha=.9;c.drawImage(visualAssets.coat,(stage%2)*192,Math.floor(stage/2)*192,192,192,cx-rx,cy-ry,rx*2,ry*2);c.globalAlpha=1;}
    // cracks per stage (stage 2 also loses chips at the rim, showing metal)
    c.fillStyle = '#140d08';
    for (let n = 0; n < stage * 3; n++) {
      let x = cx + (R() - 0.5) * rx * 0.6, y = cy + (R() - 0.5) * ry * 0.6;
      const a = R() * Math.PI * 2;
      for (let j = 0; j < r * 0.9; j++) { c.fillRect(Math.round(x), Math.round(y), 1, 1); x += Math.cos(a + (R() - 0.5) * 1.2); y += Math.sin(a + (R() - 0.5) * 1.2); }
    }
    if (stage >= 2) {
      c.globalCompositeOperation = 'destination-out';
      for (let n = 0; n < 4; n++) { const a = R() * Math.PI * 2; c.beginPath(); c.arc(cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85, r * 0.3, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  });
  v = { img, w, h };
  plateCache.set(key, v);
  return v;
}

const COAT = { X0: -112, Y0: -48, W: 184, H: 100 };
const coatCache = new WeakMap();
function vnoise(seed) {
  // smooth value noise on a 1-unit lattice (deterministic)
  const hsh = (x, y) => { let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
const MUD_PAL = ['#1c130c', '#2e2016', '#3e2e1e', '#4e3a26', '#5e472f', '#6c5438', '#7a6040', '#8e7450', '#a68a62'];
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const MUD_RGB = MUD_PAL.map(hex);

export function getMudCoat(S, seeds) {
  let v = coatCache.get(S.torso);
  if (v) return v;
  const { X0, Y0, W: CW, H: CH } = COAT, w = CW * DS, h = CH * DS;
  // silhouette = torso + head (the jaw moves, so it keeps its own crossfaded crust)
  const mask = makeSprite(w, h, (c) => {
    const put = (s, x, y) => { const ds = s.detailScale || 1; c.drawImage(s.img, (x - s.px - X0) * DS, (y - s.py - Y0) * DS, (s.img.width / ds) * DS, (s.img.height / ds) * DS); };
    put(S.torso, 0, 0); put(S.head, -34, -4);
  });
  const A = mask.getContext('2d').getImageData(0, 0, w, h).data;
  const n1 = vnoise(11), n2 = vnoise(23), n3 = vnoise(37), n4 = vnoise(51);
  const own = new Int16Array(w * h).fill(-1), edge = new Float32Array(w * h);
  const N = seeds.length;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const o = py * w + px;
    if (A[o * 4 + 3] < 90) continue;
    const lx = X0 + (px + 0.5) / DS, ly = Y0 + (py + 0.5) / DS;
    if (lx < -40 && ly > 3 + (n3(lx / 3, 0) - 0.5) * 3) { A[o * 4 + 3] = 0; continue; } // the toothy upper lip stays bare
    const wx = lx + (n1(lx / 7, ly / 7) - 0.5) * 9 + (n3(lx / 2.5, ly / 2.5) - 0.5) * 2.4;
    const wy = ly + (n2(lx / 7, ly / 7) - 0.5) * 9 + (n4(lx / 2.5, ly / 2.5) - 0.5) * 2.4;
    let d1 = 1e9, d2 = 1e9, k1 = -1;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(wx - seeds[i][0], (wy - seeds[i][1]) * 1.15) - seeds[i][2] * 0.35;
      if (d < d1) { d2 = d1; d1 = d; k1 = i; } else if (d < d2) d2 = d;
    }
    own[o] = k1; edge[o] = d2 - d1;
  }
  const cells = seeds.map(([sx, sy, sr], id) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) if (own[py * w + px] === id) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 2; y1 = 2; }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const R = lcg(id * 131 + 17);
    // base crust (ImageData): coarse + fine noise, top-lit cushion, dark seams between plates
    const base = makeSprite(bw, bh, (c) => {
      const im = c.createImageData(bw, bh), D = im.data;
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
        const px = x0 + xx, py = y0 + yy, o = py * w + px;
        if (own[o] !== id) continue;
        const lx = X0 + px / DS, ly = Y0 + py / DS, e = edge[o];
        const rim = own[o - 1] < 0 || own[o + 1] < 0 || own[o - w] < 0 || own[o + w] < 0;
        let s = 3.6 + (n1(lx / 5 + id, ly / 5) - 0.5) * 3.4 + (n3(lx * 0.9, ly * 0.9) - 0.5) * 2.2;
        s += clampN(-(ly - sy) / (sr * 1.1), -1, 1) * 1.9;                  // cushion: lit top, shaded bottom
        if (n2(lx / 3.2, ly / 3.2) > 0.72) s -= 1.6;                          // damp dark blotches
        if (e < 2.6 && e >= 0.8) s += ly < sy ? 2.2 : -1.8;                  // raised bevel along the seams
        const ridge = n4(lx / 2.8, ly / 5); if (ridge > .63 && ridge < .66) s += 1.5; if (rim) s -= 1.6;
        const hsh = ((px * 73856093) ^ (py * 19349663)) >>> 0;
        if (hsh % 61 === 0) s += 2.2; else if (hsh % 47 === 0) s -= 2;       // pebbles / pits
        let col = MUD_RGB[Math.max(1, Math.min(8, Math.round(s)))];
        if (e < 0.38) col = MUD_RGB[1];                                       // seam gap between plates
        const q = (yy * bw + xx) * 4;
        D[q] = col[0]; D[q + 1] = col[1]; D[q + 2] = col[2]; D[q + 3] = 255;
      }
      c.putImageData(im, 0, 0);
      if(visualAssets.coat){
        c.globalCompositeOperation='source-atop';c.globalAlpha=.97;
        // Body-space repeat prevents every plate looking like a pasted polygon.
        for(let ty=-y0%144;ty<bh;ty+=144)for(let tx=-x0%144;tx<bw;tx+=144)
          c.drawImage(visualAssets.coat,0,0,192,192,tx,ty,144,144);
        c.globalAlpha=1;c.globalCompositeOperation='source-over';
        // Retain the raised edge shading from the exact ownership mask.
        c.globalCompositeOperation='source-atop';
        for(let yy=0;yy<bh;yy++)for(let xx=0;xx<bw;xx++){
          const o=(y0+yy)*w+x0+xx,e=edge[o];if(own[o]!==id||e>1.4)continue;
          c.fillStyle=e<.38?'#261b16':y0+yy<(sy-Y0)*DS?'rgba(220,179,125,.18)':'rgba(26,20,18,.25)';c.fillRect(xx,yy,1,1);
        }
        c.globalCompositeOperation='source-over';
      }
    });
    // crack polylines (shared list; stage s draws the first 2s) + rim chips for stages 2..3
    const cracks = [];
    for (let k = 0; k < 7; k++) {
      const a = R() * Math.PI * 2, L = sr * DS * (0.5 + R() * 0.7);
      let x = (sx - X0) * DS - x0 + (R() - 0.5) * sr * DS * 0.6, y = (sy - Y0) * DS - y0 + (R() - 0.5) * sr * DS * 0.5;
      const pts = [[x, y]];
      for (let j = 0; j < L; j += 2) { const aa = a + (R() - 0.5) * 1.3; x += Math.cos(aa) * 2; y += Math.sin(aa) * 2; pts.push([x, y]); }
      cracks.push(pts);
    }
    const edgePts = [];
    for (let yy = 0; yy < bh; yy += 2) for (let xx = 0; xx < bw; xx += 2) { const o = (y0 + yy) * w + x0 + xx; if (own[o] === id && edge[o] < 3) edgePts.push([xx, yy]); }
    const chips = [];
    for (let k = 0; k < 9 && edgePts.length; k++) { const p = edgePts[Math.floor(R() * edgePts.length)]; chips.push([p[0], p[1], DS * (1.6 + R() * 2.6)]); }
    const st = [0, 1, 2, 3].map((s) => (s === 0 ? base : makeSprite(bw, bh, (c) => {
      c.drawImage(base, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      if(visualAssets.coat){
        c.globalAlpha=.48;
        for(let ty=-y0%144;ty<bh;ty+=144)for(let tx=-x0%144;tx<bw;tx+=144)
          c.drawImage(visualAssets.coat,(s%2)*192,Math.floor(s/2)*192,192,192,tx,ty,144,144);
        c.globalAlpha=1;
      }
      for (let k = 0; k < Math.min(cracks.length, s * 2 + (s === 3 ? 1 : 0)); k++) {
        const pts = cracks[k];
        for (const [x, y] of pts) { c.fillStyle = '#120a06'; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); c.fillStyle = '#9a7e58'; c.fillRect(Math.round(x) - 1, Math.round(y) - 3, 3, 1); }
      }
      if (s >= 2) {
        // chipped rim: the metal shows through (erase), darker damp crust around each chip
        c.globalCompositeOperation = 'source-atop';
        for (let k = 0; k < (s === 2 ? 4 : 9); k++) { const [x, y, r] = chips[k % chips.length] || [0, 0, 0]; c.fillStyle = '#2a1c12'; c.beginPath(); c.arc(x, y, r + 3, 0, Math.PI * 2); c.fill(); }
        c.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < (s === 2 ? 4 : 9); k++) { const [x, y, r] = chips[k % chips.length] || [0, 0, 0]; c.beginPath(); c.arc(x, y, r * (s === 3 ? 1.35 : 1), 0, Math.PI * 2); c.fill(); }
      }
    })));
    const flat = (col) => makeSprite(bw, bh, (c) => { c.drawImage(base, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = col; c.fillRect(0, 0, bw, bh); });
    return { id, x: sx, y: sy, r: sr, lx: X0 + x0 / DS, ly: Y0 + y0 / DS, lw: bw / DS, lh: bh / DS, st, white: flat('#fff2d8'), sheen: flat('#cfefff') };
  });
  v = { cells };
  coatCache.set(S.torso, v);
  return v;
}
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- chase MUD WALL clods (local r 5): hard crust, SOFT (lit, shootable) and gate posts -----------
export function getWallArt() {
  const A = getSkArt();
  if (A.wall) return A.wall;
  const r = 5, d = (r * 2 + 4);
  const clod = (kind, variant = 0) => makeSprite(d * DS, d * DS, (c) => {
    c.scale(DS, DS);
    const R = lcg((kind === 'soft' ? 91 : kind === 'gate' ? 57 : 33) + variant * 137), cx = d / 2, cy = d / 2;
    const pts = [];
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, j = 0.73 + R() * 0.38; pts.push([cx + Math.cos(a) * r * j, cy + Math.sin(a) * r * j]); }
    const poly = (sc, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], k) => { const X = cx + (x - cx) * sc, Y = cy + (y - cy) * sc; k ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fill(); };
    const pal = kind === 'soft' ? ['#2a1408', '#8a5a30', '#b07a44', '#ffd27a'] : ['#140c06', '#4a3422', '#6a4e32', '#ffc070'];
    poly(1.18, pal[0]); poly(1, pal[1]);
    c.save(); c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip();
    c.fillStyle = pal[2]; c.beginPath(); c.ellipse(cx - 1, cy - 1.5, r * 0.7, r * 0.55, 0, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 14; k++) { c.fillStyle = R() < 0.5 ? pal[1] : '#2a1c12'; c.fillRect(cx + (R() - 0.5) * r * 1.8, cy + (R() - 0.5) * r * 1.8, 0.67, 0.67); }
    if (kind === 'soft') {
      // glowing cracks = "lit = breakable"
      c.strokeStyle = '#ffb040'; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(cx - 3, cy - 2); c.lineTo(cx, cy); c.lineTo(cx - 1, cy + 3); c.moveTo(cx, cy); c.lineTo(cx + 3, cy - 1); c.stroke();
      c.fillStyle = '#fff4c8'; c.fillRect(cx - 0.5, cy - 0.5, 1.2, 1.2);
    }
    c.restore();
    // rim light (top-left) so the clods read on the dark sea
    c.fillStyle = pal[3];
    for (let k = 3; k <= 6; k++) { const [x, y] = pts[k]; c.fillRect(x - 0.33, y - 0.33, 1, 0.67); }
    if (kind === 'gate') { c.strokeStyle = '#9ef6ff'; c.lineWidth = 1; c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke(); }
  });
  A.wall = { hard: Array.from({length: 6}, (_, i) => clod('hard', i)), soft: Array.from({length: 6}, (_, i) => clod('soft', i)), gate: Array.from({length: 6}, (_, i) => clod('gate', i)), d };
  return A.wall;
}

// ---- HYDRO CANNON beam texture (tileable along x; v across). half-height hh local ------------
export function getBeamArt(hh) {
  const A = getSkArt();
  A.beams = A.beams || {};
  if (A.beams[hh]) return A.beams[hh];
  const L = 32, h2 = hh * 2;
  const R = lcg(hh * 7 + 3);
  const img = makeSprite(L * DS, h2 * DS, (c) => {
    for (let y = 0; y < h2 * DS; y++) {
      const v = Math.abs((y + 0.5) / (h2 * DS) * 2 - 1);
      const col = v < 0.22 ? '#ffffff' : v < 0.4 ? '#d8fbff' : v < 0.6 ? '#7ad8f0' : v < 0.78 ? '#2e8cb8' : v < 0.9 ? '#6a5236' : '#3a2a1a';
      c.fillStyle = col; c.fillRect(0, y, L * DS, 1);
    }
    // streaks (periodic in x so the strip tiles)
    for (let k = 0; k < 40; k++) {
      const y = Math.floor(R() * h2 * DS), v = Math.abs((y + 0.5) / (h2 * DS) * 2 - 1), x = Math.floor(R() * L * DS), len = 6 + Math.floor(R() * 30);
      c.fillStyle = v < 0.4 ? '#9eeaff' : v < 0.78 ? '#e8ffff' : '#8a6c48';
      for (let i = 0; i < len; i++) c.fillRect((x + i) % (L * DS), y, 1, v > 0.8 ? 2 : 1);
    }
  });
  A.beams[hh] = { img, L, h2 };
  return A.beams[hh];
}

// ---- FINAL FORM exposed reactor core (local r 11) ---------------------------------------------
export function getCoreArt() {
  const A = getSkArt();
  if (A.core) return A.core;
  const r = 11, d = r * 2 + 2;
  const img = makeSprite(d * DS, d * DS, (c) => {
    c.scale(DS, DS);
    const cx = d / 2, cy = d / 2;
    c.fillStyle = '#120a08'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5a4a44'; c.beginPath(); c.arc(cx, cy, r - 1, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a1410'; c.beginPath(); c.arc(cx, cy, r - 3, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(cx, cy, 0.5, cx, cy, r - 3);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#ffe08a'); g.addColorStop(0.65, '#ff6a20'); g.addColorStop(1, '#8a1408');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r - 3.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c8c0b8'; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.fillRect(cx + Math.cos(a) * (r - 2) - 0.5, cy + Math.sin(a) * (r - 2) - 0.5, 1, 1); }
    c.strokeStyle = '#3a0c06'; c.lineWidth = 0.8; for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI + 0.4; c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 3.4), cy + Math.sin(a) * (r - 3.4)); c.lineTo(cx - Math.cos(a) * (r - 3.4), cy - Math.sin(a) * (r - 3.4)); c.stroke(); }
  });
  const glow = makeSprite(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,200,120,0.9)'); g.addColorStop(0.35, 'rgba(255,90,30,0.45)'); g.addColorStop(1, 'rgba(255,40,10,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
  A.core = { img, d, glow };
  return A.core;
}

// lower-right mud mound the boss burrows into / bursts out of (fallback for fx.burrowMound).
// k: 0..1 size; drawn in playfield coords, never above ~60% height or left of x0.
export function drawMound(ctx, x, y, k, t) {
  if (k <= 0.01) return;
  const w = 230 * k, h = 46 * k;
  const R = lcg(77);
  ctx.save();
  for (let i = 0; i < 18; i++) {
    const u = (i / 17) * 2 - 1, bx = x + u * w * 0.5 + (R() - 0.5) * 10, by = y - Math.cos(u * Math.PI * 0.5) * h + (R() - 0.5) * 6;
    const r = (14 + R() * 12) * k;
    ctx.fillStyle = i % 3 === 0 ? '#2e2016' : i % 3 === 1 ? '#4a3624' : '#3a2a1a';
    ctx.beginPath(); ctx.ellipse(Math.round(bx), Math.round(by + r * 0.6), r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(Math.round(x - w * 0.55), Math.round(y - h * 0.3), Math.round(w * 1.1), Math.round(H - y + h * 0.3));
  ctx.fillStyle = '#7a6040';
  for (let i = 0; i < 24; i++) ctx.fillRect(Math.round(x + (R() - 0.5) * w), Math.round(y - h * 0.3 - R() * h * 0.6 + Math.sin(t * 0.2 + i) * 1), 2, 2);
  ctx.restore();
}

// ---- screen-space mud wipe (fallback until fx.mudWipe exists). k: 0..1 coverage ----------
// Blobs fall from the top edge and drip off; deterministic from t only.
export function drawMudWipe(ctx, k, t) {
  if (k <= 0.01) return;
  const R = lcg(4242);
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const x = R() * (W + 40) - 20, r = 28 + R() * 46, sp = 0.4 + R() * 0.6, ph = R();
    const y = -r + (H + 2 * r) * Math.min(1, k * (1.2 + ph * 0.5)) - (1 - k) * 40 + t * sp * 0.3 * (1 - k);
    ctx.fillStyle = i % 3 === 0 ? '#2e2016' : i % 3 === 1 ? '#4a3624' : '#3a2a1a';
    ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    // drips
    ctx.fillRect(Math.round(x - 3), Math.round(y), 6, Math.round(r * (0.6 + R() * 0.8) * k));
  }
  ctx.globalAlpha = Math.min(1, k * 1.4);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(0, 0, W, Math.round(H * Math.max(0, k * 1.3 - 0.3)));
  ctx.restore();
}

let sprayArt;
// Twelve tiny brush stamps, built once at 3x detail.
export function getSprayArt() {
  if (sprayArt) return sprayArt;
  sprayArt = [false, true].map(mud => Array.from({ length: 6 }, (_, i) => makeSprite(24, 24, c => {
    const R = lcg(713 + i * 37);
    c.beginPath();
    for (let k = 0; k < 11; k++) {
      const a = k / 11 * Math.PI * 2, r = 5 + R() * 3;
      const x = 12 + Math.cos(a) * r, y = 12 + Math.sin(a) * r;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath(); c.fillStyle = mud ? '#34251e' : '#3d788e'; c.fill();
    c.save(); c.clip();
    c.fillStyle = mud ? '#79523a' : '#8fc4d3'; c.fillRect(4, 4, 13, 10);
    c.fillStyle = mud ? '#b18a60' : '#e7f3ee'; c.fillRect(7, 5, 6, 2); c.fillRect(5, 7, 2, 2);
    c.fillStyle = mud ? '#4d3527' : '#5a9bb1';
    for (let k = 0; k < 10; k++) c.fillRect(4 + R() * 16, 9 + R() * 11, 2, 2);
    c.restore();
  })));
  return sprayArt;
}
// Read-only ballistic brush stamps; no world RNG or per-frame canvas allocation.
export function drawSpray(ctx, x, y, vx, vy, age, mud, variant = 0) {
  const fadePaint=Math.max(0,1-age/90),idx=Math.abs(Math.round(vx*193));
  if(paintedCell(ctx,mud?'clods':'water',mud?idx%8:8+idx%4,x-(mud?3:4),y-(mud?3:4),mud?6:8,mud?6:8,fadePaint*.8))return;
  const s = getSprayArt()[mud ? 1 : 0][Math.abs(variant | 0) % 6];
  const fade = Math.max(0, 1 - age / 90), size = mud ? 4 : 2.4;
  ctx.globalAlpha = fade * .85;
  ctx.strokeStyle = mud ? '#886346' : '#b3d6df'; ctx.lineWidth = mud ? 1 : .65;
  ctx.beginPath(); ctx.moveTo(x - vx * 1.8, y - vy * 1.8); ctx.lineTo(x - vx * .6, y - vy * .6); ctx.stroke();
  ctx.drawImage(s, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  ctx.globalAlpha = fade * .35; ctx.fillStyle = mud ? '#ad8256' : '#e4e6da';
  ctx.fillRect(Math.round(x - vx * 3 - 1), Math.round(y - vy * 3 + 1), 1, 1);
  ctx.globalAlpha = 1;
}
