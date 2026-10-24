import * as touch from '../core/touch.js';

const FORCE = typeof location !== 'undefined' && /[?&]touchui=1\b/.test(location.search);

export function isTouchUI() {
  if (FORCE) return true;
  try { return typeof touch.touchActive === 'function' && !!touch.touchActive(); } catch (e) { return false; }
}

export const startPrompt = () => (isTouchUI() ? 'TAP TO START' : 'PUSH START');
