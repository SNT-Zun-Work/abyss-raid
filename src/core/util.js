export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const dist2 = (ax, ay, bx, by) => (bx - ax) ** 2 + (by - ay) ** 2;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// Pre-render a sprite once into an offscreen canvas. drawFn(ctx, w, h).
export function makeSprite(w, h, drawFn) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  drawFn(ctx, w, h);
  return c;
}

// Remove an element from an array in O(1) (order not preserved).
export function swapRemove(arr, i) {
  arr[i] = arr[arr.length - 1];
  arr.pop();
}
