// Boss facade: every module keeps importing './boss.js' and calling the same API;
// calls are dispatched to the boss of the current zone (world.zone).
//   ZONE V — AMBYSTOMA ROSEA (axolotl)      → boss-axolotl.js
//   ZONE G — PERIOPHTHALMUS (mudskipper)    → boss-mudskipper.js
// A boss implementation exports: init, update, draw, hitTest, applyDamage, bodyHit,
// targets?, debugSetHpFrac, CAUSES, ZONE_INFO {letter, name, title, subtitle}.
// Axolotl-only extras (gills) are forwarded when the current boss provides them.
import * as axolotl from './boss-axolotl.js';
import * as mudskipper from './boss-mudskipper.js';
import * as mudflat from './boss-mudflat.js';
import * as skipper from './boss-skipper.js';

export const BOSSES = { V: axolotl, G: skipper, G0: mudskipper, M: mudflat };
export const ZONE_ORDER = ['V', 'G'];

const cur = (world) => BOSSES[world && world.zone] || axolotl;
export const current = cur;

export const init = (world) => cur(world).init(world);
export const update = (world) => cur(world).update(world);
export const draw = (ctx, world) => cur(world).draw(ctx, world);
export const hitTest = (world, x, y, r) => cur(world).hitTest(world, x, y, r);
export const applyDamage = (world, hit, dmg) => cur(world).applyDamage(world, hit, dmg);
export const bodyHit = (world, x, y, r) => cur(world).bodyHit(world, x, y, r);
export const targets = (world) => (typeof cur(world).targets === 'function' ? cur(world).targets(world) : []);
export const debugSetHpFrac = (world, f) => cur(world).debugSetHpFrac(world, f);
export const zoneInfo = (world) => cur(world).ZONE_INFO || { letter: world.zone || 'V' };

// Cause table for death feedback: union of all bosses (ids are namespaced by each boss).
export const CAUSES = { ...(axolotl.CAUSES || {}), ...(mudskipper.CAUSES || {}), ...(mudflat.CAUSES || {}), ...(skipper.CAUSES || {}) };

// Axolotl gill HUD compat (ui-events.js): only meaningful while the axolotl is the boss.
export const GILL_REGROW = axolotl.GILL_REGROW;
export function gillRegrowLeft(world, i) {
  const b = cur(world);
  return typeof b.gillRegrowLeft === 'function' ? b.gillRegrowLeft(world, i) : 0;
}
