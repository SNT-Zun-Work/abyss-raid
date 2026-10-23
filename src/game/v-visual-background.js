// Axolotl-stage presentation layer. Original V update owns every mood and effect.
import { W, H } from '../config.js';
import { M, TW } from './bg-art.js';
import { drawFar, drawNear, gradeMood, rasterAmp } from './bg-mood.js';
import { axolotlAssets } from './v-visual-assets.js';
const mod = (a,n) => ((a % n) + n) % n;
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
export function drawBack(ctx, world) {
  const image=axolotlAssets.background;
  if (!image?.complete || !image.naturalWidth) return false;
  const bg=world.bg, t=bg.t, m=bg.mood;
  ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
  // Overscan keeps the scene seamless throughout the bounded camera drift.
  const dw=W*1.035,dh=H*1.035;
  const dx=(W-dw)/2+Math.sin(t*.0015)*W*.009;
  const dy=(H-dh)/2+Math.sin(t*.0011)*H*.008;
  ctx.drawImage(image,dx,dy,dw,dh);
  // Fine water refraction across the full submerged view; collapse amplifies it.
  const amp=.18*rasterAmp(m);
  for(let y=0;y<H;y+=3){
    const sy=(y-dy)/dh*image.naturalHeight;
    const sh=Math.min(3/dh*image.naturalHeight,image.naturalHeight-sy);
    const wobble=amp*(Math.sin(y*.11+t*.032)+.45*Math.sin(y*.037-t*.02));
    ctx.drawImage(image,0,sy,image.naturalWidth,sh,dx+wobble,y,dw,sh/image.naturalHeight*dh);
  }
  // Original collapse debris and cracks retain their original coordinates and timing.
  ctx.save();ctx.translate(-M,-M);
  drawFar(ctx,m);
  drawNear(ctx,m,mod(Math.floor(bg.scroll*.55),TW),t);
  gradeMood(ctx,m,t);
  ctx.restore();
  if(bg.darken>0){ctx.fillStyle=`rgba(0,3,12,${clamp(bg.darken,0,1)*.7})`;ctx.fillRect(0,0,W,H);}
  const tint=bg.tint;
  if(tint && typeof tint==='object') {
    ctx.fillStyle=`rgba(${tint.r|0},${tint.g|0},${tint.b|0},${clamp(tint.a??.3,0,1)})`;ctx.fillRect(0,0,W,H);
  } else if(tint>0){
    const k=Math.min(1,tint);ctx.globalCompositeOperation='multiply';
    ctx.fillStyle=`rgb(255,${Math.round(255-175*k)},${Math.round(255-185*k)})`;ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';ctx.fillStyle=`rgba(110,0,16,${.32*k})`;ctx.fillRect(0,0,W,H);
  }
  ctx.restore();return true;
}
