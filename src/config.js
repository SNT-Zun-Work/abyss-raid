// Global constants. 16:9 arcade-style screen: a black HUD band on top
// (HUD_H px) and the playfield below it (W x H). Fixed 60Hz step; the canvas
// is upscaled with nearest-neighbour for crisp pixels. All gameplay
// coordinates are playfield pixels (0..W, 0..H); only hud.draw uses screen
// coordinates (0..W, 0..SCREEN_H).

export const W = 426; // 426x240 ≈ 16:9
export const H = 216;
export const HUD_H = 24;
export const SCREEN_H = H + HUD_H;
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
  { id: 'clear', scene: 'clear', frames: 120, expect: { scene: 'clear' } },
];

export const CAPTURE = { width: W * 3, height: SCREEN_H * 3 };
