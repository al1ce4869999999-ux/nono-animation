/* Browser-only inference client. Model work lives in a disposable module worker. */
(function(root){
"use strict";
const MAX_SIDE=1280;
function validateMask(mask,w,h){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||Math.max(w,h)>MAX_SIDE||w*h>MAX_SIDE*MAX_SIDE||mask.length!==w*h)throw Error("マスクの形式が不正です");
 let support=0,solid=0,soft=0,edge=0,minX=w,minY=h,maxX=-1,maxY=-1;
 for(let i=0;i<mask.length;i++){
  const a=mask[i];if(!Number.isFinite(a)||a<0||a>255)throw Error("マスク値が不正です");
  if(a>8){const x=i%w,y=Math.floor(i/w);support++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(x===0||y===0||x===w-1||y===h-1)edge++;}
  if(a>=230)solid++;else if(a>8)soft++;
 }
 const coverage=support/mask.length;
 if(coverage<.03||coverage>.78||solid/mask.length<.015||soft/Math.max(1,support)>.65||edge>Math.max(2,(w+h)*.015))throw Error("前景の範囲・透明度・画像端が不確実です。元画像を保持します");
 const clearance=Math.ceil(Math.max(w,h)*.025);
 if(minX<clearance||minY<clearance||maxX>=w-clearance||maxY>=h-clearance)throw Error("動かすための余白が不足しています。元画像を保持します");
 return {coverage,softFraction:soft/support,bounds:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}};
}
// Repair tiny, fully enclosed matte holes. Do not bridge open gaps between limbs.
function fillSmallMaskHoles(mask,w,h,maxArea=Math.max(4,Math.floor(w*h*.0005))){
 const out=new Uint8Array(mask),seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);
 for(let i=0;i<mask.length;i++){
  if(seen[i]||out[i]>8)continue;
  let head=0,tail=1,touchesEdge=false,neighbors=0,alphaSum=0;
  seen[i]=1;queue[0]=i;
  while(head<tail){
   const p=queue[head++],x=p%w,y=Math.floor(p/w);
   if(x===0||y===0||x===w-1||y===h-1)touchesEdge=true;
   for(const j of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1]){
    if(j<0)continue;
    if(out[j]<=8){if(!seen[j]){seen[j]=1;queue[tail++]=j;}}
    else {neighbors++;alphaSum+=out[j];}
   }
  }
  if(!touchesEdge&&tail<=maxArea&&neighbors){
   const alpha=Math.max(16,Math.round(alphaSum/neighbors));
   for(let j=0;j<tail;j++)out[queue[j]]=alpha;
  }
 }
 return out;
}
function createCanvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function maskCanvas(mask,w,h){
 const c=createCanvas(w,h),ctx=c.getContext("2d"),d=ctx.createImageData(w,h);
 for(let i=0;i<mask.length;i++){d.data[i*4]=d.data[i*4+1]=d.data[i*4+2]=255;d.data[i*4+3]=mask[i];}
 ctx.putImageData(d,0,0);return c;
}
// Multi-source nearest-background propagation followed by diffusion inside the hole.
// All source pixels with alpha > 2 and a safety margin are excluded from donors.
function repairPixels(source,mask,w,h,margin=3){
 if(source.length!==w*h*4||mask.length!==w*h)throw Error("補完データが不正です");
 const n=w*h,hole=new Uint8Array(n),owner=new Int32Array(n).fill(-1),queue=new Int32Array(n);
 for(let i=0;i<n;i++)if(mask[i]>2){
  const x=i%w,y=Math.floor(i/w);
  for(let yy=Math.max(0,y-margin);yy<=Math.min(h-1,y+margin);yy++)for(let xx=Math.max(0,x-margin);xx<=Math.min(w-1,x+margin);xx++)hole[yy*w+xx]=1;
 }
 let head=0,tail=0;
 for(let i=0;i<n;i++)if(!hole[i]){owner[i]=i;queue[tail++]=i;}
 if(!tail)throw Error("背景の補完に使える画素がありません");
 while(head<tail){
  const i=queue[head++],x=i%w;
  for(const j of [x?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<n-w?i+w:-1]){
   if(j>=0&&owner[j]===-1){owner[j]=owner[i];queue[tail++]=j;}
  }
 }
 let out=new Uint8ClampedArray(source);
 for(let i=0;i<n;i++)if(hole[i]){for(let c=0;c<3;c++)out[i*4+c]=source[owner[i]*4+c];out[i*4+3]=255;}
 for(let pass=0;pass<16;pass++){
  const next=new Uint8ClampedArray(out);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
   const i=y*w+x;if(!hole[i])continue;
   for(let c=0;c<3;c++)next[i*4+c]=(out[(i-1)*4+c]+out[(i+1)*4+c]+out[(i-w)*4+c]+out[(i+w)*4+c])/4;
  }
  out=next;
 }
 return {pixels:out,hole};
}
function buildLayers(source,mask,w,h){
 mask=fillSmallMaskHoles(mask,w,h);
 const quality=validateMask(mask,w,h),alpha=maskCanvas(mask,w,h),foreground=createCanvas(w,h),fc=foreground.getContext("2d");
 fc.drawImage(source,0,0,w,h);fc.globalCompositeOperation="destination-in";fc.drawImage(alpha,0,0);fc.globalCompositeOperation="source-over";
 const scale=Math.min(1,256/Math.max(w,h)),sw=Math.max(8,Math.round(w*scale)),sh=Math.max(8,Math.round(h*scale));
 const small=createCanvas(sw,sh),sc=small.getContext("2d",{willReadFrequently:true});sc.drawImage(source,0,0,sw,sh);
 const sm=createCanvas(sw,sh),mc=sm.getContext("2d",{willReadFrequently:true});mc.drawImage(alpha,0,0,sw,sh);
 const m=new Uint8Array(sw*sh);
 // Max pooling retains tiny hair/ear/hand support when reducing the repair mask.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=Math.min(sh-1,Math.floor(y*sh/h))*sw+Math.min(sw-1,Math.floor(x*sw/w));m[i]=Math.max(m[i],mask[y*w+x]);}
 const repair=repairPixels(sc.getImageData(0,0,sw,sh).data,m,sw,sh,3);
 sc.putImageData(new ImageData(repair.pixels,sw,sh),0,0);
 const background=createCanvas(w,h),bc=background.getContext("2d");bc.drawImage(source,0,0,w,h);
 // Replace the entire dilated support opaquely; never blend the original character back in.
 const patch=createCanvas(w,h),pc=patch.getContext("2d");pc.drawImage(small,0,0,w,h);
 const hm=maskCanvas(repair.hole.map(v=>v?255:0),sw,sh),fullHole=createCanvas(w,h),hc=fullHole.getContext("2d");
 hc.imageSmoothingEnabled=false;hc.drawImage(hm,0,0,w,h);
 pc.globalCompositeOperation="destination-in";pc.drawImage(fullHole,0,0);bc.drawImage(patch,0,0);
 const b=quality.bounds;
 return {foreground,background,alpha,quality,pivot:{x:b.x+b.w/2,y:b.y+b.h*.6}};
}
function motionAt(t,speed=1,amplitude=15){
 const strength=Math.min(1,Math.max(0,amplitude/45)),seconds=t*.001*Math.min(3,Math.max(.3,speed));
 // Rest position at t=0; small rigid motion preserves the character's drawing.
 return {x:Math.sin(seconds*1.4)*.006*strength,y:Math.sin(seconds*1.8)*.009*strength,angle:Math.sin(seconds*1.2)*.012*strength};
}
function createClient({workerFactory=()=>new Worker("./ml-worker.js",{type:"module"}),timeout=180000}={}){
 let active=null,serial=0;
 function cancel(){serial++;if(active){active.worker.terminate();clearTimeout(active.timer);active.reject(new Error("処理を中止しました"));active=null;}}
 function extract(source,{onProgress=()=>{}}={}){
  cancel();const id=serial;
  if(Math.max(source.width,source.height)>MAX_SIDE||Math.min(source.width,source.height)<8||Math.max(source.width/source.height,source.height/source.width)>3)return Promise.reject(Error("AI抽出は長辺1280px以下・縦横比3以内の画像に対応しています"));
  return new Promise((resolve,reject)=>{
   let worker;
   try{worker=workerFactory();}catch(e){reject(e);return;}
   const fail=e=>{if(active?.worker!==worker)return;clearTimeout(active.timer);worker.terminate();active=null;reject(e);};
   const timer=setTimeout(()=>fail(Error("モデル処理が時間内に完了しませんでした。通信や端末の空き容量を確認してください")),timeout);
   active={worker,timer,reject};
   worker.onerror=()=>fail(Error("AI処理を起動できません。Safariの更新、通信、空きメモリを確認してください"));
   worker.onmessage=({data})=>{
    if(id!==serial||active?.worker!==worker)return;
    if(data.type==="progress"){onProgress(data);return;}
    if(data.type==="error"){fail(Error(data.message));return;}
    if(data.type==="result"){
     // Release the model's WASM heap before allocating full-resolution layers.
     clearTimeout(timer);worker.terminate();active=null;
     try{
      const mask=new Uint8Array(data.mask);validateMask(mask,data.width,data.height);
      if(data.width!==source.width||data.height!==source.height)throw Error("画像とマスクのサイズが一致しません");
      const result=buildLayers(source,mask,data.width,data.height);
      resolve(result);
     }catch(e){reject(e);}
    }
   };
   try{
    const c=source.getContext("2d",{willReadFrequently:true}),pixels=c.getImageData(0,0,source.width,source.height);
    worker.postMessage({width:source.width,height:source.height,pixels:pixels.data.buffer},[pixels.data.buffer]);
   }catch(e){fail(e);}
  });
 }
 return {extract,cancel};
}
const api={MAX_SIDE,validateMask,fillSmallMaskHoles,repairPixels,buildLayers,maskCanvas,motionAt,createClient};
if(typeof module!=="undefined")module.exports=api;root.NonoML=api;
})(typeof window!=="undefined"?window:globalThis);
