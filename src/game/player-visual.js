// Presentation only: 3x cached sprites drawn in the original logical bounds.
import { makeSprite } from '../core/util.js';
let atlas=null, cached=null;
export async function loadPlayerVisual() {
 const image=new Image();
 image.src=new URL('../../assets/player/player.webp',import.meta.url).href;
 let timer;
 try {
  await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),8000);})]);
  atlas=image;
 } catch { console.warn('Player visual unavailable (using procedural art)'); }
 finally {clearTimeout(timer);}
}
export function playerVisual() {
 if(!atlas)return null;
 if(cached)return cached;
 const cell=(x,y,w,h)=>makeSprite(w,h,c=>c.drawImage(atlas,x,y,w,h,0,0,w,h));
 const ship=[0,1,2,3,4].map(i=>cell(i===4?102:0,i===4?0:i*60,102,60));
 const hit=ship.map(s=>makeSprite(102,60,c=>{c.drawImage(s,0,0);c.globalCompositeOperation='source-atop';c.fillStyle='rgba(222,248,255,.82)';c.fillRect(0,0,102,60);}));
 cached={ship,hit,flame:[0,1,2].map(L=>[0,1,2,3].map(f=>cell(204+f*54,L*27,54,27))),muzzle:[0,1,2].map(f=>cell(204+f*30,90,30,30))};
 return cached;
}
export function drawPlayerVisual(ctx,world) {
 const a=playerVisual();if(!a)return false;
 const p=world.player,x=Math.round(p.x),y=Math.round(p.y);
 const L=p.entering>0?2:world.inputLocked?1:world.input.x>0?2:world.input.x<0?0:1;
 ctx.save();ctx.imageSmoothingEnabled=true;
 ctx.globalCompositeOperation='lighter';ctx.drawImage(a.flame[L][(world.frame>>1)&3],x-31,y-4,18,9);
 ctx.globalCompositeOperation='source-over';
 const bi=Math.max(0,Math.min(4,Math.round(p.bank)+2));
 ctx.drawImage((p.shieldFlash>0?a.hit:a.ship)[bi],x-17,y-10,34,20);
 if(p.muzzle>0){ctx.globalCompositeOperation='lighter';ctx.drawImage(a.muzzle[Math.max(0,3-p.muzzle)],x+11,y-5,10,10);}
 ctx.restore();return true;
}
