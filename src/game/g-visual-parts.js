// Visual-only adapter: original pivots and logical bounds remain authoritative.
// Gameplay, transforms, sprite ordering and every non-boss sprite are untouched.
import { makeSprite } from '../core/util.js';
import { visualAssets } from './g-visual-assets.js';

const SCALE = 3;
const entries = new WeakMap();
let atlasImage, atlasCells;

function alphaBounds(canvas, rect) {
 const c=canvas.getContext('2d'), [x,y,w,h]=rect;
 const data=c.getImageData(x,y,w,h).data;
 let left=w,top=h,right=-1,bottom=-1;
 for(let py=0;py<h;py++)for(let px=0;px<w;px++)if(data[(py*w+px)*4+3]>12){left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}
 return right<left?rect:[x+left,y+top,right-left+1,bottom-top+1];
}

function cellsFor(img) {
 if(atlasImage===img)return atlasCells;
 const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
 const canvas=makeSprite(w,h,c=>c.drawImage(img,0,0));
 // Painted atlas uses deliberately unequal slots. Normalize from its 1280px
 // design coordinates so later export resolutions retain the same crops.
 const regions=[[0,0,500,410],[500,0,390,410],[890,0,390,410],
  [0,410,450,410],[450,410,415,410],[870,410,410,410],
  [0,820,405,460],[410,820,480,460],[900,820,380,460]];
 atlasCells=regions.map(([x,y,rw,rh])=>{
  const left=Math.floor(x*w/1280),top=Math.floor(y*h/1280);
  const right=Math.min(w,Math.ceil((x+rw)*w/1280)),bottom=Math.min(h,Math.ceil((y+rh)*h/1280));
  return alphaBounds(canvas,[left,top,right-left,bottom-top]);
 });atlasImage=img;return atlasCells;
}

function variant(img,kind){
 return makeSprite(img.width,img.height,c=>{
  c.drawImage(img,0,0);
  c.globalCompositeOperation='source-atop';
  if(kind==='white'){c.fillStyle='#fff';c.fillRect(0,0,img.width,img.height);}
  else if(kind==='dark'){c.fillStyle='#040816';c.fillRect(0,0,img.width,img.height);}
  else if(kind==='far'){c.fillStyle='rgba(3,12,27,.43)';c.fillRect(0,0,img.width,img.height);}
  else if(kind==='dead'){c.fillStyle='rgba(4,13,23,.78)';c.fillRect(0,0,img.width,img.height);}
  else {c.fillStyle='rgba(207,36,22,.27)';c.fillRect(0,0,img.width,img.height);}
 });
}

function enhancePart(s,atlas,cell,{dead=false,maw=false}={}){
 const w=s.img.width*SCALE,h=s.img.height*SCALE;
 const mask=makeSprite(w,h,c=>{c.imageSmoothingEnabled=false;c.drawImage(s.img,0,0,w,h);});
 const bbox=alphaBounds(mask,[0,0,w,h]);
 const img=makeSprite(w,h,c=>{
  if(!maw){c.drawImage(atlas,...cell,...bbox);return;}
  // This cavity sits behind the independently moving jaws. Retain its authored
  // coverage, but replace all old teeth/material with dark mechanical depth.
  const [x,y,bw,bh]=bbox;
  const g=c.createRadialGradient(x+bw*.52,y+bh*.55,1,x+bw*.5,y+bh*.5,Math.max(bw,bh)*.6);
  g.addColorStop(0,'#c64b17');g.addColorStop(.2,'#64200d');g.addColorStop(.58,'#210c0b');g.addColorStop(1,'#03070e');
  c.fillStyle=g;c.fillRect(x,y,bw,bh);
  c.strokeStyle='#75371c';c.lineWidth=2;
  for(let i=0;i<8;i++){const xx=x+bw*(i+1)/9;c.beginPath();c.moveTo(xx,y+bh*.16);c.lineTo(xx-3,y+bh*.84);c.stroke();}
  c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0);
 });
 const base=dead?variant(img,'dead'):img;
 const out={...s,img:base,detailScale:SCALE};
 out.white=variant(base,'white');out.dark=variant(base,'dark');
 if(s.red)out.red=variant(base,'red');
 if(s.farImg)out.farImg=variant(base,'far');
 if(s.farRed)out.farRed=variant(out.red||base,'far');
 // Every image field must use the same detail scale, including optional rims.
 if(s.edge)out.edge=makeSprite(w,h,c=>{
  const a=base.getContext('2d').getImageData(0,0,w,h).data,im=c.createImageData(w,h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
   const o=(y*w+x)*4;if(a[o+3])continue;
   if(a[o-4+3]||a[o+4+3]||a[o-w*4+3]||a[o+w*4+3])im.data.set([255,200,160,255],o);
  }c.putImageData(im,0,0);
 });
 return out;
}

/** Returns a cached merged sprite dictionary; never mutates the original set.
 * Main parts use 3x canvases; draw with image dimensions / detailScale while
 * retaining px/py as logical coordinates. Missing/unloaded atlas returns S.
 */
export function enhanceMudSprites(S){
 const atlas=visualAssets.parts;
 if(!atlas || !(atlas.naturalWidth||atlas.width) || atlas.complete===false)return S;
 const prior=entries.get(S);if(prior?.atlas===atlas)return prior.result;
 const cells=cellsFor(atlas),result={...S};
 const slots={torso:0,head:1,jaw:2,maw:2,eye:8,eyeDead:8,upper:6,lower:7,tailA:4,tailB:5};
 for(const [key,index] of Object.entries(slots))if(S[key])result[key]=enhancePart(S[key],atlas,cells[index],{dead:key==='eyeDead',maw:key==='maw'});
 if(S.sails)result.sails=S.sails.map(s=>enhancePart(s,atlas,cells[3]));
 entries.set(S,{atlas,result});return result;
}
