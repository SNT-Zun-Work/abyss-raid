// Autopilot for playtests/captures. Deterministic: depends only on world state
// and a private RNG seeded from world.seed (never consumes world.rng).
//
// Two profiles:
//   'perfect' (?bot=1): sees everything now; proves attacks are survivable (target clear ≥ 90%).
//   'human'   (?bot=2): ~10f reaction delay, shorter look-ahead, occasional misreads,
//                       slower to use safe-zone knowledge and the burst — a stand-in for a
//                       reasonable player after a few tries (target clear ≈ 55–75%).
// Both score 9 candidate moves by predicted danger (bullets, boss body, laser, fish,
// boss.safeHint) plus soft preferences (line up with fish/weak points, grab items).
import { W, H } from '../config.js';
import { makeRng } from '../core/rng.js';
import * as boss from './boss.js';

const DIRS = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) DIRS.push([dx, dy]);

const PROFILES = {
  perfect: { delay: 0, lagComp: 1, horizon: [4, 8, 14, 20], misread: 0, safeDelay: 0, burstChance: 1, laserAim: true },
  human: { delay: 10, lagComp: 0.7, horizon: [4, 8, 12], misread: 0.012, safeDelay: 24, burstChance: 0.5, laserAim: false },
};

// Per-world bot memory (private RNG, misread state, when a safeHint first appeared).
const MEM = new WeakMap();
function mem(world) {
  let m = MEM.get(world.player);
  if (!m) { m = { rng: makeRng((world.seed ^ 0x5bd1e995) >>> 0), wrongT: 0, wrong: [0, 0], hintSince: -1, hintKey: null, burstRoll: -1 }; MEM.set(world.player, m); }
  return m;
}

function laserDanger(L, x, y, prof) {
  if (!L) return 0;
  const live = L.state === 'lock' || L.state === 'fire' || (prof.laserAim && L.state === 'aim');
  if (!live) return 0;
  const dx = Math.cos(L.a), dy = Math.sin(L.a);
  const rx = x - L.x, ry = y - L.y;
  if (rx * dx + ry * dy < 0) return 0;
  const perp = Math.abs(rx * dy - ry * dx);
  const half = (L.w || 10) / 2; // thick beams (giga laser) may expose a width
  const margin = half + (L.state === 'fire' ? 26 : L.state === 'lock' ? 22 : 10);
  return perp < margin ? (margin - perp) * (L.state === 'aim' ? 2 : 40) : 0;
}

const inRects = (rects, x, y) => rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
function distToRects(rects, x, y) {
  let best = 1e9;
  for (const r of rects) {
    const cx = Math.max(r.x, Math.min(x, r.x + r.w)), cy = Math.max(r.y, Math.min(y, r.y + r.h));
    best = Math.min(best, Math.hypot(cx - x, cy - y));
  }
  return best;
}

export function botInput(world, profileName = 'perfect') {
  const prof = PROFILES[profileName] || PROFILES.perfect;
  const p = world.player, b = world.boss;
  const inp = { x: 0, y: 0, shot: true, bomb: false, bombPressed: false, start: world.sceneT === 30 };
  if (!p || !p.alive || p.entering > 0 || p.parked) return inp;
  const m = mem(world);

  // Misread: occasionally commit to a wrong direction for a few frames.
  if (m.wrongT > 0) {
    m.wrongT--;
    inp.x = m.wrong[0]; inp.y = m.wrong[1];
    return inp;
  }
  if (prof.misread && m.rng.next() < prof.misread) {
    m.wrongT = m.rng.int(5, 12);
    m.wrong = DIRS[m.rng.int(0, 8)];
  }

  // Safe-zone knowledge arrives late for the human profile.
  const hint = b && b.safeHint && b.safeHint.rects && b.safeHint.rects.length ? b.safeHint : null;
  const hintKey = hint ? `${hint.cause}` : null;
  if (hintKey !== m.hintKey) { m.hintKey = hintKey; m.hintSince = world.gameFrame; }
  const useHint = hint && world.gameFrame - m.hintSince >= prof.safeDelay;

  // Perceived bullets: positions as they were `delay` frames ago (bullets younger
  // than the delay are not seen yet).
  const D = prof.delay;
  const seen = world.eShots.map((s) => ({ x: s.x - (s.vx || 0) * D, y: s.y - (s.vy || 0) * D, vx: s.vx || 0, vy: s.vy || 0, r: s.hr || s.r || 3, t: s.t }))
    .filter((s) => s.t === undefined || s.t >= D);

  let crowd = 0;
  for (const s of seen) if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < 28 * 28) crowd++;

  let targetY = b && b.active ? (b.aimY ?? b.y) : H / 2;
  const fish = [];
  let gills = [];
  if (b && b.active && typeof boss.targets === 'function') {
    for (const t of boss.targets(world)) {
      if (t.kind === 'escort' || t.kind === 'fish' || t.kind === 'fry') fish.push(t);
      else if (t.kind === 'gill') gills.push(t);
    }
  }
  let nearFish = null, nf = 1e9;
  for (const f of fish) {
    if (f.x < p.x + 10) continue;
    const d = Math.abs(f.y - p.y) + (f.x - p.x) * 0.3;
    if (d < nf) { nf = d; nearFish = f; }
  }
  if (nearFish && nearFish.x < W * 0.8) targetY = nearFish.y;
  else if (b && b.gills && !b.stunned) {
    const dead = b.gills.filter((g) => g.state !== 'alive').length;
    if (dead >= 3 && gills.length) {
      gills.sort((a, c) => Math.abs(a.y - p.y) - Math.abs(c.y - p.y));
      targetY = gills[0].y;
    }
  }

  let best = [0, 0], bestScore = Infinity;
  for (const [dx, dy] of DIRS) {
    const step = dx && dy ? 1.5 : 2;
    let danger = 0;
    for (const t of prof.horizon) {
      const x = Math.min(W - 16, Math.max(12, p.x + dx * step * t));
      const y = Math.min(H - 10, Math.max(12, p.y + dy * step * t));
      const wgt = 1 / t;
      for (const s of seen) {
        // Extrapolate from the STALE position only by t: the human profile believes
        // each bullet is where it was D frames ago (true reaction lag). Codex r6 #1:
        // using (t + D) cancelled the delay entirely; humans do compensate part of their
        // own lag from perceived motion, so lagComp (0..1) restores only that share.
        // Calibration: lagComp 0.7 ≈ 3f effective lag; v0.4 (owner cleared first try) must stay ~100%.
        const k = t + D * prof.lagComp;
        const sx = s.x + s.vx * k, sy = s.y + s.vy * k;
        const rr = s.r + 5;
        const d2 = (sx - x) ** 2 + (sy - y) ** 2;
        if (d2 < rr * rr * 4) danger += wgt * (rr * rr * 4 - d2);
      }
      if (b && b.circles) for (const c of b.circles) {
        const rr = c.r + 10;
        if ((c.x - x) ** 2 + (c.y - y) ** 2 < rr * rr) danger += wgt * 400;
      }
      if (b) danger += wgt * laserDanger(b.laser, x, y, prof) * 10;
      if (b && b.lasers) for (const L of b.lasers) danger += wgt * laserDanger(L, x, y, prof) * 10;
      for (const f of fish) if ((f.x - x) ** 2 + (f.y - y) ** 2 < 16 * 16) danger += wgt * 300;
      if (useHint && !inRects(hint.rects, x, y)) danger += wgt * (40 + distToRects(hint.rects, x, y) * 6);
    }
    const nx = p.x + dx * step * 6, ny = p.y + dy * step * 6;
    let pref = Math.abs(ny - targetY) * 0.6 + Math.abs(nx - 70) * 0.3;
    if (ny < 20 || ny > H - 16) pref += 30;
    let item = null, id2 = 1e9;
    for (const it of world.items || []) {
      const d2 = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
      if (d2 < id2 && it.x > 8) { id2 = d2; item = it; }
    }
    if (item && id2 < 140 * 140) pref = Math.hypot(item.x - nx, item.y - ny) * 0.9;
    const score = danger * 3 + pref;
    if (score < bestScore) { bestScore = score; best = [dx, dy]; }
  }
  inp.x = best[0];
  inp.y = best[1];

  const stock = p.burstStock ?? p.bhStock ?? 0;
  const inBeam = b && ((b.laser && laserDanger(b.laser, p.x, p.y, prof) > 0) || (b.lasers || []).some((L) => laserDanger(L, p.x, p.y, prof) > 0));
  if (stock > 0 && (crowd >= 6 || inBeam)) {
    if (m.burstRoll !== world.gameFrame >> 4) { m.burstRoll = world.gameFrame >> 4; m.burstOk = m.rng.next() < prof.burstChance; }
    if (m.burstOk) inp.bombPressed = true;
  }
  return inp;
}
