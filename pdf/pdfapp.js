/* Poptani Labs PDF tools — shared engine. Everything runs in the browser; files never leave the device. */
"use strict";
const PDFApp = (() => {
  let _libs = null;

  function loadScript(src){
    return new Promise((res, rej) => {
      if(document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function libs(){
    if(_libs) return _libs;
    await loadScript("/vendor/pdf-lib.min.js");
    await loadScript("/vendor/pdf.min.js");
    const { PDFLib, pdfjsLib } = window;
    if(!PDFLib) throw new Error("pdf-lib failed to load.");
    if(!pdfjsLib) throw new Error("pdf.js failed to load.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
    _libs = { PDFLib, pdfjsLib };
    return _libs;
  }

  function readAsBytes(file){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = rej;
      r.readAsArrayBuffer(file);
    });
  }

  function download(bytes, filename, mime){
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], {type: mime || "application/octet-stream"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function fmtSize(b){
    if(b < 1024) return b + " B";
    if(b < 1048576) return (b/1024).toFixed(1) + " KB";
    return (b/1048576).toFixed(2) + " MB";
  }

  /* "1-3, 5, 8-" -> sorted unique 0-based page indices; throws on bad input */
  function parseRanges(str, pageCount){
    const out = new Set();
    const parts = String(str).split(",").map(s => s.trim()).filter(Boolean);
    if(!parts.length) throw new Error("Enter at least one page or range (e.g. 1-3, 5).");
    for(const p of parts){
      const m = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(p);
      if(!m) throw new Error(`Can't understand "${p}" — use numbers and ranges like 1-3, 5.`);
      let a = parseInt(m[1], 10), b = m[2] === undefined ? a : (m[2] === "" ? pageCount : parseInt(m[2], 10));
      if(a < 1 || b < 1 || a > pageCount || b > pageCount || a > b)
        throw new Error(`Range "${p}" is outside 1–${pageCount}.`);
      for(let i = a; i <= b; i++) out.add(i - 1);
    }
    return [...out].sort((x, y) => x - y);
  }

  /* drop zone: element gets .dz; onFiles(files) called with File[] */
  function dropzone(el, onFiles, accept){
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept || "";
    input.multiple = true; input.style.display = "none";
    el.appendChild(input);
    el.addEventListener("click", e => { if(e.target.closest("button")) return; input.click(); });
    input.addEventListener("change", () => { onFiles([...input.files]); input.value = ""; });
    ["dragenter","dragover"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove("over"); }));
    el.addEventListener("drop", e => { const f = [...e.dataTransfer.files]; if(f.length) onFiles(f); });
    el.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); input.click(); } });
  }

  function fileRow(name, meta, onRemove){
    const d = document.createElement("div");
    d.className = "pdffile";
    d.innerHTML = `<span class="pdfico">📄</span><span class="pdfname"></span><span class="pdfmeta"></span>`;
    d.querySelector(".pdfname").textContent = name;
    d.querySelector(".pdfmeta").textContent = meta || "";
    if(onRemove){
      const x = document.createElement("button");
      x.type = "button"; x.className = "chip"; x.textContent = "×";
      x.setAttribute("aria-label", "Remove " + name);
      x.style.cssText = "padding:6px 12px;flex:none";
      x.addEventListener("click", e => { e.stopPropagation(); onRemove(d); });
      d.appendChild(x);
    }
    return d;
  }

  function moveRow(d, dir){
    const sib = dir < 0 ? d.previousElementSibling : d.nextElementSibling;
    if(sib) d.parentNode.insertBefore(d, dir < 0 ? sib : sib.nextSibling);
  }

  function reorderBtns(d){
    const w = document.createElement("span");
    w.className = "pdfmove";
    w.innerHTML = `<button type="button" class="chip" data-m="-1" aria-label="Move up">↑</button>
                   <button type="button" class="chip" data-m="1" aria-label="Move down">↓</button>`;
    w.querySelectorAll("button").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation(); moveRow(d, parseInt(b.dataset.m, 10));
    }));
    return w;
  }

  async function withProgress(btn, label, fn){
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${label}…`;
    try{ return await fn(); }
    finally{ btn.disabled = false; btn.innerHTML = old; }
  }

  function showError(box, msg){
    box.textContent = msg;
    box.classList.remove("hidden");
    box.scrollIntoView({behavior:"smooth", block:"center"});
  }
  function hideError(box){ box.classList.add("hidden"); box.textContent = ""; }

  function showDone(box, html){
    box.innerHTML = html;
    box.classList.remove("hidden");
    box.scrollIntoView({behavior:"smooth", block:"center"});
  }

  return { libs, readAsBytes, download, fmtSize, parseRanges, dropzone,
           fileRow, reorderBtns, withProgress, showError, hideError, showDone };
})();
