/* Nono Analyzer: zero-network deterministic scene-to-motion planning.
   Does not claim semantic understanding or AI inference. */
(function(root){
"use strict";
const rules=[
 {id:"happy",terms:/嬉し|喜ん|ぱたぱた|はしゃ|楽しい|飛び跳ね|しっぽを振|尻尾を振/g,speed:2,amplitude:24,mode:"bounce"},
 {id:"nervous",terms:/怖|不安|怯|びく|おずおず|警戒|震え|緊張/g,speed:2.5,amplitude:7,mode:"tremble"},
 {id:"slow",terms:/眠|寝|うとうと|のんびり|ゆっくり|静か|ふわふわ/g,speed:0.5,amplitude:8,mode:"sway"},
 {id:"wag",terms:/歩|振る|振っ|動か|揺れ|耳|しっぽ|尻尾|手/g,speed:1,amplitude:15,mode:"sway"}
];
function analyze(text){
 const source=String(text||"").slice(0,3000);
 const clauses=source.split(/(?<=[。！？!?\n])|(?<=、)/u).map(x=>x.trim()).filter(Boolean).slice(0,20);
 const scenes=[];let previous=null;
 for(const clause of clauses){
   const candidates=rules.map(r=>({rule:r,matches:[...clause.matchAll(new RegExp(r.terms.source,"g"))].map(m=>m[0])})).filter(v=>v.matches.length);
   candidates.sort((a,b)=>b.matches.length-a.matches.length||rules.indexOf(a.rule)-rules.indexOf(b.rule));
   const winner=candidates[0];
   let rule=winner?.rule||previous||rules[3];
   previous=rule;
   const target=/耳/.test(clause)?"耳":/しっぽ|尻尾/.test(clause)?"しっぽ":/手|前足/.test(clause)?"手":/目|まばたき/.test(clause)?"目":"全体";
   const negated=/しない|なかった|ずに|止め|やめ/.test(clause);
   const confidence=winner?Math.min(0.9,0.4+0.13*winner.matches.length):0.15;
   scenes.push({text:clause,preset:rule.id,target,mode:negated?"hold":rule.mode,speed:negated?0:rule.speed,amplitude:negated?0:rule.amplitude,confidence:Number(confidence.toFixed(2)),evidence:winner?.matches||[]});
 }
 if(!scenes.length)scenes.push({text:"",preset:"wag",target:"全体",mode:"sway",speed:1,amplitude:15,confidence:0,evidence:[]});
 const score={};for(const s of scenes)score[s.preset]=(score[s.preset]||0)+s.confidence;
 const chosen=rules.reduce((best,r)=>score[r.id]>(score[best.id]||0)?r:best,rules[3]);
 return {version:1,preset:chosen.id,scenes,confidence:Math.max(...scenes.map(s=>s.confidence)),warnings:["自動解析は語句と否定表現に基づく推定です。複雑な文脈は理解しません。"]};
}
function sample({time=0,speed=1,amplitude=15,mode="sway",phase=0}={}){
 const t=Math.max(0,time)*Math.max(0,speed)/240+phase;
 let v=Math.sin(t);
 if(mode==="bounce")v=Math.sin(t)*0.78+Math.sin(t*2.1)*0.22;
 if(mode==="tremble")v=Math.sin(t*2.7)*0.54+Math.sin(t*4.3)*0.21;
 if(mode==="hold")v=0;
 return v*Math.max(0,Math.min(45,amplitude))*Math.PI/180;
}
function imageStats(imageData){
 const {data,width,height}=imageData;
 if(!data||!width||!height)throw Error("画像の画素が必要です");
 let count=0,sum=0,sumSq=0,edge=0;
 const step=Math.max(1,Math.floor(Math.max(width,height)/256));
 const lum=(x,y)=>{const i=(y*width+x)*4;return (data[i]*0.2126+data[i+1]*0.7152+data[i+2]*0.0722)};
 for(let y=0;y<height-step;y+=step)for(let x=0;x<width-step;x+=step){
 const l=lum(x,y);sum+=l;sumSq+=l*l;edge+=Math.abs(l-lum(x+step,y))+Math.abs(l-lum(x,y+step));count++;
 }
 const mean=count?sum/count:0;
 return {brightness:Math.round(mean),contrast:Math.round(Math.sqrt(Math.max(0,sumSq/count-mean*mean))),edgeDensity:Math.round(edge/Math.max(1,count)),recommendation:edge/Math.max(1,count)>35?"輪郭が多い画像。パーツを細かく囲むと継ぎ目が目立ちます。":"輪郭が比較的少ない画像。大きめのパーツで試せます。"};
}

function selectRegion(imageData,px,py,{threshold=40,maxFraction=0.38}={}){
 const {width:w,height:h,data}=imageData;
 if(!w||!h||w*h>500000)throw Error("解析画像が大きすぎます");
 const x=Math.max(0,Math.min(w-1,Math.floor(px))),y=Math.max(0,Math.min(h-1,Math.floor(py)));
 const base=(y*w+x)*4,seed=[data[base],data[base+1],data[base+2]];
 const visited=new Uint8Array(w*h),stack=[y*w+x],points=[];
 const max=Math.floor(w*h*maxFraction);
 let minx=w,miny=h,maxx=0,maxy=0;
 while(stack.length){
 const n=stack.pop();if(visited[n])continue;visited[n]=1;
 const a=n*4,xx=n%w,yy=(n/w)|0;
 const diff=Math.sqrt((data[a]-seed[0])**2+(data[a+1]-seed[1])**2+(data[a+2]-seed[2])**2);
 if(diff>threshold||data[a+3]<64)continue;
 points.push([xx,yy]);minx=Math.min(minx,xx);miny=Math.min(miny,yy);maxx=Math.max(maxx,xx);maxy=Math.max(maxy,yy);
 if(points.length>max)throw Error("領域が広すぎます。しっぽの先端など別の場所をタップしてください");
 if(xx>0&&!visited[n-1])stack.push(n-1);
 if(xx<w-1&&!visited[n+1])stack.push(n+1);
 if(yy>0&&!visited[n-w])stack.push(n-w);
 if(yy<h-1&&!visited[n+w])stack.push(n+w);
 }
 if(points.length<8)throw Error("領域を認識できません。別の場所をタップしてください");
 const mask=new Uint8Array(w*h);
 points.forEach(([xx,yy])=>mask[yy*w+xx]=1);
 const outline=[];
 for(const [xx,yy] of points){
 const n=yy*w+xx;
 if(xx===0||yy===0||xx===w-1||yy===h-1||!mask[n-1]||!mask[n+1]||!mask[n-w]||!mask[n+w])outline.push([xx,yy]);
 }
 // Hull of detected boundary: approximate editable polygon, not semantic segmentation.
 outline.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const lower=[],upper=[];
 for(const p of outline){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
 for(let i=outline.length-1;i>=0;i--){const p=outline[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
 const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
 return {polygon:hull.map(p=>({x:p[0],y:p[1]})),bounds:{x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1},coverage:points.length/(w*h)};
}

root.NonoAnalyzer={analyze,sample,imageStats,selectRegion};
})(typeof window!=="undefined"?window:globalThis);
