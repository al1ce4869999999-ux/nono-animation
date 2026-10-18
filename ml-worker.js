// A worker can be terminated on cancellation, timeout, failure, and after each extraction.
self.onmessage=async({data})=>{
 let segmenter;
 try{
  self.postMessage({type:"progress",stage:"ライブラリを読み込み中"});
  const {pipeline,env,RawImage}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.js");
  env.allowLocalModels=false;
  // Single-thread WASM avoids WebGPU and SharedArrayBuffer/COOP/COEP requirements.
  env.backends.onnx.wasm.numThreads=1;
  env.backends.onnx.wasm.proxy=false;
  segmenter=await pipeline("background-removal","Xenova/modnet",{
   device:"wasm",dtype:"fp32",
   progress_callback:p=>self.postMessage({type:"progress",stage:p.status,file:p.file||"",progress:p.progress,loaded:p.loaded,total:p.total})
  });
  self.postMessage({type:"progress",stage:"前景を推論中"});
  const input=new RawImage(new Uint8ClampedArray(data.pixels),data.width,data.height,4);
  const value=await segmenter(input);
  const output=Array.isArray(value)?value[0]:value;
  if(output.channels!==4||output.width!==data.width||output.height!==data.height)throw Error("モデル出力形式が対応外です");
  const mask=new Uint8Array(output.width*output.height);
  for(let i=0;i<mask.length;i++)mask[i]=output.data[i*4+3];
  await segmenter.dispose();segmenter=null;
  self.postMessage({type:"result",width:output.width,height:output.height,mask:mask.buffer},[mask.buffer]);
 }catch(e){
  try{await segmenter?.dispose();}catch(_){}
  self.postMessage({type:"error",message:"モデルの読込・推論に失敗しました："+(e?.message||String(e))});
 }
};
