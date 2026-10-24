export const axolotlAssets = { background: null, parts: null };
const LOAD_TIMEOUT_MS = 8000;
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
export async function loadAxolotlAssets() {
  await Promise.all(Object.entries({ background: 'cavern.webp', parts: 'parts.webp' }).map(async ([key, file]) => {
    const image = new Image();
    image.src = new URL('../../assets/axolotl/' + file, import.meta.url).href;
    try { await Promise.race([image.decode(), timeout(LOAD_TIMEOUT_MS)]); axolotlAssets[key] = image; }
    catch { console.warn('Axolotl visual asset unavailable (using procedural art): ' + file); }
  }));
}
