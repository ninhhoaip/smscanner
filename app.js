const $ = s => document.querySelector(s);
const video = $("#video");
const preview = $("#preview");
const totalEl = $("#total");
const countEl = $("#count");
const rowsEl = $("#rows");
const statusEl = $("#status");
const loadingEl = $("#loading");
const loadingText = $("#loadingText");
const progressEl = $("#progress");

let stream = null;
let items = JSON.parse(localStorage.getItem("sm_items") || "[]");

function save() {
  localStorage.setItem("sm_items", JSON.stringify(items));
  render();
}

function total() {
  return items.reduce((s, x) => s + Number(x.sm || 0), 0);
}

function render() {
  totalEl.textContent = total().toFixed(2);
  countEl.textContent = items.length;
  rowsEl.innerHTML = items.map((x,i) => `
    <tr>
      <td>${items.length-i}</td>
      <td class="sm">${Number(x.sm).toFixed(2)}</td>
      <td>${escapeHtml(x.code || "-")}</td>
      <td>${new Date(x.time).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}</td>
    </tr>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function setStatus(title, text) {
  statusEl.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(text)}`;
}

async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width:{ideal:1920}, height:{ideal:1080} },
      audio:false
    });
    video.srcObject = stream;
    $("#captureBtn").disabled = false;
    setStatus("Camera đã mở", "Giữ iPhone ổn định, để cả phần SM và mã số trên tem nằm trong khung.");
  } catch(e) {
    setStatus("Không mở được camera", "Hãy cho phép Camera trong Cài đặt Safari, hoặc dùng nút “Chụp / chọn ảnh”.");
  }
}

function cropCenter(sourceCanvas) {
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  // vùng tương ứng khung trắng trên màn hình
  const x = Math.round(sw * 0.07);
  const y = Math.round(sh * 0.30);
  const w = Math.round(sw * 0.86);
  const h = Math.round(sh * 0.38);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(sourceCanvas, x,y,w,h, 0,0,w,h);
  return out;
}

async function captureAndOCR() {
  if (!video.videoWidth) return;
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video,0,0,c.width,c.height);
  await ocrCanvas(cropCenter(c));
}

async function fileToCanvas(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const c = document.createElement("canvas");
  const max = 2200;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w,h) > max) {
    const r = max / Math.max(w,h); w=Math.round(w*r); h=Math.round(h*r);
  }
  c.width=w; c.height=h;
  c.getContext("2d").drawImage(img,0,0,w,h);
  URL.revokeObjectURL(img.src);
  return c;
}

function normalizeText(text) {
  return text.toUpperCase()
    .replace(/[，]/g,",")
    .replace(/[。]/g,".")
    .replace(/\s+/g," ")
    .trim();
}

function extractSM(text) {
  const t = normalizeText(text);
  let m = t.match(/(\d{1,4}(?:[.,]\d{1,3}))\s*S[MＮN]\b/);
  if (m) return Number(m[1].replace(",","."));

  // Một số OCR đọc "SM" trước số
  m = t.match(/\bS[MＮN]\s*[:\-]?\s*(\d{1,4}(?:[.,]\d{1,3}))/);
  if (m) return Number(m[1].replace(",","."));

  // fallback: các số thập phân hợp lý
  const nums = [...t.matchAll(/\b(\d{1,3}[.,]\d{2,3})\b/g)]
    .map(x=>Number(x[1].replace(",",".")))
    .filter(x=>x>0 && x<500);
  return nums.length ? nums[nums.length-1] : null;
}

function extractCode(text) {
  const t = normalizeText(text);
  // ưu tiên chuỗi số dài dưới mã vạch
  const runs = [...t.matchAll(/\b\d{8,30}\b/g)].map(m=>m[0]);
  if (runs.length) return runs.sort((a,b)=>b.length-a.length)[0];

  // fallback mã chữ+số dài
  const alnum = [...t.matchAll(/\b[A-Z0-9\-]{10,32}\b/g)]
    .map(m=>m[0]).filter(x=>/\d/.test(x));
  if (alnum.length) return alnum.sort((a,b)=>b.length-a.length)[0];

  return "";
}

async function ocrCanvas(canvas) {
  loadingEl.classList.add("on");
  progressEl.value = 0;
  loadingText.textContent = "Đang đọc tem…";
  try {
    const result = await Tesseract.recognize(canvas, "eng", {
      logger: m => {
        if (typeof m.progress === "number") progressEl.value = m.progress;
        if (m.status) loadingText.textContent = "Đang đọc tem… " + Math.round((m.progress||0)*100) + "%";
      }
    });

    const text = result.data.text || "";
    const sm = extractSM(text);
    const code = extractCode(text);

    if (sm == null || Number.isNaN(sm)) {
      setStatus("Chưa đọc được SM", "Đưa camera gần hơn và đảm bảo nhìn rõ phần số dạng 5.28 SM.");
      return;
    }

    // Nếu đọc được mã tem thì chống trùng chắc chắn.
    // Nếu không đọc được mã, dùng toàn bộ OCR làm dấu vân tay tạm thời.
    const fingerprint = code || normalizeText(text).replace(/\s/g,"").slice(0,120);
    if (fingerprint && items.some(x => x.fingerprint === fingerprint)) {
      setStatus("⚠️ Tem đã quét", `SM ${sm.toFixed(2)} không được cộng lại.`);
      if (navigator.vibrate) navigator.vibrate([120,80,120]);
      return;
    }

    items.unshift({
      sm,
      code: code || "Không đọc được mã",
      fingerprint,
      time: new Date().toISOString()
    });
    save();
    setStatus("✅ Đã cộng", `${sm.toFixed(2)} SM • Tổng hiện tại ${total().toFixed(2)} SM`);
    if (navigator.vibrate) navigator.vibrate(100);
  } catch(e) {
    console.error(e);
    setStatus("Lỗi OCR", "Kiểm tra Internet ở lần sử dụng đầu tiên rồi thử lại.");
  } finally {
    loadingEl.classList.remove("on");
  }
}

$("#startBtn").addEventListener("click", startCamera);
$("#captureBtn").addEventListener("click", captureAndOCR);

$("#fileInput").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const c = await fileToCanvas(file);
    await ocrCanvas(c);
  } finally {
    e.target.value = "";
  }
});

$("#undoBtn").addEventListener("click", () => {
  if (!items.length) return;
  const x = items.shift();
  save();
  setStatus("Đã hoàn tác", `Đã bỏ ${Number(x.sm).toFixed(2)} SM.`);
});

$("#clearBtn").addEventListener("click", () => {
  if (!items.length) return;
  if (confirm("Xóa toàn bộ dữ liệu đã quét?")) {
    items = [];
    save();
    setStatus("Đã xóa", "Tổng SM trở về 0.00.");
  }
});

$("#exportBtn").addEventListener("click", () => {
  if (!items.length) return setStatus("Chưa có dữ liệu", "Hãy quét ít nhất một tem.");
  let csv = "\ufeffSTT,SM,Ma tem,Thoi gian\n";
  [...items].reverse().forEach((x,i)=>{
    const safe = String(x.code||"").replaceAll('"','""');
    csv += `${i+1},${Number(x.sm).toFixed(2)},"${safe}","${new Date(x.time).toLocaleString("vi-VN")}"\n`;
  });
  csv += `,${total().toFixed(2)},TONG,\n`;
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`SM_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

render();
