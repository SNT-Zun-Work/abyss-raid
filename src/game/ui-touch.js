// Touch-UI switch for presentation text (title controls panel, start prompts, HUD layout
// that keeps clear of the DOM BURST/FULL buttons). Uses the lead's touchActive(); the
// ?touchui=1 URL flag forces it for scratch captures only (read here, nowhere else).
import * as touch from '../core/touch.js';

const FORCE = typeof location !== 'undefined' && /[?&]touchui=1\b/.test(location.search);

export function isTouchUI() {
  if (FORCE) return true;
  try { return typeof touch.touchActive === 'function' && !!touch.touchActive(); } catch (e) { return false; }
}

export const startPrompt = () => (isTouchUI() ? 'TAP TO START' : 'PUSH START');
