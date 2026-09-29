import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
const crcTable = Array.from({length:256}, (_, n) => { let c=n; for(let i=0;i<8;i++) c = c & 1 ? 0xedb88320 ^ (c>>>1) : c>>>1; return c>>>0; });
function chunk(type,data) { const input=Buffer.concat([Buffer.from(type),data]); let crc=0xffffffff; for(const byte of input) crc=crcTable[(crc^byte)&255]^(crc>>>8); const header=Buffer.alloc(4), tail=Buffer.alloc(4); header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,input,tail]); }
function inside(x,y,points) { let on=false; for(let i=0,j=points.length-1;i<points.length;j=i++) { const [xi,yi]=points[i], [xj,yj]=points[j]; if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) on=!on; } return on; }
function png(size, tray=false) {
 const rows=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++) {
   const px=(x+(sx+.5)/2)/size, py=(y+(sy+.5)/2)/size;
   let color=[0,0,0,0];
   if(!tray) { const dx=Math.max(.19-px,0,px-.81),dy=Math.max(.19-py,0,py-.81); if(px>=.035&&px<=.965&&py>=.035&&py<=.965&&Math.hypot(dx,dy)<.155) color=[22,43,56,255]; }
   const outer=tray ? [[.12,.62],[.5,.4],[.88,.62],[.5,.84]] : [[.22,.64],[.5,.48],[.78,.64],[.5,.8]];
   const middle=tray ? [[.12,.46],[.5,.24],[.88,.46],[.5,.68]] : [[.22,.49],[.5,.33],[.78,.49],[.5,.65]];
   const top=tray ? [[.12,.3],[.5,.08],[.88,.3],[.5,.52]] : [[.22,.34],[.5,.18],[.78,.34],[.5,.5]];
   if(inside(px,py,outer))color=tray?[0,0,0,255]:[53,117,100,255];
   if(inside(px,py,middle))color=tray?[0,0,0,255]:[83,168,136,255];
   if(inside(px,py,top))color=tray?[0,0,0,255]:[155,234,198,255];
   if(tray && ((py>.3&&py<.37&&px>.23&&px<.77&&Math.abs(py-(.3+Math.abs(px-.5)*.55))<.022)||(py>.48&&py<.55&&px>.23&&px<.77&&Math.abs(py-(.48+Math.abs(px-.5)*.55))<.022)))color=[0,0,0,0];
   r+=color[0];g+=color[1];b+=color[2];a+=color[3];
  }
  const i=y*(size*4+1)+1+x*4;rows[i]=r/4;rows[i+1]=g/4;rows[i+2]=b/4;rows[i+3]=a/4;
 }
 const head=Buffer.alloc(13);head.writeUInt32BE(size,0);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
fs.mkdirSync('assets/icon.iconset',{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2])fs.writeFileSync(`assets/icon.iconset/icon_${size}x${size}${scale===2?'@2x':''}.png`,png(size*scale));
fs.writeFileSync('assets/tray.png',png(22,true));fs.writeFileSync('assets/tray@2x.png',png(44,true));
fs.writeFileSync('assets/icon.png',png(512));
execFileSync('/usr/bin/iconutil',['-c','icns','assets/icon.iconset','-o','assets/icon.icns']);
