/* Offline whole-character extraction: conservative background flood-fill. */
(function(root){"use strict";
function extract(imageData){
 const {width:w,height:h,data}=imageData;if(w<32||h<32||w*h>180000)throw Error("解析サイズが対象外です");
 const index=(x,y)=>y*w+x;
 const corners=[[1,1],[w-2,1],[1,h-2],[w-2,h-2]].map(([x,y])=>{const i=index(x,y)*4;return [data[i],data[i+1],data[i+2]]});
 const bg=[0,1,2].map(c=>corners.map(v=>v[c]).sort((a,b)=>a-b)[1]);
 const seen=new Uint8Array(w*h),background=new Uint8Array(w*h),stack=[];
 for(let x=0;x<w;x++){stack.push(x,(h-1)*w+x)}
 for(let y=0;y<h;y++){stack.push(y*w,y*w+w-1)}
 while(stack.length){const n=stack.pop();if(seen[n])continue;seen[n]=1;const k=n*4,x=n%w,y=(n/w)|0;
  const d=Math.hypot(data[k]-bg[0],data[k+1]-bg[1],data[k+2]-bg[2]);
  if(data[k+3]>48&&d>40)continue;background[n]=1;
  if(x)stack.push(n-1);if(x<w-1)stack.push(n+1);if(y)stack.push(n-w);if(y<h-1)stack.push(n+w);
 }
 const fg=new Uint8Array(w*h);let count=0;
 for(let n=0;n<w*h;n++){fg[n]=background[n]?0:1;count+=fg[n]}
 const fraction=count/(w*h);
 if(fraction<.07||fraction>.67)throw Error("背景とキャラクターを安全に分離できません");
 const mark=new Uint8Array(w*h);let best=null,components=0;
 for(let n=0;n<w*h;n++){if(!fg[n]||mark[n])continue;const q=[n];mark[n]=1;let cnt=0,minx=w,miny=h,maxx=0,maxy=0,sx=0,sy=0;const pixels=[];
  while(q.length){const j=q.pop(),x=j%w,y=(j/w)|0;pixels.push(j);cnt++;sx+=x;sy+=y;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);
   for(const a of [x?j-1:-1,x<w-1?j+1:-1,y?j-w:-1,y<h-1?j+w:-1])if(a>=0&&fg[a]&&!mark[a]){mark[a]=1;q.push(a)}
  }if(cnt>w*h*.01)components++;if(!best||cnt>best.count)best={count:cnt,pixels,minx,miny,maxx,maxy,cx:sx/cnt,cy:sy/cnt};
 }
 if(!best||best.count/count<.78||best.count/(w*h)<.09||Math.abs(best.cx/w-.5)>.23||best.maxx-best.minx<w*.24||best.maxy-best.miny<h*.25||components>8)throw Error("キャラクターを確実に特定できません");
 const mask=new Uint8Array(w*h);for(const n of best.pixels)mask[n]=255;
 // Suppress small interior holes but do not assume detailed foreground is exact.
 return {width:w,height:h,mask,bounds:{x:best.minx,y:best.miny,w:best.maxx-best.minx+1,h:best.maxy-best.miny+1},fraction:best.count/(w*h)};
}
root.NonoBody={extract};
})(typeof window!=="undefined"?window:globalThis);
