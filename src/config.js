// Global constants. 16:9 arcade-style screen: a black HUD band on top
// (HUD_H px) and the playfield below it (W x H). Fixed 60Hz step; the canvas
// is upscaled with nearest-neighbour for crisp pixels. All gameplay
// coordinates are playfield pixels (0..W, 0..H); only hud.draw uses screen
// coordinates (0..W, 0..SCREEN_H).

export const W = 426; // 426x240 ≈ 16:9
export const H = 216;
export const HUD_H = 24;
export const SCREEN_H = H + HUD_H;
// Zones that share the SUNSET TIDELANDS sea stage (background, water surface, music, start kit):
// G = PERIOPHTHALMUS (leaping mudskipper), M = the close-up "standing/prone" mudskipper rebuild.
export const TIDE_ZONES = new Set(['G', 'M']);
export const isTideZone = (world) => !!world && TIDE_ZONES.has(world.zone);
export const FPS = 60;
export const DT = 1 / FPS;

// Deterministic capture scenarios for tools/capture.mjs. Each shot boots with a
// fixed seed, optionally jumps to a scene, advances N frames, then freezes.
// expect: asserted against __game.snapshot() before the screenshot is taken.
export const SHOTS = [
  { id: 'title', scene: 'title', frames: 90, expect: { scene: 'title' } },
  { id: 'warning', scene: 'warning', frames: 100, expect: { scene: 'warning' } },
  { id: 'warning-late', scene: 'warning', frames: 240, expect: { scene: 'warning' } },
  { id: 'boss-entry', scene: 'boss', frames: 60, expect: { scene: 'boss' } },
  { id: 'boss-p1', scene: 'boss', frames: 600, bot: true, expect: { scene: 'boss', phase: 1 } },
  { id: 'boss-p2', scene: 'boss', frames: 400, bot: true, bossHpFrac: 0.6, expect: { scene: 'boss', phase: 2 } },
  { id: 'boss-p3', scene: 'boss', frames: 400, bot: true, bossHpFrac: 0.25, expect: { scene: 'boss', phase: 3 } },
  { id: 'boss-p4', scene: 'boss', frames: 420, bot: true, bossHpFrac: 0.1, expect: { scene: 'boss', phase: 4 } },
  { id: 'boss-death',scene: 'boss', frames: 90, bossHpFrac: 0, bot: true, expect: { defeated: true } },
  { id: 'g-warning', zone: 'G', scene: 'warning', frames: 200, expect: { scene: 'warning' } },
  { id: 'g-boss-entry', zone: 'G', scene: 'boss', frames: 120, expect: { scene: 'boss' } },
  { id: 'g-boss-p1', zone: 'G', scene: 'boss', frames: 600, bot: true, expect: { scene: 'boss' } },
  { id: 'g-boss-late', zone: 'G', scene: 'boss', frames: 400, bot: true, bossHpFrac: 0.2, expect: { scene: 'boss' } },
  { id: 'g-mud-start', zone: 'G', scene: 'boss', frames: 185, expect: { scene: 'boss', phase: 1 } },
  { id: 'g-mud-peel', zone: 'G', scene: 'boss', frames: 1500, bot: true, expect: { scene: 'boss', phase: 1 } },
  { id: 'g-chase-wall', zone: 'G', scene: 'boss', frames: 322, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-chase-wall2', zone: 'G', scene: 'boss', frames: 372, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-ring-tell', zone: 'G', scene: 'boss', frames: 236, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-ring', zone: 'G', scene: 'boss', frames: 288, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-chase-charge', zone: 'G', scene: 'boss', frames: 1050, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-chase-cannon', zone: 'G', scene: 'boss', frames: 1100, bot: true, bossHpFrac: 0.5, expect: { scene: 'boss', phase: 2 } },
  { id: 'g-final-transform', zone: 'G', scene: 'boss', frames: 72, bot: true, bossHpFrac: 0.1, expect: { scene: 'boss', phase: 4 } },
  { id: 'g-final-slam', zone: 'G', scene: 'boss', frames: 300, bot: true, bossHpFrac: 0.1, expect: { scene: 'boss', phase: 4 } },
  { id: 'g-final-giga', zone: 'G', scene: 'boss', frames: 728, bot: true, bossHpFrac: 0.1, expect: { scene: 'boss', phase: 4 } },
  { id: 'm-warning', zone: 'M', scene: 'warning', frames: 240, expect: { scene: 'warning' } },
  { id: 'm-boss-entry', zone: 'M', scene: 'boss', frames: 150, expect: { scene: 'boss' } },
  { id: 'm-boss-p1', zone: 'M', scene: 'boss', frames: 600, bot: true, expect: { scene: 'boss' } },
  { id: 'm-boss-late', zone: 'M', scene: 'boss', frames: 400, bot: true, bossHpFrac: 0.25, expect: { scene: 'boss' } },
  { id: 'clear', scene: 'clear', frames: 120, expect: { scene: 'clear' } },
];

export const CAPTURE = { width: W * 3, height: SCREEN_H * 3 };
