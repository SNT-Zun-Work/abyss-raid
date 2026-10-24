// Anonymous play statistics (GoatCounter custom events). The GoatCounter script is injected only
// into the published build (tools/publish.mjs); in dev, previews, headless tools and bot runs
// window.goatcounter does not exist or is skipped, so every call here is a no-op.
// No cookies, no personal data: events are plain paths such as "ev/clear/V".

const skip = (() => {
  try {
    const q = new URLSearchParams(location.search);
    return q.has('bot') || q.has('headless');
  } catch (e) { return true; }
})();
const sent = new Map();

export function track(path, title) {
  if (skip) return;
  try {
    const gc = window.goatcounter;
    if (!gc || typeof gc.count !== 'function') return;
    // de-duplicate bursts of the same event within 2 s (e.g. several hits in one frame)
    const now = Date.now();
    if (now - (sent.get(path) || 0) < 2000) return;
    sent.set(path, now);
    gc.count({ path: 'ev/' + path, title: title || path, event: true });
  } catch (e) { /* never break the game */ }
}

// 100k-point buckets, e.g. "300k-400k"
export function scoreBucket(score) {
  const k = Math.floor((Number(score) || 0) / 100000) * 100;
  return `${k}k-${k + 100}k`;
}
