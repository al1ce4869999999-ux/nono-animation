const test = require("node:test");
const assert = require("node:assert/strict");
const ML = require("../ml-background.js");
function goodMask(w=100,h=100){
 const m=new Uint8Array(w*h);
 for(let y=20;y<80;y++)for(let x=30;x<70;x++)m[y*w+x]=255;
 return m;
}
test("mask geometry is a rejection gate, never a semantic success score",()=>{
 const q=ML.validateMask(goodMask(),100,100);assert.equal(q.coverage,.24);assert.equal(q.confidence,undefined);
});
test("empty, full, soft, malformed, clipped and insufficient-clearance masks reject",()=>{
 for(const m of [new Uint8Array(10000),new Uint8Array(10000).fill(255),new Uint8Array(10000).fill(100),new Uint8Array(3)])assert.throws(()=>ML.validateMask(m,100,100));
 const edge=goodMask();for(let y=20;y<80;y++)for(let x=0;x<40;x++)edge[y*100+x]=255;
 assert.throws(()=>ML.validateMask(edge,100,100));
 const near=goodMask();near[50*100+1]=255;assert.throws(()=>ML.validateMask(near,100,100));
 const invalid=Array.from(goodMask());invalid[0]=NaN;assert.throws(()=>ML.validateMask(invalid,100,100));
});
test("hair, ear and hand soft alpha values are not thresholded out",()=>{
 const m=goodMask();m[19*100+30]=55;m[40*100+29]=120;m[60*100+70]=12;
 const copy=new Uint8Array(m);ML.validateMask(m,100,100);assert.deepEqual(m,copy);
});
test("repair excludes original foreground and its fringe from donors",()=>{
 const w=40,h=40,src=new Uint8ClampedArray(w*h*4),m=new Uint8Array(w*h);
 for(let i=0;i<w*h;i++){src.set([20,50,70,255],i*4);}
 for(let y=10;y<30;y++)for(let x=12;x<28;x++){m[y*w+x]=255;src.set([250,0,0,255],(y*w+x)*4);}
 m[9*w+13]=3;src.set([250,0,0,255],(9*w+13)*4);
 const original=new Uint8ClampedArray(src),r=ML.repairPixels(src,m,w,h);
 for(let i=0;i<w*h;i++)if(r.hole[i])assert.deepEqual(Array.from(r.pixels.slice(i*4,i*4+4)),[20,50,70,255]);
 assert.deepEqual(src,original);
});
test("complex room-like texture stays byte-identical outside repair support",()=>{
 const w=40,h=40,src=new Uint8ClampedArray(w*h*4),m=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)src.set([x*5,y*5,(x+y)%2?20:210,255],(y*w+x)*4);
 for(let y=12;y<28;y++)for(let x=14;x<26;x++)m[y*w+x]=255;
 const r=ML.repairPixels(src,m,w,h);
 for(let i=0;i<m.length;i++)if(!r.hole[i])assert.deepEqual(r.pixels.slice(i*4,i*4+4),src.slice(i*4,i*4+4));
});
test("repair rejects a hole with no background donors",()=>assert.throws(()=>ML.repairPixels(new Uint8ClampedArray(400),new Uint8Array(100).fill(255),10,10)));
test("rigid motion starts at rest, is finite and stays subtle",()=>{
 assert.deepEqual(ML.motionAt(0),{x:0,y:0,angle:0});
 for(let t=0;t<30000;t+=31){const m=ML.motionAt(t,3,45);assert.ok(Math.abs(m.x)<=.006&&Math.abs(m.y)<=.009&&Math.abs(m.angle)<=.012);}
});
function fakeSource(){return {width:100,height:100,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(40000)})})};}
function worker(){return {terminated:false,postMessage(){},terminate(){this.terminated=true;}};}
test("model failure releases worker and retry remains possible",async()=>{
 const workers=[],client=ML.createClient({workerFactory:()=>{const w=worker();workers.push(w);return w;}});
 const first=client.extract(fakeSource());workers[0].onmessage({data:{type:"error",message:"offline"}});await assert.rejects(first,/offline/);assert.ok(workers[0].terminated);
 const next=client.extract(fakeSource());workers[1].onerror();await assert.rejects(next,/AI処理/);assert.ok(workers[1].terminated);
});
test("cancel rejects pending request and ignores stale model output",async()=>{
 const w=worker(),client=ML.createClient({workerFactory:()=>w}),p=client.extract(fakeSource());client.cancel();await assert.rejects(p,/中止/);
 assert.ok(w.terminated);w.onmessage({data:{type:"result",width:100,height:100,mask:goodMask().buffer}});
});
test("timeout terminates an unresponsive model",async()=>{
 const w=worker(),client=ML.createClient({workerFactory:()=>w,timeout:5});
 await assert.rejects(client.extract(fakeSource()),/時間内/);assert.ok(w.terminated);
});
test("synchronous canvas/postMessage failure also releases worker",async()=>{
 const w=worker();w.postMessage=()=>{throw Error("transfer failed");};
 const client=ML.createClient({workerFactory:()=>w});await assert.rejects(client.extract(fakeSource()),/transfer failed/);assert.ok(w.terminated);
});
test("oversized and extreme-aspect inputs never start model downloads",async()=>{
 const client=ML.createClient({workerFactory:()=>{throw Error("must not start");}});
 await assert.rejects(client.extract({width:2000,height:1000}),/1280px/);
 await assert.rejects(client.extract({width:1200,height:100}),/縦横比/);
});
test("model heap is released before layer allocation, including allocation failure",async()=>{
 const w=worker(),client=ML.createClient({workerFactory:()=>w}),previous=globalThis.document;
 globalThis.document={createElement(){assert.ok(w.terminated);throw Error("canvas allocation failed");}};
 try{
  const result=client.extract(fakeSource());
  w.onmessage({data:{type:"result",width:100,height:100,mask:goodMask().buffer}});
  await assert.rejects(result,/canvas allocation failed/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
