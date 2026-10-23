// Optional presentation-only replacement for the ZONE G back layer.
// bg-g.js retains ownership of init/update, weather, water level and gameplay.
import { W, H } from '../config.js';
import { visualAssets } from './g-visual-assets.js';
export const SURFACE_Y = 143;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function drawBack(ctx, world) {
  const image = visualAssets.background;
  if (!image?.complete || !image.naturalWidth) return false;
  const bg = world.bg, m = bg.mood, t = bg.t;
  const sy = bg.surfaceY ?? SURFACE_Y, dy = sy - SURFACE_Y;
  ctx.save();
  // Keep the painted horizon registered with the original water-level animation.
  ctx.fillStyle = '#102439'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(image, 0, dy, W, H);
  if (dy > 0) ctx.drawImage(image, 0, 0, image.naturalWidth, 1, 0, 0, W, dy);
  if (dy < 0) ctx.drawImage(image, 0, image.naturalHeight - 1, image.naturalWidth, 1, 0, H + dy, W, -dy);
  // The sea alone refracts. Source samples follow the same horizon displacement.
  ctx.save();ctx.beginPath();ctx.rect(0, clamp(sy + 2, 0, H), W, H);ctx.clip();
  const amp = .3 + m.storm * .35 + m.blood * .5;
  for (let y = Math.max(0, Math.ceil(sy + 2)); y < H; y += 2) {
    const sourceY = clamp((y - dy) / H * image.naturalHeight, 0, image.naturalHeight - 1);
    const sourceH = Math.min(2 / H * image.naturalHeight, image.naturalHeight - sourceY);
    const dx = amp * (Math.sin(y * .18 + t * .035) + .4 * Math.sin(y * .073 - t * .02));
    ctx.drawImage(image, 0, sourceY, image.naturalWidth, sourceH, dx - .6, y, W + 1.2, sourceH / image.naturalHeight * H);
  }
  ctx.restore();
  if (m.storm > .01) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 - 110 * m.storm)},${Math.round(255 - 100 * m.storm)},${Math.round(255 - 70 * m.storm)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (m.blood > .01) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(255,${Math.round(255 - 195 * m.blood)},${Math.round(255 - 200 * m.blood)})`;ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';ctx.fillStyle = `rgba(150,10,0,${.3 * m.blood})`;ctx.fillRect(0, 0, W, clamp(sy,0,H));
  }
  if (m.flashSky > .05) {
    ctx.globalCompositeOperation = 'lighter';ctx.fillStyle = `rgba(200,170,255,${.45 * m.flashSky})`;ctx.fillRect(0, 0, W, clamp(sy,0,H));
    if (m.bolt) {
      const bolt = m.bolt, alpha = clamp(1 - bolt.t / 11, 0, 1);
      for (const [width, color] of [[3, `rgba(170,120,255,${.35*alpha})`], [1, `rgba(255,245,255,${alpha})`]]) {
        ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
        bolt.pts.forEach(([x,y],i)=>i?ctx.lineTo(x+.5,y+.5):ctx.moveTo(x+.5,y+.5));
        if (bolt.branch) {const [x,y]=bolt.pts[bolt.branch.from];ctx.moveTo(x+.5,y+.5);ctx.lineTo(x+bolt.branch.dx,y+bolt.branch.dy);}
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (bg.darken > 0) {ctx.fillStyle=`rgba(0,0,10,${clamp(bg.darken,0,1)*.7})`;ctx.fillRect(0,0,W,H);}
  const tint=bg.tint;
  if(tint && typeof tint==='object') {ctx.fillStyle=`rgba(${tint.r|0},${tint.g|0},${tint.b|0},${clamp(tint.a??.3,0,1)})`;ctx.fillRect(0,0,W,H);}
  else if(tint>0) {ctx.fillStyle=`rgba(160,0,20,${.35*Math.min(1,tint)})`;ctx.fillRect(0,0,W,H);}
  ctx.restore();
  return true;
}
