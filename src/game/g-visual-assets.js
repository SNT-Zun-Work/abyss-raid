export const visualAssets = { background: null, parts: null, curtain: null, clods: null, water: null, coat: null };
const LOAD_TIMEOUT_MS = 8000;
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
export async function loadVisualAssets() {
  await Promise.all(Object.entries({ background: 'sunset.webp', parts: 'parts.webp', curtain: 'mud-curtain-v2.webp', clods: 'mud-clods-v2.webp', water: 'water-splash-v2.webp', coat: 'mud-coat-v2.webp' }).map(async ([key, file]) => {
    const img = new Image();
    img.src = new URL('../../assets/mudskipper/' + file, import.meta.url).href;
    try { await Promise.race([img.decode(), timeout(LOAD_TIMEOUT_MS)]); visualAssets[key] = img; }
    catch { console.warn('Visual asset unavailable (using procedural art): ' + file); }
  }));
}
