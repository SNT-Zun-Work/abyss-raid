import { W, H } from '../config.js';

export const SURFACE_Y = Math.round(H * 0.66);
// first half: anchored on the flat, faces LEFT (f = 1), right third of the screen
export const K_DUEL = 1.2, DUEL_X = 324, DUEL_Y = SURFACE_Y - 32;
// second half: skip chase on the water, faces RIGHT (f = -1); the tail spring points at the player
export const K_CHASE = 1.1, CHASE_X = 322, CHASE_Y = SURFACE_Y - 38;
export const TAIL_Y = CHASE_Y; // the coiled tail sits at this stable height
export const SEGS = 6, SEG_DX = 12; // tail spring segments (local px between segment centres)
export const EYE_POS = [[-52, -40], [-28, -44]];        // near / far eye socket (local)
export const EYE_UP = [10, 22];                        // how far each eye pops up (far one higher: own sightline)
export const SAIL_POS = [[-12, -24, -0.22], [14, -26, -0.08], [40, -20, 0.12]];
export const PLATES = [
  [-94, -10, 11], [-76, -24, 11], [-74, -5, 11], [-55, -27, 10], [-52, -8, 11], [-32, -20, 11],
  [-30, 3, 11], [-10, -16, 11], [-8, 8, 11], [-14, 22, 9], [12, -20, 11], [14, 4, 11],
  [12, 21, 9], [34, -14, 11], [36, 8, 11], [55, -4, 10],
];
export const PLATE_HP = 18, METAL_DMG = 0.3;
export const PLATE_STAGES = [0.75, 0.5, 0.25]; // hp fractions where crack stage 1/2/3 starts

// ---- DIFFICULTY (per phase) ----------------------------------------------------------
// P1 = mudflat duel (eyes, sail, mud wave), P2/P3 = chase (tail segments), P4 = storm final.
//  eyeHp/sailHp/segHp: part HP (hits accumulate), dmgTaken: global damage mult,
//  eyeUp: frames an eye stays up (lit = hittable), eyeShots/eyeIv/eyeN/eyeSpd: its aimed shots,
//  sailTell/sailN: clod fan from the raised sail (−1/3 per broken panel), waveSpd/waveH: mud wave,
//  coilT: tail window before a skip, skipT/skipH: airtime/height (lower per broken segment),
//  volleyN/volleyRakes/volleySpd/volleyGap: straight mud volleys thrown back, sprayN: landing spray.
export const DIFFICULTY = {
  1: { gap: 30, dmgTaken: 1.0, eyeHp: 250, sailHp: 24, eyeUp: 100, eyeShots: 4, eyeIv: 18, eyeN: 3, eyeSpd: 2.0, eyeLead: 0.15, eyeSpread: 0.22,
       eyeRamp: { eyeW: 0.55, timeW: 0.45, timeF: 5400,
         from: { eyeShots: 4, eyeIv: 18, eyeN: 3, eyeSpd: 2.0, eyeLead: 0.15, eyeSpread: 0.22 },
         to: { eyeShots: 8, eyeIv: 11, eyeN: 7, eyeSpd: 3.0, eyeLead: 0.7, eyeSpread: 0.12 } },
       sailTell: 54, sailN: 17, waveSpd: 3.7, waveH: 70, grav: 0.075, fryEvery: [640, 800] },
  2: { gap: 30, dmgTaken: 1.0, segHp: 110, coilT: 84, skipT: 66, skipH: 58,
       wallGap: 34, wallSpd: 2.9, wallDrift: 24, wallKinds: ['gate', 'drift', 'soft', 'drift'], softHp: 7, spitN: 0, spitLead: 0.3, spitFans: 1, spitSpd: 2.5,
       cannonEvery: 4, cannonCharge: 104, cannonFire: 84, cannonHalf: 20, cannonShots: 1,
       sprayN: 7, ringSpd: 2.0, grav: 0.075, fryEvery: [360, 480] },
  3: { gap: 30, dmgTaken: 1.0, segHp: 88, coilT: 80, skipT: 62, skipH: 54,
       wallGap: 35, wallSpd: 2.9, wallDrift: 28, wallKinds: ['drift', 'double', 'soft', 'double'], softHp: 8, spitN: 4, spitLead: 0.3, spitFans: 1, spitStep: 0.22, spitSpd: 2.6,
       cannonEvery: 4, cannonCharge: 98, cannonFire: 90, cannonHalf: 22, cannonShots: 1,
       sprayN: 8, ringSpd: 2.2, grav: 0.08, fryEvery: [360, 480] },
  4: { gap: 26, dmgTaken: 1.0, segHp: 95, coilT: 76, skipT: 80, skipH: 86, slamDx: 125,
       wallGap: 35, wallSpd: 2.9, wallDrift: 28, wallKinds: ['double', 'soft', 'drift'], softHp: 8, spitN: 4, spitLead: 0.3, spitFans: 1, spitStep: 0.2, spitSpd: 2.5,
       cannonEvery: 3, cannonCharge: 96, cannonRe: 62, cannonFire: 76, cannonHalf: 24, cannonShots: 2,
       sprayN: 8, ringSpd: 2.4, grav: 0.08, fryEvery: [420, 540], surgeSpd: 2.3, surgeH: 34 },
};
// lerp a DIFFICULTY ramp ({from,to}) at k (0..1); integer-valued keys round
export function rampParams(rp, k) {
  const o = {};
  for (const key in rp.from) { const v = rp.from[key] + (rp.to[key] - rp.from[key]) * k; o[key] = key === 'eyeShots' || key === 'eyeN' || key === 'eyeIv' ? Math.round(v) : v; }
  return o;
}

export const CAUSES = {
  skBody: { name: 'MUDSKIPPER BODY', hint: 'Do not touch the body: hold back on the left and shoot what lights up' },
  skEye: { name: 'EYE TURRET', hint: 'An eye pops up and glows before it fires: shoot the lit eye, sidestep its aimed shots' },
  skSail: { name: 'SAIL MUD FAN', hint: 'A raised sail means a mud fan: watch the cyan marks (shoot the lit panels to weaken it)' },
  skWave: { name: 'MUD WAVE', hint: 'An arm-fin slap sends a mud wave along the flat: stay above the bright crest' },
  skFry: { name: 'MUDSKIPPER FRY', hint: 'Fry hop out of the chimneys: shoot them or keep clear of their arcs' },
  skSkip: { name: 'SKIP', hint: 'It skips over the water: stay out of the shadow under its arc' },
  skSplash: { name: 'LANDING SPRAY', hint: 'Each landing throws mud backwards: watch the cyan marks' },
  skVolley: { name: 'MUD WALL', hint: 'A mud wall is coming: its preview shows the glowing GATE - be in the gate (or shoot open the glowing SOFT part)' },
  skCannon: { name: 'HYDRO CANNON', hint: 'The tail nozzle aims at you while the stripes are dim; when they flash it is locked: get above or below the band' },
  skSpit: { name: 'MUD SPIT', hint: 'The nozzle spits aimed mud as each wall is thrown: sidestep it on your way into the gate' },
  skSlam: { name: 'BODY SLAM', hint: 'Its giant skip lands on the shadow: keep clear of the shadow on the water' },
  skRing: { name: 'SHOCK RING', hint: 'Each landing sends a ring through the water: rise above the surface or slip outside the ring' },
  skSurge: { name: 'STORM SURGE', hint: 'Its giant landings raise a surge: stay above the bright crest' },
};

export const stats = (world) => world.stats || (world.stats = { fishKills: 0, bestChain: 0, schoolsWiped: 0, stuns: 0 });

// rig transform: translate → flip x (facing; 1 = faces left) → rotate → scale k
export function toWorld(b, lx, ly) {
  const c = Math.cos(b.a), s = Math.sin(b.a), X = lx * b.k, Y = ly * b.k;
  return { x: b.x + b.f * (X * c - Y * s), y: b.y + X * s + Y * c };
}

// safe zones for the bot / HUD (clipped to the playfield)
export function hint(b, atk, cause, text, rects = []) {
  b.safeHint = { cause, atk: atk ? atk.id : 0, text, rects: rects.map((q) => {
    const x = Math.max(0, q.x), y = Math.max(0, q.y), w = Math.min(W, q.x + q.w) - x, h = Math.min(H, q.y + q.h) - y;
    return w > 2 && h > 2 ? { x, y, w, h } : null;
  }).filter(Boolean) };
}
