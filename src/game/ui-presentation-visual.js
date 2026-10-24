// Presentation-only painted key art. Failure never delays boot beyond eight seconds.
import { makeSprite } from '../core/util.js';
import { titleSilhouette } from './ui-art.js';
export const presentationArt = { V: null, G: null, logo: null };
export async function loadPresentationArt() {
  await Promise.all(Object.keys(presentationArt).map(async z => {
    const img = new Image();
    let timer;
    try {
      img.src = new URL(`../../assets/ui/${z === 'logo' ? 'axarius-logo' : z.toLowerCase() + '-keyart'}.webp`, import.meta.url).href;
      await Promise.race([img.decode(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 8000);
      })]);
      presentationArt[z] = img;
    } catch { console.warn(`Presentation art unavailable: ${z}; using procedural fallback`); }
    finally { clearTimeout(timer); }
  }));
}

const fallback = new Map();
// The fallback G outline deliberately retains turret eyes, walking fins and a dorsal sail.
function fallbackArt(z) {
  if (!fallback.has(z)) fallback.set(z, makeSprite(426, 216, c => {
    const g = c.createLinearGradient(0, 0, 0, 216);
    g.addColorStop(0, z === 'G' ? '#4e283b' : '#082c43');
    g.addColorStop(1, '#020710'); c.fillStyle = g; c.fillRect(0, 0, 426, 216);
    if (z === 'V') { c.drawImage(titleSilhouette(), 24, 24); return; }
    c.fillStyle = '#9d644c'; c.beginPath();
    c.moveTo(73, 106); c.lineTo(151, 66); c.lineTo(172, 27); c.lineTo(265, 47);
    c.lineTo(292, 83); c.lineTo(386, 108); c.lineTo(304, 131);
    c.lineTo(255, 144); c.lineTo(216, 184); c.lineTo(193, 172);
    c.lineTo(198, 141); c.lineTo(116, 143); c.closePath(); c.fill();
    c.fillStyle = '#25313b'; c.fillRect(88, 98, 194, 29);
    for (const x of [113, 150]) { c.fillStyle = '#85939a'; c.fillRect(x, 67, 28, 30); c.fillStyle = '#ff6649'; c.fillRect(x + 5, 73, 15, 10); }
    c.strokeStyle = '#db9e6b';
    for (let x = 180; x < 265; x += 9) { c.beginPath(); c.moveTo(x, 45); c.lineTo(x + 12, 86); c.stroke(); }
  }));
  return fallback.get(z);
}

// Zones without their own key art borrow a sibling's (M = the tidelands mudskipper rebuild → G art).
const KEYART_ALIAS = { M: 'G' };
export function drawKeyArt(c, z, x, y, w, h, t = 0) {
  const k = presentationArt[z] ? z : (KEYART_ALIAS[z] || z);
  const img = presentationArt[k] || fallbackArt(k);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const drift = Math.sin(t / 130) * 2;
  c.drawImage(img, x - 3 + drift, y - 2, w + 6, h + 4);
  c.restore();
}
