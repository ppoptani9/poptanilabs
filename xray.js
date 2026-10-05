/* Fund Overlap X-Ray — static port of the Streamlit page. Data: /data/holdings.json (equity holdings only). */
"use strict";

/* ---------- theme ---------- */
const rootEl = document.documentElement;
function paintThemeBtn(){ const t=rootEl.getAttribute("data-theme");
  const k=document.getElementById("themeKnob"), n=document.getElementById("themeName");
  if(k) k.innerHTML = t === "light" ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  if(n) n.textContent = t==="light" ? "Dark" : "Light"; }
function setTheme(t){ rootEl.setAttribute("data-theme", t); try{localStorage.setItem("swp-theme",t);}catch(e){} paintThemeBtn(); }
setTheme((()=>{try{return localStorage.getItem("swp-theme")||"light";}catch(e){return "light";}})());
document.getElementById("themeBtn").addEventListener("click", () =>
  setTheme(rootEl.getAttribute("data-theme")==="light" ? "dark" : "light"));

/* ---------- data ---------- */
let FUNDS = [];          // [{name, amc, category, n_holdings, equity_pct, holdings:[{stock,sector,pct}]}]
let SCRAPED_ON = "";
const selected = [];    // fund objects, max 4

async function loadData(){
  const st = document.getElementById("dataStatus");
  try{
    const r = await fetch("/data/holdings.json", {cache:"force-cache"});
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    FUNDS = j.funds || [];
    SCRAPED_ON = j.scraped_on || "";
    st.textContent = `${FUNDS.length} funds · disclosures scraped ${SCRAPED_ON} · equity holdings only`;
    renderResults();
  }catch(e){
    st.textContent = "Could not load holdings data (" + e.message + "). Check your connection and reload.";
  }
}

/* ---------- fund picker ---------- */
function searchFunds(){
  const q = document.getElementById("fundSearch").value.trim().toLowerCase();
  const box = document.getElementById("fundResults");
  if(!q){ box.innerHTML = ""; return; }
  const words = q.split(/\s+/);
  const out = [];
  for(const f of FUNDS){
    if(selected.includes(f)) continue;
    const nl = f.name.toLowerCase();
    if(words.every(w => nl.includes(w))) out.push(f);
    if(out.length >= 30) break;
  }
  if(!out.length){ box.innerHTML = '<div style="padding:12px" class="hint">No matching funds.</div>'; return; }
  box.innerHTML = out.map((f,i) =>
    `<button data-i="${FUNDS.indexOf(f)}">${f.name}<small>${f.amc} · ${f.category} · ${f.n_holdings} stocks</small></button>`).join("");
  box.querySelectorAll("button").forEach(b =>
    b.addEventListener("click", () => addFund(FUNDS[Number(b.dataset.i)])));
}
function addFund(f){
  if(selected.includes(f) || selected.length >= 4) return;
  selected.push(f);
  renderSelected();
  searchFunds();
}
function removeFund(f){
  const i = selected.indexOf(f);
  if(i>=0) selected.splice(i,1);
  renderSelected();
}
function renderSelected(){
  const box = document.getElementById("selChips");
  document.getElementById("selCount").textContent = `(${selected.length} of 4)`;
  if(!selected.length){
    box.innerHTML = '<span class="hint">Search above and tap a fund to add it.</span>';
  }else{
    box.innerHTML = selected.map(f =>
      `<button class="chip on" data-n="${f.name.replace(/"/g,"&quot;")}" title="Remove">${f.name.replace(" - Growth","")} ✕</button>`).join("");
    box.querySelectorAll(".chip").forEach(c =>
      c.addEventListener("click", () => {
        const f = selected.find(x => x.name === c.dataset.n);
        if(f) removeFund(f);
      }));
  }
  document.getElementById("runBtn").disabled = selected.length < 2;
  const err = document.getElementById("pickError");
  err.classList.add("hidden");
}
function renderResults(){ /* placeholder until data loads; picker needs no results */ }

/* ---------- overlap math ---------- */
function weights(f){
  const d = {};
  for(const h of f.holdings) d[h.stock] = (d[h.stock]||0) + h.pct;
  return d;
}
function overlapPct(fa, fb){
  const wa = weights(fa), wb = weights(fb);
  let ov = 0, n = 0;
  for(const s of Object.keys(wa)){
    if(s in wb){ ov += Math.min(wa[s], wb[s]); n++; }
  }
  return {pct: ov, shared: n};
}
function sectorOf(f, stock){
  const h = f.holdings.find(x => x.stock === stock);
  return h ? h.sector : "";
}

/* ---------- tiny count-up for overlap percentages ---------- */
function countUp(el){
  const targ = parseFloat(el.dataset.countup);
  if(!isFinite(targ)) return;
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches){ el.textContent = targ.toFixed(1)+"%"; return; }
  const dur = 700, t0 = performance.now();
  (function frame(t){
    const p = Math.min(1, (t-t0)/dur), e = 1 - Math.pow(1-p, 3);
    el.textContent = (targ*e).toFixed(1) + "%";
    if(p < 1) requestAnimationFrame(frame); else el.textContent = targ.toFixed(1) + "%";
  })(t0);
}

/* ---------- report ---------- */
function shortName(n){ return n.replace(" - Growth","").replace(" Fund",""); }
function runXray(){
  const err = document.getElementById("pickError");
  if(selected.length < 2){
    err.textContent = "Pick at least 2 funds to X-ray.";
    err.classList.remove("hidden");
    return;
  }
  err.classList.add("hidden");

  // pairwise matrix
  const n = selected.length;
  const pairs = [];
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
    const r = overlapPct(selected[i], selected[j]);
    pairs.push({i, j, ...r});
  }
  const tbl = document.getElementById("matrixTable");
  let html = "<thead><tr><th></th>" + selected.map(f=>`<th>${shortName(f.name)}</th>`).join("") + "</tr></thead><tbody>";
  for(let i=0;i<n;i++){
    html += `<tr><td><b>${shortName(selected[i].name)}</b></td>`;
    for(let j=0;j<n;j++){
      if(i===j){ html += "<td>—</td>"; continue; }
      const p = pairs.find(p => (p.i===i&&p.j===j)||(p.i===j&&p.j===i));
      const hot = p.pct >= 50 ? ' style="color:var(--bad);font-weight:800"' : (p.pct >= 30 ? ' style="color:var(--warn);font-weight:700"' : "");
      html += `<td${hot}><span data-countup="${p.pct.toFixed(1)}">${p.pct.toFixed(1)}%</span><br><small class="hint">${p.shared} stocks</small></td>`;
    }
    html += "</tr>";
  }
  tbl.innerHTML = html + "</tbody>";

  document.getElementById("repNote").textContent =
    `X-raying ${n} funds · disclosures scraped ${SCRAPED_ON} · equity holdings only (derivatives, debt, cash excluded)`;

  // verdict
  const worst = pairs.reduce((a,b)=> a.pct>b.pct?a:b);
  const v = document.getElementById("verdict");
  const wa = shortName(selected[worst.i].name), wb = shortName(selected[worst.j].name);
  let msg, cls;
  if(worst.pct >= 50){ msg = `<b>${wa}</b> and <b>${wb}</b> overlap <b data-countup="${worst.pct.toFixed(1)}">${worst.pct.toFixed(1)}%</b> — they're largely doing the same job. One of them is probably redundant.`; cls="var(--bad)"; }
  else if(worst.pct >= 30){ msg = `<b>${wa}</b> and <b>${wb}</b> overlap <b data-countup="${worst.pct.toFixed(1)}">${worst.pct.toFixed(1)}%</b> — meaningful common ground, but still distinct bets.`; cls="var(--warn)"; }
  else { msg = `Highest overlap is <b data-countup="${worst.pct.toFixed(1)}">${worst.pct.toFixed(1)}%</b> (${wa} × ${wb}) — your funds are genuinely diversified.`; cls="var(--good)"; }
  v.innerHTML = `<div class="scheme" style="border-left:4px solid ${cls}">${msg}</div>`;

  // pair selector + shared table
  const sel = document.getElementById("pairSel");
  sel.innerHTML = pairs.map((p,k)=>
    `<option value="${k}">${shortName(selected[p.i].name)} × ${shortName(selected[p.j].name)} — ${p.pct.toFixed(1)}%</option>`).join("");
  const showPair = k => {
    const p = pairs[Number(k)];
    const fa = selected[p.i], fb = selected[p.j];
    document.getElementById("thA").textContent = shortName(fa.name) + " %";
    document.getElementById("thB").textContent = shortName(fb.name) + " %";
    document.getElementById("pairHint").textContent = `— ${p.shared} shared stocks, ${p.pct.toFixed(1)}% overlap`;
    const wa2 = weights(fa), wb2 = weights(fb);
    const rows = Object.keys(wa2).filter(s => s in wb2)
      .map(s => ({s, a:wa2[s], b:wb2[s], ov:Math.min(wa2[s],wb2[s]), sector:sectorOf(fa,s)}))
      .sort((x,y)=>y.ov-x.ov);
    document.getElementById("sharedBody").innerHTML = rows.map(r =>
      `<tr><td>${r.s}</td><td>${r.sector}</td><td>${r.a.toFixed(2)}%</td><td>${r.b.toFixed(2)}%</td><td><b>${r.ov.toFixed(2)}%</b></td></tr>`).join("");
  };
  sel.onchange = () => showPair(sel.value);
  showPair(0);

  // combined top holdings (average weight across selected funds)
  const agg = {};
  for(const f of selected){
    const w = weights(f);
    for(const s of Object.keys(w)){
      if(!agg[s]) agg[s] = {tot:0, cnt:0, sector:sectorOf(f,s)};
      agg[s].tot += w[s]; agg[s].cnt += 1;
    }
  }
  const top = Object.entries(agg)
    .map(([s,x]) => ({s, avg:x.tot/selected.length, cnt:x.cnt, sector:x.sector}))
    .sort((a,b)=>b.avg-a.avg).slice(0,15);
  document.getElementById("topBody").innerHTML = top.map(r =>
    `<tr><td>${r.s}</td><td>${r.sector}</td><td>${r.cnt} of ${n}</td><td><b>${r.avg.toFixed(2)}%</b></td></tr>`).join("");

  const rc = document.getElementById("resultsCard");
  rc.classList.remove("hidden");
  rc.classList.remove("rise"); void rc.offsetWidth; rc.classList.add("rise");
  rc.querySelectorAll("[data-countup]").forEach(countUp);
  rc.scrollIntoView({behavior:"smooth"});
}

/* ---------- wiring ---------- */
function init(){
  const fs = document.getElementById("fundSearch");
  let deb = null;
  fs.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(searchFunds, 180); });
  document.getElementById("runBtn").addEventListener("click", runXray);
  loadData();
}
document.addEventListener("DOMContentLoaded", init);
