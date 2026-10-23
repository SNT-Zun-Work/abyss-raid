// Axolotl visual adapter. Pivots, logical bounds, armor offsets and articulation
// belong to the original sprites; this module only replaces cached images.
import { makeSprite } from '../core/util.js';
import { axolotlAssets } from './v-visual-assets.js';

const SCALE=3,cache=new WeakMap();
let lastAtlas,lastCells;
function bounds(canvas,rect){
 const [x,y,w,h]=rect,d=canvas.getContext('2d').getImageData(x,y,w,h).data;
 let l=w,t=h,r=-1,b=-1;
 for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(d[(yy*w+xx)*4+3]>12){l=Math.min(l,xx);t=Math.min(t,yy);r=Math.max(r,xx);b=Math.max(b,yy);}
 return r<l?rect:[x+l,y+t,r-l+1,b-t+1];
}
function cells(img){
 if(img===lastAtlas)return lastCells;
 const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,c=makeSprite(w,h,ctx=>ctx.drawImage(img,0,0));
 // Optional normalized rectangles can follow irregular hand-painted layouts.
 const regions=axolotlAssets.regions||[
  [0,0,490,365],[490,0,405,365],[895,0,385,365],
  [0,365,465,465],[465,365,340,450],[805,365,475,450],
  [0,815,420,465],[420,815,470,465],[890,815,390,465],
 ].map(r=>r.map(n=>n/1280));
 lastCells=regions.map(([x,y,rw,rh])=>{const l=Math.floor(x*w),t=Math.floor(y*h),r=Math.min(w,Math.ceil((x+rw)*w)),b=Math.min(h,Math.ceil((y+rh)*h));return bounds(c,[l,t,r-l,b-t]);});
 lastAtlas=img;return lastCells;
}
function tint(base,kind){return makeSprite(base.width,base.height,c=>{
 c.drawImage(base,0,0);c.globalCompositeOperation='source-atop';
 c.fillStyle={white:'#fff',dark:'#040816',red:'rgba(235,38,35,.31)',far:'rgba(4,14,30,.43)',flame:'rgba(255,132,23,.56)'}[kind];c.fillRect(0,0,base.width,base.height);
});}
function edge(base){return makeSprite(base.width,base.height,c=>{
 const w=base.width,h=base.height,d=base.getContext('2d').getImageData(0,0,w,h).data,im=c.createImageData(w,h);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const o=(y*w+x)*4;if(d[o+3])continue;if(d[o-1]||d[o+7]||d[o-w*4+3]||d[o+w*4+3])im.data.set([255,204,188,255],o);}
 c.putImageData(im,0,0);
});}
function replace(s,atlas,cell,mode){
 const w=s.img.width*SCALE,h=s.img.height*SCALE;
 const old=makeSprite(w,h,c=>{c.imageSmoothingEnabled=false;c.drawImage(s.img,0,0,w,h);}),box=bounds(old,[0,0,w,h]);
 const img=makeSprite(w,h,c=>{
  const [x,y,bw,bh]=box;
  if(!mode||mode==='armor'){
   c.drawImage(atlas,...cell,...box);
   // Breakable armor must retain authored coverage. Only alpha is reused;
   // none of its low-resolution colors can bleed around the detailed panel.
   if(mode==='armor'){c.globalCompositeOperation='destination-in';c.drawImage(old,0,0);}
   return;
  }
  const cx=x+bw/2,cy=y+bh/2;
  if(mode==='maw'){
   const g=c.createRadialGradient(cx,cy,1,cx,cy,Math.max(bw,bh)*.6);g.addColorStop(0,'#ab391f');g.addColorStop(.35,'#3c1318');g.addColorStop(1,'#050811');c.fillStyle=g;c.fillRect(x,y,bw,bh);c.globalCompositeOperation='destination-in';c.drawImage(old,0,0);return;
  }
  c.translate(cx,cy);c.scale(bw/2,bh/2);
  const g=c.createRadialGradient(-.25,-.3,.01,0,0,1);g.addColorStop(0,'#e4d9c0');g.addColorStop(.34,'#73828b');g.addColorStop(.55,'#253342');g.addColorStop(.73,'#8b9697');g.addColorStop(1,'#050b16');c.fillStyle=g;c.beginPath();c.arc(0,0,1,0,Math.PI*2);c.fill();
  const lens=c.createRadialGradient(-.15,-.18,.01,0,0,.64);lens.addColorStop(0,'#fff3ce');lens.addColorStop(.22,'#ffc358');lens.addColorStop(.5,'#ed522d');lens.addColorStop(1,'#551827');c.fillStyle=lens;c.beginPath();c.arc(0,0,.61,0,Math.PI*2);c.fill();
  if(mode==='eye'){c.fillStyle='#160d16';c.beginPath();c.ellipse(.08,0,.13,.49,0,0,Math.PI*2);c.fill();}
 });
 const out={...s,img,detailScale:SCALE,white:tint(img,'white'),dark:tint(img,'dark')};
 if(s.red)out.red=tint(img,'red');if(s.farImg)out.farImg=tint(img,'far');if(s.farRed)out.farRed=tint(out.red||img,'far');
 if(s.flame)out.flame=tint(img,'flame');if(s.farFlame)out.farFlame=tint(out.flame||img,'far');if(s.edge)out.edge=edge(img);
 return out;
}

export function enhanceAxolotlSprites(S){
 const atlas=axolotlAssets.parts;if(!atlas||!(atlas.naturalWidth||atlas.width)||atlas.complete===false)return S;
 const prior=cache.get(S);if(prior?.atlas===atlas)return prior.result;
 const a=cells(atlas),result={...S};
 const mapping={torso:0,head:1,jaw:2,gillA:3,gillB:4,upper:6,lower:7,stump:4};
 for(const [key,n] of Object.entries(mapping))if(S[key])result[key]=replace(S[key],atlas,a[n]);
 // Dorsal blades retain their slender fin silhouette instead of inheriting a
 // rectangular armor panel. Tail plating provides curved metallic rib texture.
 for(const key of ['blade','bladeS'])if(S[key])result[key]=replace(S[key],atlas,a[5],'armor');
 for(const key of ['eye','core','maw'])if(S[key])result[key]=replace(S[key],atlas,a[2],key);
 if(S.tail)result.tail=S.tail.map(s=>replace(s,atlas,a[5]));
 if(S.armor)result.armor=Object.fromEntries(Object.entries(S.armor).map(([key,s])=>{
  let uv=a[8];
  // Matching facial textures preserve sculpted brow and jaw lighting when the
  // removable shells are intact, while their alpha still exposes breakaway gaps.
  if(key==='helmet')uv=a[1];
  else if(key==='chin')uv=a[2];
  else if(key.startsWith('band')){
   const n=Number(key.slice(4))||0,[x,y,w,h]=a[8];
   uv=[x+w*(n%3)*.065,y+h*(n%2)*.035,w*(.86-(n%2)*.04),h*.94];
  }
  return [key,replace(s,atlas,uv,'armor')];
 }));
 cache.set(S,{atlas,result});return result;
}
