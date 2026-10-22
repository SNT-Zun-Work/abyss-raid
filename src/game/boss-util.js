// Shared helpers for the boss modules. Owned by the boss agent.
import * as fx from './fx.js';
import * as audio from './audio.js';

// compose a child transform: local (lx, ly) offset + local rotation la
export function child(p, lx, ly, la = 0) {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c, a: p.a + la };
}
export const sfx = (n) => { try { if (typeof audio.sfx === 'function') audio.sfx(n); } catch (e) { /* headless */ } };
export const fxCall = (fn, ...a) => (typeof fx[fn] === 'function' ? fx[fn](...a) : undefined);
// angle from (x, y) toward the player (or screen-left centre if dead)
export function aimAt(world, x, y) {
  const p = world.player;
  const tx = p && p.alive ? p.x : 40, ty = p && p.alive ? p.y : 108;
  return Math.atan2(ty - y, tx - x);
}
// aim with partial target leading: lead 0 = at the ship, 1 = full intercept of its
// current velocity (world.boss.pv is the ship velocity tracked by the boss)
export function aimLead(world, x, y, spd, lead) {
  const p = world.player, b = world.boss;
  if (!lead || !p || !p.alive || !b || !b.pv) return aimAt(world, x, y);
  const d = Math.hypot(p.x - x, p.y - y), tt = d / Math.max(0.5, spd);
  return Math.atan2(p.y + b.pv.y * tt * lead - y, p.x + b.pv.x * tt * lead - x);
}

// Unified damage to the player: player.hurt(world, source) when the player
// module provides it (shield applies to everything), else legacy behaviour.
import * as player from './player.js';
export function hurtPlayer(world, source) {
  if (typeof player.hurt === 'function') { player.hurt(world, source); return; }
  const contact = typeof source === 'object';
  if (!contact && typeof player.absorbHit === 'function' && player.absorbHit(world)) return;
  player.killPlayer(world);
}

// hull/fin coloured debris for fx.explode over the boss (avoids grey specks)
export const HULL_DEBRIS = ['#d8dde6', '#b9c0cc', '#e07090'];
