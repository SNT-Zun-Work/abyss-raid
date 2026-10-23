// Painted-art assets for ZONE G (Codex visual pass). Loaded before world creation;
// any asset that fails or takes longer than LOAD_TIMEOUT_MS is skipped and the
// procedural art is used instead (Codex r9: never hang on NOW LOADING).
export const visualAssets = { background: null, parts: null };
const LOAD_TIMEOUT_MS = 8000;
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
export async function loadVisualAssets() {
  await Promise.all(Object.entries({ background: 'sunset.webp', parts: 'parts.webp' }).map(async ([key, file]) => {
    const img = new Image();
    img.src = new URL('../../assets/mudskipper/' + file, import.meta.url).href;
    try { await Promise.race([img.decode(), timeout(LOAD_TIMEOUT_MS)]); visualAssets[key] = img; }
    catch { console.warn('Visual asset unavailable (using procedural art): ' + file); }
  }));
}
