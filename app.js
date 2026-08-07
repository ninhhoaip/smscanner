const $=q=>document.querySelector(q);
const video=$("#video"), guide=$("#guide"), status=$("#status"), raw=$("#raw");
const totalEl=$("#total"), countEl=$("#count"), rows=$("#rows");
const overlay=$("#overlay"), loadText=$("#loadText"), prog=$("#prog");

let stream=null, worker=null, ready=false, busy=false, auto=false, timer=null;
let items=JSON.parse(localStorage.getItem("sm_v3_items")||"[]");
let lastValue=null, lastAccept=0;

function render(){
  totalEl.textContent=items.reduce((s,x)=>s+x.sm,0).toFixed(2);
  countEl.textContent=items.length;
  rows.innerHTML=items.map((x,i)=>`<tr><td>${items.length-i}</td><td class="sm">${x.sm.toFixed(2)}</td><td>${new Date(x.time).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</td></tr>`).join("");
}
function save(){localStorage.setItem("sm_v3_items",JSON.stringify(items));render()}
function msg(title,text,rawText=""){
  status.querySelector("strong").textContent=title;
  const nodes=[...status.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE);
  nodes.forEach(n=>n.remove());
  status.insertBefore(document.createTextNode(text),raw);
  raw.textContent=rawText?`OCR: ${rawText}`:"";
}
async function initOCR(){
  if(ready)return;
  overlay.classList.add("on");
  loadText.textContent="Lần đầu đang tải OCR…";
  try{
    worker=await Tesseract.createWorker("eng",1,{
      logger:m=>{
        if(typeof m.progress==="number")prog.value=m.progress;
        if(m.status)loadText.textContent=`${m.status} ${Math.round((m.progress||0)*100)}%`;
      }
    });
    await worker.setParameters({
      tessedit_pageseg_mode:"7",
      tessedit_char_whitelist:"0123456789.SMsm,"
    });
    ready=true;
  } finally { overlay.classList.remove("on"); }
}
async function openCamera(){
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
    if(stream)stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},
      audio:false
    });
    video.srcObject=stream;
    await video.play();
    $("#scan").disabled=false; $("#auto").disabled=false;
    msg("Camera đã mở"," Đặt riêng phần “5.28 SM” vào ô xanh rồi bấm Quét ngay.");
    // tải OCR sau khi camera đã mở để không tạo cảm giác app bị đứng
    initOCR().catch(e=>msg("Không tải được OCR"," Kiểm tra Internet rồi tải lại trang.",String(e)));
  }catch(e){
    msg("Không mở được camera"," Kiểm tra quyền Camera cho Safari.",String(e));
  }
}

// Map đúng ô xanh trên màn hình vào frame video khi object-fit:cover
function cropGuide(){
  if(!video.videoWidth||!video.videoHeight)return null;

  const vr=video.getBoundingClientRect(), gr=guide.getBoundingClientRect();
  const vw=video.videoWidth, vh=video.videoHeight;
  const scale=Math.max(vr.width/vw, vr.height/vh);
  const rw=vw*scale, rh=vh*scale;
  const offX=(rw-vr.width)/2, offY=(rh-vr.height)/2;

  let sx=(gr.left-vr.left+offX)/scale;
  let sy=(gr.top-vr.top+offY)/scale;
  let sw=gr.width/scale, sh=gr.height/scale;

  sx=Math.max(0,sx); sy=Math.max(0,sy);
  sw=Math.min(vw-sx,sw); sh=Math.min(vh-sy,sh);

  const temp=document.createElement("canvas");
  temp.width=vw; temp.height=vh;
  temp.getContext("2d").drawImage(video,0,0,vw,vh);

  // OCR ảnh nhỏ, rộng tối đa 1000px
  const targetW=Math.min(1000,Math.max(650,Math.round(sw*1.8)));
  const targetH=Math.max(180,Math.round(targetW*(sh/sw)));
  const out=document.createElement("canvas");
  out.width=targetW; out.height=targetH;
  const ctx=out.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(temp,sx,sy,sw,sh,0,0,targetW,targetH);

  // grayscale + tăng tương phản
  const im=ctx.getImageData(0,0,targetW,targetH),d=im.data;
  for(let i=0;i<d.length;i+=4){
    let g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    g=(g-128)*1.55+128;
    g=Math.max(0,Math.min(255,g));
    d[i]=d[i+1]=d[i+2]=g;
  }
  ctx.putImageData(im,0,0);
  return out;
}
function parseSM(t){
  let s=String(t||"").toUpperCase()
    .replace(/O/g,"0").replace(/[IL|]/g,"1")
    .replace(/,/g,".").replace(/\s+/g," ").trim();

  let m=s.match(/(\d{1,3}\.\d{1,3})/);
  if(m){
    let n=Number(m[1]);
    if(n>0&&n<500)return n;
  }

  // OCR đôi khi bỏ dấu chấm: 528 SM -> 5.28
  let digits=s.replace(/\D/g,"");
  if(digits.length>=3&&digits.length<=5){
    let n=Number(digits.slice(0,-2)+"."+digits.slice(-2));
    if(n>0&&n<500)return n;
  }
  return null;
}
async function recognize(canvas){
  await initOCR();
  const r=await worker.recognize(canvas);
  return (r.data.text||"").trim();
}
async function scanOnce(){
  if(busy)return;
  if(!video.videoWidth){msg("Chưa có hình camera"," Nhấn Mở camera trước.");return}
  busy=true;
  $("#scan").textContent="Đang đọc…";
  try{
    const c=cropGuide();
    if(!c)throw new Error("Không lấy được hình");
    const text=await recognize(c);
    const sm=parseSM(text);

    if(sm==null){
      msg("Chưa đọc được SM"," Đưa chữ và số TO hơn trong ô xanh, giữ máy yên.",text||"(trống)");
      return;
    }

    const now=Date.now();
    // không cộng liên tục cùng giá trị khi tem vẫn còn trước camera
    if(lastValue!==null && Math.abs(lastValue-sm)<0.001 && now-lastAccept<5000){
      msg("Đã thấy "+sm.toFixed(2)+" SM"," Tem này vừa được cộng. Đưa tem khác vào.",text);
      return;
    }

    items.unshift({sm,time:new Date().toISOString()});
    lastValue=sm; lastAccept=now;
    save();
    if(navigator.vibrate)navigator.vibrate(80);
    msg("✅ Đã cộng "+sm.toFixed(2)+" SM",` Tổng: ${items.reduce((s,x)=>s+x.sm,0).toFixed(2)} SM`,text);
  }catch(e){
    msg("Lỗi khi quét"," Thử tải lại trang hoặc kiểm tra Internet.",String(e));
  }finally{
    busy=false;
    $("#scan").textContent="Quét ngay";
  }
}
function setAuto(v){
  auto=v; $("#auto").textContent=v?"Tắt tự quét":"Bật tự quét";
  if(timer)clearInterval(timer);
  timer=v?setInterval(scanOnce,1500):null;
  msg(v?"Tự quét đã bật":"Tự quét đã tắt",v?" Chỉ cần thay từng tem trong ô xanh.":" Có thể bấm Quét ngay.");
}
$("#open").onclick=openCamera;
$("#scan").onclick=scanOnce;
$("#auto").onclick=()=>setAuto(!auto);
$("#undo").onclick=()=>{if(items.length){let x=items.shift();save();msg("Đã hoàn tác",` Bỏ ${x.sm.toFixed(2)} SM.`)}};
$("#clear").onclick=()=>{if(items.length&&confirm("Xóa toàn bộ?")){items=[];save();lastValue=null;msg("Đã xóa"," Tổng về 0.00.")}};
$("#export").onclick=()=>{
  if(!items.length)return;
  let csv="\ufeffSTT,SM,Thoi gian\n";
  [...items].reverse().forEach((x,i)=>csv+=`${i+1},${x.sm.toFixed(2)},"${new Date(x.time).toLocaleString("vi-VN")}"\n`);
  csv+=`,${items.reduce((s,x)=>s+x.sm,0).toFixed(2)},TONG\n`;
  const u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=u;a.download="SM_Scanner.csv";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
};
render();
