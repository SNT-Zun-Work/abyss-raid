// Read-only raster drawing helpers. Existing simulation owns every position/age.
import { visualAssets as A } from './g-visual-assets.js';
export function paintedCell(ctx, key, frame, x, y, w, h, alpha=1) {
 const img=A[key];if(!img)return false;
 const cols=4, size=key==='water'?128:96;
 ctx.save();ctx.globalAlpha*=alpha;
 ctx.drawImage(img,(frame%cols)*size,Math.floor(frame/cols)*size,size,size,x,y,w,h);
 ctx.restore();return true;
}
export function paintedCurtain(ctx,x,y,index,soft,cap=0,t=0,under=false) {
 ctx.save();
 const edge=7.2+Math.sin(index*2.7)*.8;
 ctx.fillStyle=under?'#49372b':'#523622';ctx.beginPath();ctx.moveTo(x-edge,y-5.5);ctx.lineTo(x+6.8,y-5.5);ctx.lineTo(x+8,y-1);ctx.lineTo(x+6.6,y+5.5);ctx.lineTo(x-7.5,y+5.5);ctx.lineTo(x-edge-1,y+1);ctx.closePath();ctx.fill();
 ctx.fillStyle=under?'#362b25':'#382317';ctx.fillRect(x-3,y-5.5,6,11);
 // Reuse the brown painted flow atlas, tiled downward over an opaque core.
 if(A.curtain){ctx.save();ctx.beginPath();ctx.rect(x-7,y-5.5,14,11);ctx.clip();const off=((t*.65-y)%24+24)%24;for(let k=-1;k<=1;k++)ctx.drawImage(A.curtain,12,0,72,96,x-9,y-16+off+k*24,18,24);ctx.restore();}
 else for(let j=0;j<9;j++){const xx=x-6+j*1.5,yy=y-5+((t*.65+index*2+j*3.7)%8);ctx.fillStyle=j%3?'#89603d':'#c39a65';ctx.fillRect(xx,yy,.7,3);}
 ctx.fillStyle=under?'#705039':'#997049';ctx.beginPath();ctx.ellipse(x+5,y+3,1.7,2.5,.2,0,Math.PI*2);ctx.fill();
 if(soft){ctx.globalAlpha=.65+.25*Math.sin(t*.25);ctx.strokeStyle='#ff9b30';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-5,y-4);ctx.lineTo(x+2,y-1);ctx.lineTo(x-1,y+2);ctx.lineTo(x+5,y+4);ctx.stroke();}ctx.restore();return true;
}
// A large connected crown is reserved for sparse surface anchors, never each droplet.
export function paintedSurface(ctx,x,y,age,width=50) {
 const frame=Math.min(7,Math.floor(age/5));
 if(age<0||age>45)return false;
 return paintedCell(ctx,'water',frame,x-width/2,y-width*.66,width,width*.7,Math.min(1,(45-age)/12)*.78);
}
