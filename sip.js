/* SIP Calculator — static port of the Streamlit page. Data: api.mfapi.in (CORS-enabled). */
"use strict";
const API_BASE = "https://api.mfapi.in";

/* ---------- theme ---------- */
const rootEl = document.documentElement;
function paintThemeBtn(){ const t=rootEl.getAttribute("data-theme");
  const k=document.getElementById("themeKnob"), n=document.getElementById("themeName");
  if(k) k.textContent = t==="light" ? "🌙" : "☀️";
  if(n) n.textContent = t==="light" ? "AMOLED dark" : "Light"; }
function setTheme(t){ rootEl.setAttribute("data-theme", t); try{localStorage.setItem("swp-theme",t);}catch(e){} paintThemeBtn(); }
setTheme((()=>{try{return localStorage.getItem("swp-theme")||"light";}catch(e){return "light";}})());
document.getElementById("themeBtn").addEventListener("click", () =>
  setTheme(rootEl.getAttribute("data-theme")==="light" ? "dark" : "light"));

/* ---------- formatting / dates ---------- */
function formatINR(amount){
  const amt = Number(amount);
  if(!isFinite(amt)) return String(amount);
  const a = Math.abs(amt); let v, s;
  if(a >= 1e7){ v = amt/1e7; s="Cr"; }
  else if(a >= 1e5){ v = amt/1e5; s="L"; }
  else if(a >= 1e3){ v = amt/1e3; s="K"; }
  else { v = amt; s=""; }
  return "₹" + v.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}) + s;
}
const fmtDate = d => d.toISOString().slice(0,10);
const parseDate = s => { const [y,m,dd]=s.split("-").map(Number); return new Date(y, m-1, dd); };
const daysInMonth = (y,m) => new Date(y, m+1, 0).getDate();

/* ---------- fund list (bundled snapshot + live refresh, same as SWP page) ---------- */
let FUNDS = [];
const fundState = { query:"", amc:"", selected:null };
function amcOf(name){ const w = name.split(" ")[0]; return /^[A-Za-z]/.test(w) ? w : "Other"; }

async function loadFundList(){
  const status = document.getElementById("fundStatus");
  try{
    const r = await fetch("/data/funds.json", {cache:"force-cache"});
    if(r.ok){
      const j = await r.json();
      setFunds(j.funds, j.count.toLocaleString("en-IN") + " schemes · updated " + (j.updated||""));
    }
  }catch(e){}
  try{
    const cached = localStorage.getItem("swp-funds-cache");
    if(cached){
      const j = JSON.parse(cached);
      if(j.count > 30000){ setFunds(j.funds, j.count.toLocaleString("en-IN") + " schemes"); return; }
    }
  }catch(e){}
  refreshFundList(true);
}
function setFunds(arr, note){
  FUNDS = arr.map(f => ({c:f.c, n:f.n, amc:amcOf(f.n)}));
  const amcs = [...new Set(FUNDS.map(f=>f.amc))].sort((a,b)=>a.localeCompare(b));
  const sel = document.getElementById("amcFilter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">All AMCs</option>' + amcs.map(a=>`<option value="${a}">${a}</option>`).join("");
  sel.value = cur && amcs.includes(cur) ? cur : "";
  const st = document.getElementById("fundStatus");
  if(st) st.textContent = note || (FUNDS.length.toLocaleString("en-IN") + " schemes loaded");
  renderFundResults();
}
async function refreshFundList(quiet){
  const st = document.getElementById("fundStatus");
  try{
    if(st && !quiet) st.textContent = "Downloading latest scheme list from mfapi.in…";
    const r = await fetch(API_BASE + "/mf");
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const funds = j.filter(x=>x.schemeName && x.schemeCode).map(x=>({c:x.schemeCode, n:x.schemeName.trim()}));
    try{ localStorage.setItem("swp-funds-cache", JSON.stringify({count:funds.length, funds})); }catch(e){}
    setFunds(funds, funds.length.toLocaleString("en-IN") + " schemes · refreshed just now");
  }catch(e){
    if(st && !(FUNDS.length && quiet)){
      st.textContent = "Refresh failed (" + e.message + ") — using " +
        (FUNDS.length ? "the current list." : "nothing. Check your connection and retry.");
    }
  }
}
function searchFunds(){
  const q = fundState.query.trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const amc = fundState.amc;
  const out = [];
  for(const f of FUNDS){
    if(amc && f.amc !== amc) continue;
    if(words.length){
      const nl = f.n.toLowerCase();
      let ok = true;
      for(const w of words){ if(!nl.includes(w)){ ok=false; break; } }
      if(!ok) continue;
    }
    out.push(f);
    if(out.length >= 400) break;
  }
  return out;
}
function renderFundResults(){
  const box = document.getElementById("fundResults");
  if(!box) return;
  if(!fundState.query.trim() && !fundState.amc){
    box.innerHTML = '<div style="padding:12px" class="hint">Type to search 37,000+ schemes…</div>';
    return;
  }
  const res = searchFunds();
  if(!res.length){ box.innerHTML = '<div style="padding:12px" class="hint">No matching schemes. Try different search.</div>'; return; }
  box.innerHTML = `<div style="padding:8px 12px" class="hint">Showing ${res.length} of ${FUNDS.length.toLocaleString("en-IN")} matches — refine search to narrow down.</div>` +
    res.slice(0,200).map(f =>
      `<button data-code="${f.c}" data-name="${f.n.replace(/"/g,"&quot;")}">${f.n}<small>${f.amc} · Code ${f.c}</small></button>`
    ).join("");
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => selectFund(Number(b.dataset.code), b.dataset.name)));
}

/* ---------- NAV history ---------- */
let NAV = [];
let META = {};
let SCHEME = null;

async function selectFund(code, name){
  SCHEME = {code, name};
  document.getElementById("schemeCard").classList.remove("hidden");
  document.getElementById("schemeName").textContent = name;
  document.getElementById("schemeMeta").textContent = "Loading NAV history…";
  document.getElementById("resultsCard").classList.add("hidden");
  try{
    const r = await fetch(API_BASE + "/mf/" + code);
    if(!r.ok) throw new Error("HTTP " + r.status);
    const raw = await r.json();
    META = (raw && typeof raw.meta === "object") ? raw.meta : {};
    const rows = [];
    for(const it of (raw.data || [])){
      const ds = it.date || it.nav_date || it.Date;
      const ns = it.nav || it.close || it.NAV;
      if(!ds || !ns) continue;
      const nav = parseFloat(String(ns).replace(/,/g,"").trim());
      if(!isFinite(nav)) continue;
      let dt = null;
      const m1 = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(ds);
      const m2 = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ds);
      if(m1){ dt = new Date(Number(m1[3]), "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m1[2].toLowerCase())/3, Number(m1[1])); }
      else if(m2){ dt = new Date(Number(m2[3]), Number(m2[2])-1, Number(m2[1])); }
      if(dt && isFinite(dt)) rows.push({d:dt, nav});
    }
    rows.sort((a,b)=>a.d-b.d);
    NAV = rows;
    if(!NAV.length) throw new Error("empty NAV history");
    const fundHouse = META.fund_house || amcOf(name);
    let launch = META.launch_date || "";
    const lm = /^(\d{2})-([A-Za-z]{3}|\d{2})-(\d{4})$/.exec(launch);
    if(lm && /[A-Za-z]/.test(lm[2])) launch = `${lm[3]}-${String("janfebmaraprmayjunjulaugsepoctnovdec".indexOf(lm[2].toLowerCase())/3+1).padStart(2,"0")}-${lm[1]}`;
    else if(lm) launch = `${lm[3]}-${lm[2]}-${lm[1]}`;
    if(!launch) launch = fmtDate(NAV[0].d);
    const latest = NAV[NAV.length-1];
    document.getElementById("schemeMeta").innerHTML =
      `🏦 <b>Fund House:</b> ${fundHouse} &nbsp;·&nbsp; 📅 <b>Launch:</b> ${launch}<br>` +
      `Latest NAV (as on ${fmtDate(latest.d)}): <b>₹${latest.nav.toFixed(4)}</b> &nbsp;·&nbsp; ${NAV.length.toLocaleString("en-IN")} NAV records`;
    setupInputs();
  }catch(e){
    document.getElementById("schemeMeta").innerHTML = `<span style="color:var(--bad)">Failed to load NAV history: ${e.message}. Please try another scheme.</span>`;
    updateReadiness();
  }
}

function nearestPreviousNAV(target){
  let lo=0, hi=NAV.length-1, ans=-1;
  const t = target.getTime();
  while(lo<=hi){ const mid=(lo+hi)>>1; if(NAV[mid].d.getTime()<=t){ans=mid;lo=mid+1;} else hi=mid-1; }
  return ans<0 ? null : NAV[ans];
}

/* ---------- XIRR (Newton + bisection fallback) ---------- */
function xirr(cashflows){
  if(cashflows.length < 2) return null;
  const t0 = cashflows[0][0];
  const dates = cashflows.map(([d]) => (d - t0)/864e5/365.0);
  const amounts = cashflows.map(([,a]) => a);
  const npv  = r => { let s=0; for(let i=0;i<amounts.length;i++) s += amounts[i]/Math.pow(1+r, dates[i]); return s; };
  const dnpv = r => { let s=0; for(let i=0;i<amounts.length;i++) s += -amounts[i]*dates[i]/Math.pow(1+r, dates[i]+1); return s; };
  let guess = 0.05;
  for(let i=0;i<100;i++){
    const f = npv(guess), df = dnpv(guess);
    if(df === 0) break;
    const nw = guess - f/df;
    if(!isFinite(nw)) break;
    if(Math.abs(nw-guess) < 1e-6) return nw;
    guess = nw;
  }
  let lo = -0.9999, hi = 10.0, flo = npv(lo), fhi = npv(hi);
  if(!isFinite(flo) || !isFinite(fhi) || flo*fhi > 0) return null;
  for(let i=0;i<200;i++){
    const mid = (lo+hi)/2, fm = npv(mid);
    if(!isFinite(fm)) return null;
    if(flo*fm <= 0){ hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo+hi)/2;
}

/* ---------- inputs ---------- */
const touched = new Set();

/* ---------- sliders: two-way sync with number inputs; log=true for wide money ranges ---------- */
const SLIDERS = [];
function bindSlider(numId, sldId, o){
  const num = document.getElementById(numId), sld = document.getElementById(sldId);
  if(!num || !sld) return null;
  const min=o.min, max=o.max, step=o.step||1, log=!!o.log;
  const lmin=Math.log(min), lspan=Math.log(max)-lmin;
  const N = log ? 1000 : Math.max(1, Math.round((max-min)/step));
  sld.min=0; sld.max=N; sld.step=1;
  const toPos = v => {
    v = Number(v); if(!isFinite(v)) v = min;
    v = Math.min(max, Math.max(min, v));
    return log ? Math.round(N*(Math.log(v)-lmin)/lspan) : Math.round((v-min)/step);
  };
  const toVal = p => {
    let v = log ? Math.exp(lmin + (p/N)*lspan) : min + p*step;
    v = parseFloat((Math.round(v/step)*step).toFixed(8));
    return Math.min(max, Math.max(min, v));
  };
  const entry = {sync(){ sld.value = toPos(num.value); }};
  sld.addEventListener("input", () => {
    num.value = toVal(Number(sld.value));
    num.dispatchEvent(new Event("input", {bubbles:true}));
    maybeRerun();
  });
  num.addEventListener("input", entry.sync);
  entry.sync();
  SLIDERS.push(entry);
  return entry;
}
function syncAllSliders(){ SLIDERS.forEach(s => s.sync()); }

/* live re-run while dragging a slider, once results are already on screen */
let rerunTimer = null;
function maybeRerun(){
  const card = document.getElementById("resultsCard");
  if(!card || card.classList.contains("hidden")) return;
  if(document.getElementById("runBtn").disabled) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => runSimulation(true), 350);
}

/* ---------- metric count-up animation ---------- */
const FMT = {
  inr:  v => formatINR(v),
  int:  v => Math.round(v).toLocaleString("en-IN"),
  pct:  v => v.toFixed(2) + "%",
  gain: (g,i) => { const p = i ? g/i*100 : 0;
    return `${formatINR(g)} (${p>=0?"+":""}${p.toFixed(2)}%)`; }
};
function animateCount(el){
  const parts = String(el.dataset.raw).split("|").map(Number);
  const targ = parts[0], extra = parts[1];
  const fmt = FMT[el.dataset.fmt] || (v => String(v));
  const show = v => { el.textContent = fmt(v, extra); };
  if(!isFinite(targ)){ show(targ); return; }
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches){ show(targ); return; }
  const dur = 750, t0 = performance.now();
  (function frame(t){
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    show(targ * e);
    if(p < 1) requestAnimationFrame(frame); else show(targ);
  })(t0);
}
function playCounts(scope){ scope.querySelectorAll(".v[data-raw]").forEach(animateCount); }
function setupInputs(){
  const minD = NAV[0].d, maxD = NAV[NAV.length-1].d;
  const today = new Date(); today.setHours(0,0,0,0);
  const capMax = maxD < today ? maxD : today;
  const fiveY = new Date(today.getFullYear()-5, today.getMonth(), today.getDate());
  const defStart = minD > fiveY ? minD : fiveY;
  const set = (id, v) => { const el=document.getElementById(id); if(!touched.has(id)) el.value=v; };
  const lim = (id, mn, mx) => { const el=document.getElementById(id); el.min=fmtDate(mn); el.max=fmtDate(mx); };
  set("sipStart", fmtDate(defStart)); lim("sipStart", minD, today);
  set("sipEnd", fmtDate(capMax)); lim("sipEnd", minD, today);
  syncAllSliders();
  updateReadiness();
}

/* ---------- readiness gate ---------- */
function updateReadiness(){
  const box = document.getElementById("readiness");
  if(!box) return;
  const g = id => document.getElementById(id);
  const items = [];
  const fundOk = !!(SCHEME && NAV.length);
  items.push({ok: fundOk, label: fundOk ? `Scheme: ${SCHEME.name}` : "Pick a mutual fund scheme in Step 2"});
  const amt = parseFloat(g("sipAmt").value);
  items.push({ok: amt>=100, label: amt>=100 ? `SIP: ${formatINR(amt)} / month` : "Enter a monthly SIP amount (min ₹100)"});
  const day = parseInt(g("sipDay").value, 10);
  items.push({ok: day>=1 && day<=28, label: (day>=1 && day<=28) ? `SIP date: ${day}th of every month` : "Enter a SIP day between 1 and 28"});
  const sd = g("sipStart").value, ed = g("sipEnd").value;
  items.push({ok: !!sd, label: sd ? `SIP starts: ${sd}` : "Enter the SIP start date"});
  const endOk = !!ed && (!sd || parseDate(ed) >= parseDate(sd));
  items.push({ok: endOk, label: !ed ? "Enter the SIP end date" : (endOk ? `SIP ends: ${ed}` : "End date can't be before the start date")});
  const su = parseFloat(g("stepUp").value);
  items.push({ok: su>=0 && su<=100, label: (su>=0 && su<=100) ? `Step-up: ${su}% every year` : "Step-up must be between 0 and 100%"});
  const allOk = items.every(i=>i.ok);
  box.innerHTML = items.map(i =>
    `<div class="ready-item ${i.ok?"ok":"miss"}"><span class="ric">${i.ok?"✓":"○"}</span><span>${i.label}</span></div>`).join("");
  document.getElementById("runBtn").disabled = !allOk;
}

/* ---------- SIP simulation (mirrors the Streamlit page) ---------- */
function runSimulation(noscroll){
  const errBox = document.getElementById("simError");
  errBox.classList.add("hidden"); errBox.textContent = "";
  try{
    if(!NAV.length) throw new Error("NAV history is empty for this scheme — cannot simulate.");
    const sipAmt = parseFloat(document.getElementById("sipAmt").value);
    const sipDay = parseInt(document.getElementById("sipDay").value, 10);
    const start = parseDate(document.getElementById("sipStart").value);
    const end = parseDate(document.getElementById("sipEnd").value);
    const stepUp = parseFloat(document.getElementById("stepUp").value);
    if(!(sipAmt>=100)) throw new Error("Monthly SIP must be at least ₹100.");
    if(!(sipDay>=1 && sipDay<=28)) throw new Error("SIP day must be between 1 and 28.");
    if(end < start) throw new Error("End date can't be before the start date.");

    let units = 0, invested = 0;
    const cashflows = [];
    const rows = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while(cursor <= endMonth){
      const y = cursor.getFullYear(), m = cursor.getMonth();
      let invDate = new Date(y, m, Math.min(sipDay, daysInMonth(y, m)));
      if(invDate < start) invDate = new Date(start);
      if(invDate > end) break;
      const yearsDone = Math.floor((invDate - start)/864e5/365);
      const amount = sipAmt * Math.pow(1 + stepUp/100, yearsDone);
      const rec = nearestPreviousNAV(invDate);
      if(!rec) throw new Error("No NAV on or before " + fmtDate(invDate) + " — pick a later start date.");
      const bought = amount / rec.nav;
      units += bought; invested += amount;
      cashflows.push([invDate.getTime(), -amount]);
      rows.push({d:fmtDate(invDate), navDate:fmtDate(rec.d), nav:rec.nav, amt:amount,
                 bought, units, invested, value:units*rec.nav});
      cursor.setMonth(cursor.getMonth()+1);
    }
    if(!rows.length) throw new Error("No SIP instalments in this date range.");

    const latestNAV = NAV[NAV.length-1].nav;
    const latestNAVDate = NAV[NAV.length-1].d;
    const value = units * latestNAV;
    cashflows.push([latestNAVDate.getTime(), value]);
    const rate = xirr(cashflows);
    const gain = value - invested;
    renderResults({invested, value, gain, rate, n:rows.length, rows}, !!noscroll);
  }catch(e){
    errBox.textContent = e.message;
    errBox.classList.remove("hidden");
    errBox.scrollIntoView({behavior:"smooth", block:"center"});
  }
}

/* ---------- results ---------- */
let chartObj = null;
let schedRows = [], schedPage = 0;
const SCHED_PAGE_SIZE = 15;

function metric(label, raw, fmt, cls){
  return `<div class="metric"><div class="k">${label}</div><div class="v ${cls||""}" data-raw="${raw}" data-fmt="${fmt}">${FMT[fmt](...String(raw).split("|").map(Number))}</div></div>`;
}
function renderResults(r, noscroll){
  const card = document.getElementById("resultsCard");
  card.classList.remove("hidden");
  card.classList.remove("rise"); void card.offsetWidth; card.classList.add("rise");
  const m = document.getElementById("metrics");
  const xirrHtml = r.rate==null
    ? `<div class="metric"><div class="k">XIRR</div><div class="v">n/a</div></div>`
    : metric("XIRR", (r.rate*100).toFixed(6), "pct");
  m.innerHTML =
    metric("Total invested", r.invested, "inr") +
    metric("Current value", r.value, "inr") +
    metric("Gain / Loss", r.gain + "|" + r.invested, "gain", r.gain>=0?"good":"neg") +
    xirrHtml +
    metric("Instalments", r.n, "int");
  playCounts(m);
  schedRows = r.rows; schedPage = 0;
  document.getElementById("schedNote").textContent =
    `${r.n} monthly instalments · valued at the latest NAV (${fmtDate(NAV[NAV.length-1].d)})`;
  renderSchedPage();
  document.getElementById("schedPager").classList.toggle("hidden", r.rows.length <= SCHED_PAGE_SIZE);
  drawChart(r.rows);
  document.getElementById("resultsCard").classList.remove("hidden");
  if(!noscroll) document.getElementById("resultsCard").scrollIntoView({behavior:"smooth"});
}
function renderSchedPage(){
  const tb = document.getElementById("schedBody");
  const total = schedRows.length;
  const pages = Math.max(1, Math.ceil(total/SCHED_PAGE_SIZE));
  schedPage = Math.min(Math.max(0, schedPage), pages-1);
  const slice = schedRows.slice(schedPage*SCHED_PAGE_SIZE, (schedPage+1)*SCHED_PAGE_SIZE);
  tb.innerHTML = slice.map(x =>
    `<tr><td>${x.d}</td><td>${x.navDate}</td><td>₹${x.nav.toFixed(4)}</td><td>${formatINR(x.amt)}</td>` +
    `<td>${x.bought.toFixed(3)}</td><td>${x.units.toFixed(3)}</td><td>${formatINR(x.invested)}</td></tr>`).join("");
  document.getElementById("pgInfo").textContent = `Page ${schedPage+1} of ${pages} · ${total} instalments`;
}
function drawChart(rows){
  const cv = document.getElementById("chart");
  if(!cv || typeof Chart === "undefined") return;
  if(chartObj) chartObj.destroy();
  const dark = rootEl.getAttribute("data-theme")==="dark";
  const grid = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";
  const tick = dark ? "#c9c9d4" : "#555";
  chartObj = new Chart(cv, {
    type:"line",
    data:{ labels: rows.map(x=>x.d),
      datasets:[
        {label:"Invested (cumulative)", data:rows.map(x=>+x.invested.toFixed(2)),
         borderColor:"#3E9B4F", backgroundColor:"rgba(62,155,79,.12)", fill:true, tension:.25, pointRadius:0},
        {label:"Portfolio value", data:rows.map(x=>+x.value.toFixed(2)),
         borderColor:"#E07F36", backgroundColor:"rgba(224,127,54,.12)", fill:true, tension:.25, pointRadius:0}
      ]},
    options:{ responsive:true, maintainAspectRatio:false,
      animation:{duration:900, easing:"easeOutQuart"},
      plugins:{ legend:{labels:{color:tick}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${formatINR(c.parsed.y)}`}} },
      scales:{ x:{ticks:{color:tick, maxTicksLimit:8}, grid:{color:grid}},
               y:{ticks:{color:tick, callback:v=>formatINR(v)}, grid:{color:grid}} } }
  });
}
function downloadCSV(){
  if(!schedRows.length) return;
  const head = "SIP date,NAV date used,NAV (Rs),Invested (Rs),Units bought,Total units,Invested so far (Rs)\n";
  const body = schedRows.map(x =>
    [x.d, x.navDate, x.nav.toFixed(4), x.amt.toFixed(2), x.bought.toFixed(4), x.units.toFixed(4), x.invested.toFixed(2)].join(",")).join("\n");
  const blob = new Blob([head+body], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sip-schedule-" + (SCHEME ? SCHEME.code : "fund") + ".csv";
  a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- wiring ---------- */
function init(){
  ["sipAmt","sipDay","sipStart","sipEnd","stepUp"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => { touched.add(id); updateReadiness(); });
    el.addEventListener("change", () => { touched.add(id); updateReadiness(); });
  });
  document.getElementById("sipAmt").addEventListener("input", e => {
    const v = parseFloat(e.target.value);
    document.getElementById("sipAmtHint").textContent = v>0 ? formatINR(v)+" per month" : "";
  });
  const fs = document.getElementById("fundSearch");
  let deb = null;
  fs.addEventListener("input", () => {
    fundState.query = fs.value; fundState.amc = document.getElementById("amcFilter").value;
    clearTimeout(deb); deb = setTimeout(renderFundResults, 180);
  });
  document.getElementById("amcFilter").addEventListener("change", e => {
    fundState.amc = e.target.value; fundState.query = fs.value; renderFundResults();
  });
  document.getElementById("quickPicks").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if(!b) return;
    fs.value = b.dataset.q; fundState.query = b.dataset.q;
    fundState.amc = ""; document.getElementById("amcFilter").value = "";
    renderFundResults();
    // auto-pick the top match for one-tap convenience
    const res = searchFunds();
    if(res.length) selectFund(res[0].c, res[0].n);
  });
  document.getElementById("runBtn").addEventListener("click", runSimulation);
  document.getElementById("pgPrev").addEventListener("click", () => { schedPage--; renderSchedPage(); });
  document.getElementById("pgNext").addEventListener("click", () => { schedPage++; renderSchedPage(); });
  document.getElementById("csvBtn").addEventListener("click", downloadCSV);
  // smart dynamic defaults so the form is useful before any fund is picked
  // (fund selection later snaps untouched dates to that fund's history)
  const _t = new Date(); _t.setHours(0,0,0,0);
  const _fiveY = new Date(_t.getFullYear()-5, _t.getMonth(), _t.getDate());
  const _pre = (id, d) => { const el = document.getElementById(id); if(!el.value) el.value = fmtDate(d); };
  _pre("sipStart", _fiveY);
  _pre("sipEnd", _t);
  // sliders (log-scale for the wide money range; high upper limit)
  bindSlider("sipAmt","sipAmtSld",{min:500,max:10000000,step:100,log:true});
  bindSlider("sipDay","sipDaySld",{min:1,max:28,step:1});
  bindSlider("stepUp","stepUpSld",{min:0,max:100,step:0.5});
  loadFundList();
  updateReadiness();
}
document.addEventListener("DOMContentLoaded", init);
