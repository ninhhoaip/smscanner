const $ = s => document.querySelector(s);
const video = $("#video");
const totalEl = $("#total"), countEl = $("#count"), rowsEl = $("#rows");
const statusEl = $("#status"), loading = $("#loading"), progress = $("#progress"), loadingText = $("#loadingText");

let stream = null;
let worker = null;
let workerReady = false;
let busy = false;
let autoScan = false;
let autoTimer = null;
let items = JSON.parse(localStorage.getItem("sm_items_v2") || "[]");

let lastCandidate = null;
let candidateHits = 0;
let lastAcceptedFingerprint = "";
let lastAcceptedTime = 0;

function setStatus(title,msg){ statusEl.innerHTML=`<strong>${title}</strong>${msg}`; }
function save(){ localStorage.setItem("sm_items_v2",JSON.stringify(items)); render(); }
function total(){ return items.reduce((s,x)=>s+Number(x.sm),0); }
function render(){
 totalEl.textContent=total().toFixed(2);
 countEl.textContent=items.length;
 rowsEl.innerHTML=items.map((x,i)=>`<tr><td>${items.length-i}</td><td class="sm">${Number(x.sm).toFixed(2)}</td><td>${esc(x.code||"-")}</td><td>${new Date(x.time).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}</td></tr>`).join("");
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

async function initWorker(){
 if(workerReady) return;
 loading.classList.add("on");
 try{
   worker = await Tesseract.createWorker("eng", 1, {
     logger:m=>{
       if(typeof m.progress==="number") progress.value=m.progress;
       loadingText.textContent = m.status ? `${m.status} ${Math.round((m.progress||0)*100)}%` : "Đang khởi tạo OCR…";
     }
   });
   await worker.setParameters({
     tessedit_pageseg_mode: "6",
     tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.,:-/ "
   });
   workerReady=true;
 } finally { loading.classList.remove("on"); }
}

async function startCamera(){
 try{
   await initWorker();
   if(stream) stream.getTracks().forEach(t=>t.stop());
   stream = await navigator.mediaDevices.getUserMedia({
     video:{
       facingMode:{ideal:"environment"},
       width:{ideal:1920},
       height:{ideal:1080},
       focusMode:"continuous"
     }, audio:false
   });
   video.srcObject=stream;
   await video.play();
   setStatus("Camera đã mở","Đưa tem vào khung xanh, nên để chữ SM chiếm khoảng 1/4 chiều ngang màn hình.");
 }catch(e){
   console.error(e);
   setStatus("Không mở được camera","Kiểm tra quyền Camera của Safari.");
 }
}

function grabFrame(){
 if(!video.videoWidth) return null;
 const src=document.createElement("canvas");
 src.width=video.videoWidth; src.height=video.videoHeight;
 src.getContext("2d").drawImage(video,0,0,src.width,src.height);

 // Lấy vùng rộng hơn để tránh lệch khung giữa tỉ lệ video và màn hình
 const sx=Math.round(src.width*0.05);
 const sy=Math.round(src.height*0.18);
 const sw=Math.round(src.width*0.90);
 const sh=Math.round(src.height*0.62);

 // upscale 2x + grayscale + contrast threshold mềm
 const out=document.createElement("canvas");
 out.width=sw*2; out.height=sh*2;
 const ctx=out.getContext("2d",{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;
 ctx.drawImage(src,sx,sy,sw,sh,0,0,out.width,out.height);

 const img=ctx.getImageData(0,0,out.width,out.height);
 const d=img.data;
 for(let i=0;i<d.length;i+=4){
   const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
   // tăng tương phản mạnh nhưng không binary hoàn toàn
   let v=(g-128)*1.75+128;
   v=Math.max(0,Math.min(255,v));
   d[i]=d[i+1]=d[i+2]=v;
 }
 ctx.putImageData(img,0,0);
 return out;
}

function normalize(t){
 return String(t).toUpperCase()
   .replace(/[，]/g,",").replace(/[。]/g,".")
   .replace(/\s+/g," ").trim();
}

function parseSM(text){
 const t=normalize(text);

 const patterns=[
   /(\d{1,3}[.,]\d{2,3})\s*S[MＮN]\b/,
   /\bS[MＮN]\s*[:\-]?\s*(\d{1,3}[.,]\d{2,3})/,
   /(\d{1,3})\s*[.,]\s*(\d{2,3})\s*S[MＮN]\b/
 ];
 for(const p of patterns){
   const m=t.match(p);
   if(m){
     const s=m.length===3 ? `${m[1]}.${m[2]}` : m[1].replace(",",".");
     const n=Number(s);
     if(n>0 && n<500) return n;
   }
 }

 // fallback: lấy số thập phân gần cuối văn bản, phù hợp layout tem mẫu
 const vals=[...t.matchAll(/\b(\d{1,3}[.,]\d{2})\b/g)]
   .map(m=>Number(m[1].replace(",",".")))
   .filter(n=>n>0 && n<200);
 return vals.length ? vals[vals.length-1] : null;
}

function parseCode(text){
 const t=normalize(text);
 const numeric=[...t.matchAll(/\b\d{10,32}\b/g)].map(m=>m[0]);
 if(numeric.length) return numeric.sort((a,b)=>b.length-a.length)[0];

 const mixed=[...t.matchAll(/\b[A-Z0-9\-]{10,32}\b/g)]
   .map(m=>m[0]).filter(x=>/\d/.test(x));
 return mixed.sort((a,b)=>b.length-a.length)[0] || "";
}

function fingerprintFor(text,code,sm){
 if(code) return "C:"+code;
 const t=normalize(text).replace(/\s/g,"");
 return `T:${sm.toFixed(2)}:${t.slice(0,80)}`;
}

async function scanOnce(){
 if(busy || !video.videoWidth) return;
 busy=true;
 try{
   await initWorker();
   const canvas=grabFrame();
   if(!canvas) return;
   const {data}=await worker.recognize(canvas);
   const text=data.text||"";
   const sm=parseSM(text);
   const code=parseCode(text);

   if(sm==null){
     setStatus("Đang tìm SM…","Giữ máy yên và đưa phần “x.xx SM” gần camera hơn.");
     return;
   }

   const fp=fingerprintFor(text,code,sm);

   // tự quét: cần thấy cùng kết quả 2 lần để giảm đọc sai
   const cand=`${sm.toFixed(2)}|${code}`;
   if(autoScan){
     if(cand===lastCandidate) candidateHits++;
     else { lastCandidate=cand; candidateHits=1; }
     if(candidateHits<2){
       setStatus("Đã thấy "+sm.toFixed(2)+" SM","Giữ yên thêm một chút để xác nhận.");
       return;
     }
   }

   const now=Date.now();

   // tránh cộng cùng tem liên tục khi vẫn còn nằm trước camera
   if(fp===lastAcceptedFingerprint && now-lastAcceptedTime<7000){
     setStatus("⚠️ Tem đang giữ trước camera",`${sm.toFixed(2)} SM không cộng lại.`);
     return;
   }

   // chống trùng lâu dài nếu đọc được mã tem
   if(code && items.some(x=>x.code===code)){
     setStatus("⚠️ Tem này đã quét rồi",`${sm.toFixed(2)} SM không cộng lại.`);
     lastAcceptedFingerprint=fp; lastAcceptedTime=now;
     return;
   }

   items.unshift({sm,code:code||"Không đọc được mã",time:new Date().toISOString()});
   save();

   lastAcceptedFingerprint=fp;
   lastAcceptedTime=now;
   candidateHits=0;
   lastCandidate=null;

   if(navigator.vibrate) navigator.vibrate(100);
   setStatus("✅ Đã cộng "+sm.toFixed(2)+" SM",`Tổng hiện tại: ${total().toFixed(2)} SM`);
 }catch(e){
   console.error(e);
   setStatus("Lỗi OCR","Thử giữ camera gần hơn hoặc tăng ánh sáng.");
 }finally{
   busy=false;
 }
}

function setAuto(on){
 autoScan=on;
 $("#autoBtn").textContent=on?"Tắt tự quét":"Bật tự quét";
 $("#autoBtn").classList.toggle("secondary",!on);
 if(autoTimer) clearInterval(autoTimer);
 if(on){
   autoTimer=setInterval(scanOnce,900);
   setStatus("Tự quét đã bật","Chỉ cần lia từng tem vào khung. Không cần bấm Quét.");
 } else {
   autoTimer=null;
 }
}

$("#startBtn").onclick=async()=>{await startCamera(); setAuto(true);};
$("#autoBtn").onclick=()=>setAuto(!autoScan);
$("#scanBtn").onclick=scanOnce;

$("#undoBtn").onclick=()=>{
 if(!items.length)return;
 const x=items.shift(); save();
 setStatus("Đã hoàn tác",`Đã bỏ ${Number(x.sm).toFixed(2)} SM`);
};
$("#clearBtn").onclick=()=>{
 if(items.length && confirm("Xóa toàn bộ dữ liệu?")){
   items=[];save();setStatus("Đã xóa","Tổng SM = 0.00");
 }
};
$("#exportBtn").onclick=()=>{
 if(!items.length)return;
 let csv="\ufeffSTT,SM,Ma tem,Thoi gian\n";
 [...items].reverse().forEach((x,i)=>{
   csv+=`${i+1},${Number(x.sm).toFixed(2)},"${String(x.code).replaceAll('"','""')}","${new Date(x.time).toLocaleString("vi-VN")}"\n`;
 });
 csv+=`,${total().toFixed(2)},TONG,\n`;
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download="SM_Scanner.csv";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
};

if("serviceWorker"in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
render();
