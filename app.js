/* SWP Calculator — static port of the Streamlit app. Data: api.mfapi.in (CORS-enabled). */
"use strict";
const API_BASE = "https://api.mfapi.in";
/* PAWAN: paste your AdSense publisher ID here after approval, e.g. "ca-pub-1234567890123456" */
const ADSENSE_CLIENT = "ca-pub-6679021817940576";

/* ---------- theme ---------- */
const rootEl = document.documentElement;
function paintThemeBtn(){ const t=rootEl.getAttribute("data-theme");
  const k=document.getElementById("themeKnob"), n=document.getElementById("themeName");
  if(k) k.innerHTML = t === "light" ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  if(n) n.textContent = t==="light" ? "Dark" : "Light"; }
function setTheme(t){ rootEl.setAttribute("data-theme", t); try{localStorage.setItem("swp-theme",t);}catch(e){} paintThemeBtn(); }
setTheme((()=>{try{return localStorage.getItem("swp-theme")||"light";}catch(e){return "light";}})());

/* ---------- INR formatting (₹10K / ₹5.2L / ₹3.1Cr), faithful to the Python app ---------- */
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

/* ---------- date math matching Python relativedelta (clamps month-ends) ---------- */
function addMonths(d, n){
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth()+n, 1);
  const last = new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();
  t.setDate(Math.min(day, last)); return t;
}
function addYears(d, n){
  const t = new Date(d.getFullYear()+n, d.getMonth(), 1);
  const last = new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last)); return t;
}
/* Withdrawal schedule generator — mirrors generate_withdrawal_dates() in the Python app.
   Dates are anchored at the start date (no month-end drift) and the end date is
   inclusive with no overshoot. */
function generateWithdrawalDates(startDate, freq, endDate, maxIter){
  maxIter = maxIter || 10000;
  const dates = [];
  const nth = k => freq==="Monthly" ? addMonths(startDate,k)
    : freq==="Quarterly" ? addMonths(startDate,3*k)
    : freq==="Yearly" ? addYears(startDate,k)
    : freq==="Days:7 (Weekly)" ? new Date(startDate.getTime()+k*7*864e5)
    : freq==="Days:15" ? new Date(startDate.getTime()+k*15*864e5) : null;
  if(!nth(0)) return dates;
  for(let k=0; k<maxIter; k++){
    const cur = nth(k);
    if(endDate && cur > endDate) break;
    dates.push(cur);
  }
  return dates;
}

/* ---------- fund list ---------- */
let FUNDS = [];      // {c: schemeCode, n: schemeName, amc}
let AMC_LIST = [];
const fundState = { query:"", amc:"", selected:null };

/* Canonical fund-house names from the scheme name’s leading brand prefix
   (the bulk scheme list carries no AMC field). Longest-prefix-first match.
   Historical renames merged: Reliance->Nippon India, IDFC->Bandhan,
   Birla Sun Life->Aditya Birla Sun Life. */
const AMC_NAMES = {
  "360": "360 ONE",
  "ABAKKUS": "Abakkus",
  "ABN": "ABN Amro",
  "ABN AMRO": "ABN Amro",
  "ADITYA": "Aditya Birla Sun Life",
  "ADITYA BIRLA": "Aditya Birla Sun Life",
  "AIG": "AIG",
  "ALPHAGREP": "Alphagrep",
  "AMRO": "ABN Amro",
  "ANARA ROBECO": "Canara Robeco",
  "ANGEL": "Angel One",
  "ASK": "ASK",
  "AXIS": "Axis",
  "BAJAJ": "Bajaj Finserv",
  "BANDHAN": "Bandhan",
  "BANK": "Nippon India",
  "BANK OF INDIA": "Bank of India",
  "BARODA": "Baroda BNP Paribas",
  "BARODA BNP": "Baroda BNP Paribas",
  "BARODA PIONEER": "Baroda BNP Paribas",
  "BENCHMARK": "Benchmark",
  "BHARAT 22": "ICICI Prudential",
  "BHARAT BOND": "Edelweiss",
  "BHARTI AXA": "Bharti AXA",
  "BIRLA": "Aditya Birla Sun Life",
  "BIRLA SUN": "Aditya Birla Sun Life",
  "BNP": "BNP Paribas",
  "BNP PARIBAS": "BNP Paribas",
  "BOB": "Baroda BNP Paribas",
  "BOI": "BOI AXA",
  "BOI AXA": "BOI AXA",
  "BSL": "Aditya Birla Sun Life",
  "BSL COMM": "Aditya Birla Sun Life",
  "CAN D": "Canara Robeco",
  "CANARA": "Canara Robeco",
  "CANARA ROBECO": "Canara Robeco",
  "CANFIXED": "Canara Robeco",
  "CANGROWTH": "Canara Robeco",
  "CAPITALMIND": "Capitalmind",
  "CHOICE": "Choice",
  "CPSE": "Nippon India",
  "DAIWA": "Daiwa",
  "DBS": "DBS",
  "DHFL": "DHFL Pramerica",
  "DHFL PRAMERICA": "DHFL Pramerica",
  "DSP": "DSP",
  "DWS": "DWS",
  "EDELWEISS": "Edelweiss",
  "ESCORTS": "Escorts",
  "ESSEL": "Essel",
  "FIDELITY": "Fidelity",
  "FORTIS": "Fortis",
  "FRANKLIN": "Franklin Templeton",
  "FRANKLIN INDIA": "Franklin Templeton",
  "FRANKLIN TEMPLETON": "Franklin Templeton",
  "FT INDIA": "Franklin Templeton",
  "GCF": "Standard Chartered",
  "GFRF": "Standard Chartered",
  "GOLD": "Nippon India",
  "GOLDMAN": "Goldman Sachs",
  "GOLDMAN SACHS": "Goldman Sachs",
  "GRINDAYS": "Standard Chartered",
  "GRINDLAYS": "Standard Chartered",
  "GROWW": "Groww",
  "GSSIF": "Standard Chartered",
  "HANG": "Nippon India",
  "HDFC": "HDFC",
  "HELIOS": "Helios",
  "HSBC": "HSBC",
  "ICICI": "ICICI Prudential",
  "ICICI PRUDENTIAL": "ICICI Prudential",
  "IDBI": "IDBI",
  "IDFC": "Bandhan",
  "IIFCL": "IIFCL",
  "IIFL": "IIFL",
  "IL&FS": "IL&FS",
  "INDIABULLS": "Indiabulls",
  "INFRASTRUCTURE": "Nippon India",
  "ING": "ING",
  "INVESCO": "Invesco",
  "ITI": "ITI",
  "JIOBLACKROCK": "JioBlackRock",
  "JM": "JM Financial",
  "JM FINANCIAL": "JM Financial",
  "JM FMF": "JM Financial",
  "JPMORGAN": "JPMorgan",
  "KOTAK": "Kotak",
  "KOTKA": "Kotak",
  "L&T": "L&T",
  "LAKSHYA": "Lakshya",
  "LIC": "LIC",
  "LICMF": "LIC",
  "LOTUS INDIA": "Lotus India",
  "MAHINDRA": "Mahindra Manulife",
  "MAHINDRA MANULIFE": "Mahindra Manulife",
  "MAHINDRAMANULIFE": "Mahindra Manulife",
  "MIRAE": "Mirae Asset",
  "MIRAE ASSET": "Mirae Asset",
  "MOF30": "Motilal Oswal",
  "MONARCH": "Monarch",
  "MORGAN": "Morgan Stanley",
  "MORGAN STANLEY": "Morgan Stanley",
  "MOST": "Motilal Oswal",
  "MOTILAL": "Motilal Oswal",
  "MOTILAL OSWAL": "Motilal Oswal",
  "NAVI": "Navi",
  "NIFTY": "Nippon India",
  "NIPPON": "Nippon India",
  "NIPPON INDIA": "Nippon India",
  "NJ": "NJ",
  "OLD BRIDGE": "Old Bridge",
  "OLD-SBI": "SBI",
  "OTAK": "Kotak",
  "PARAG PARIKH": "Parag Parikh",
  "PEERLESS": "Peerless",
  "PGIM": "PGIM India",
  "PINEBRIDGE": "PineBridge",
  "PRAMERICA": "DHFL Pramerica",
  "PRINCIPAL": "Principal",
  "PRINCIPAL PNB": "Principal",
  "PSU": "Nippon India",
  "QUANT": "Quant",
  "QUANTUM": "Quantum",
  "R*SHARES": "Nippon India",
  "RAMERICA": "DHFL Pramerica",
  "REDEEMED-SBI": "SBI",
  "RELIANCE": "Nippon India",
  "RELIGARE": "Religare",
  "RELIGARE INVESCO": "Invesco",
  "RINCIPAL": "Principal",
  "SAHARA": "Sahara",
  "SAHARATAX": "Sahara",
  "SAMCO": "Samco",
  "SBI": "SBI",
  "SCFMP": "Standard Chartered",
  "SHARIAH": "Nippon India",
  "SHINSEI": "Daiwa",
  "SHRIRAM": "Shriram",
  "STANDARD CHARTERED": "Standard Chartered",
  "SUNDARAM": "Sundaram",
  "TARUS": "Tata",
  "TATA": "Tata",
  "TAURUS": "Taurus",
  "TEMPLETON": "Franklin Templeton",
  "TFMP": "Franklin Templeton",
  "THE WEALTH COMPANY": "The Wealth Company",
  "TRUST": "Trust",
  "TRUSTMF": "Trust",
  "UNIFI": "Unifi",
  "UNION": "Union",
  "UNION KBC": "Union",
  "UTI": "UTI",
  "WHITEOAK": "WhiteOak",
  "YES": "Yes",
  "Z-OLD-SBI": "SBI",
  "Z-REDEEMED-SBI": "SBI",
  "ZERODHA": "Zerodha",
};
const AMC_KEYS = Object.keys(AMC_NAMES).sort((a,b)=>b.length-a.length);
function amcOf(name){
  const up = String(name||"").trim().toUpperCase();
  for(let i=0;i<AMC_KEYS.length;i++){ if(up.startsWith(AMC_KEYS[i])) return AMC_NAMES[AMC_KEYS[i]]; }
  return "Other";
}

async function loadFundList(){
  const status = document.getElementById("fundStatus");
  // 1) try bundled snapshot (fast, offline-safe)
  try{
    const r = await fetch("/data/funds.json", {cache:"force-cache"});
    if(r.ok){
      const j = await r.json();
      setFunds(j.funds, j.count.toLocaleString("en-IN") + " schemes · updated " + (j.updated||""));
    }
  }catch(e){ /* fall through to live fetch */ }
  // 2) refresh live in background, cache in localStorage
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
  AMC_LIST = amcs;
  const sel = document.getElementById("amcFilter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">All AMCs</option>' + amcs.map(a=>`<option value="${a}">${a}</option>`).join("");
  sel.value = cur && amcs.includes(cur) ? cur : "";
  const st = document.getElementById("fundStatus");
  if(st) st.textContent = note || (FUNDS.length.toLocaleString("en-IN") + " schemes loaded");
  renderFundResults();
}
async function refreshFundList(quiet){
  const btn = document.getElementById("refreshFunds");
  const st = document.getElementById("fundStatus");
  try{
    if(btn) btn.disabled = true;
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
  }finally{ if(btn) btn.disabled = false; }
}

/* search: every word in the query must appear in the scheme name (case-insensitive) */
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
  const total = fundState.query || fundState.amc ? res.length : FUNDS.length;
  box.innerHTML = `<div style="padding:8px 12px" class="hint">Showing ${res.length} of ${total.toLocaleString("en-IN")} matches — refine search to narrow down.</div>` +
    res.slice(0,200).map(f =>
      `<button data-code="${f.c}" data-name="${f.n.replace(/"/g,"&quot;")}">${f.n}<small>${f.amc} · Code ${f.c}</small></button>`
    ).join("");
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => selectFund(Number(b.dataset.code), b.dataset.name)));
}

/* ---------- NAV history ---------- */
let NAV = [];   // [{d: Date, nav: number}] ascending
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
      `<b>Fund House:</b> ${fundHouse} &nbsp;·&nbsp; <b>Launch:</b> ${launch}<br>` +
      `Latest NAV (as on ${fmtDate(latest.d)}): <b>₹${latest.nav.toFixed(4)}</b> &nbsp;·&nbsp; ${NAV.length.toLocaleString("en-IN")} NAV records`;
    setupInputs();
  }catch(e){
    document.getElementById("schemeMeta").innerHTML = `<span style="color:var(--bad)">Failed to load NAV history: ${e.message}. Please try another scheme.</span>`;
    updateReadiness();
  }
}

/* nearest previous NAV via binary search (same semantics as the Python app) */
function nearestPreviousNAV(target){
  let lo=0, hi=NAV.length-1, ans=-1;
  const t = target.getTime();
  while(lo<=hi){ const mid=(lo+hi)>>1; if(NAV[mid].d.getTime()<=t){ans=mid;lo=mid+1;} else hi=mid-1; }
  return ans<0 ? null : NAV[ans];
}

/* ---------- XIRR (Newton's method — same as the Python app, plus a bisection fallback) ---------- */
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
  // Newton failed (e.g. negative root) — fall back to bisection, which always brackets.
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
const touched = new Set();   // input ids the user has edited (never overwritten by fund defaults)

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
  nav4: v => "₹" + v.toFixed(4),
  num4: v => v.toLocaleString("en-IN",{maximumFractionDigits:4}),
  int:  v => Math.round(v).toLocaleString("en-IN"),
  pct:  v => v.toFixed(2) + "%"
};
function animateCount(el){
  const raw = parseFloat(el.dataset.raw);
  const fmt = FMT[el.dataset.fmt] || (v => String(v));
  if(!isFinite(raw)){ el.textContent = fmt(0); return; }
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches){ el.textContent = fmt(raw); return; }
  const dur = 750, t0 = performance.now();
  (function frame(t){
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(raw * e);
    if(p < 1) requestAnimationFrame(frame); else el.textContent = fmt(raw);
  })(t0);
}
function playCounts(scope){ scope.querySelectorAll(".v[data-raw]").forEach(animateCount); }

/* ---------- custom calendar popup for date fields ---------- */
const CAL_MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
let calPop = null, calOverlay = null, calFor = null, calView = {y:0, m:0};

function calBounds(input){
  const p = s => s ? parseDate(s) : null;
  return [p(input.min), p(input.max)];
}
function ensureCal(){
  if(calPop) return;
  calOverlay = document.createElement("div");
  calOverlay.className = "cal-overlay hidden";
  calOverlay.addEventListener("click", closeCal);
  calPop = document.createElement("div");
  calPop.className = "cal-pop hidden";
  calPop.setAttribute("role", "dialog");
  calPop.setAttribute("aria-label", "Choose a date");
  calPop.innerHTML =
    '<div class="cal-head"><button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month">‹</button>' +
    '<select class="cal-month" aria-label="Month"></select>' +
    '<select class="cal-year" aria-label="Year"></select>' +
    '<button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button></div>' +
    '<div class="cal-grid"></div>' +
    '<div class="cal-foot"><button type="button" class="chip" data-act="today">Today</button>' +
    '<button type="button" class="chip" data-act="close">Done</button></div>';
  document.body.appendChild(calOverlay);
  document.body.appendChild(calPop);
  calPop.querySelectorAll(".cal-nav").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation(); stepCal(parseInt(b.dataset.nav, 10));
  }));
  calPop.querySelector(".cal-month").addEventListener("change", e => { calView.m = parseInt(e.target.value,10); renderCal(); });
  calPop.querySelector(".cal-year").addEventListener("change", e => { calView.y = parseInt(e.target.value,10); renderCal(); });
  calPop.querySelector('[data-act="today"]').addEventListener("click", e => {
    e.stopPropagation();
    const t = new Date(); t.setHours(0,0,0,0);
    pickCalDate(t);
  });
  calPop.querySelector('[data-act="close"]').addEventListener("click", e => { e.stopPropagation(); closeCal(); });
  calPop.querySelector(".cal-grid").addEventListener("click", e => {
    const b = e.target.closest(".cal-day");
    if(!b || b.disabled) return;
    e.stopPropagation();
    pickCalDate(new Date(calView.y, calView.m, parseInt(b.dataset.day,10)));
  });
  document.addEventListener("click", e => {
    if(calPop && !calPop.classList.contains("hidden") &&
       !calPop.contains(e.target) && !e.target.closest(".datewrap")) closeCal();
  });
  document.addEventListener("keydown", e => { if(e.key === "Escape") closeCal(); });
}
function stepCal(d){
  let y = calView.y, m = calView.m + d;
  while(m < 0){ m += 12; y--; }
  while(m > 11){ m -= 12; y++; }
  const [mn, mx] = calBounds(calFor);
  const y0 = mn ? mn.getFullYear() : y - 50, y1 = mx ? mx.getFullYear() : y + 50;
  calView = {y: Math.min(y1, Math.max(y0, y)), m};
  renderCal();
}
function pickCalDate(d){
  d.setHours(0,0,0,0);
  const [mn, mx] = calBounds(calFor);
  if(mn && d < mn) d = new Date(mn);
  if(mx && d > mx) d = new Date(mx);
  const input = calFor;
  input.value = fmtDate(d);
  input.dispatchEvent(new Event("input", {bubbles:true}));
  input.dispatchEvent(new Event("change", {bubbles:true}));
  closeCal();
  try{ input.focus({preventScroll:true}); }catch(e){ input.focus(); }
}
function openCal(input){
  ensureCal();
  calFor = input;
  const [mn, mx] = calBounds(input);
  let d = input.value ? parseDate(input.value) : new Date();
  if(mn && d < mn) d = new Date(mn);
  if(mx && d > mx) d = new Date(mx);
  calView = {y: d.getFullYear(), m: d.getMonth()};
  renderCal();
  const modal = window.innerWidth <= 720;
  calPop.classList.toggle("center", modal);
  calOverlay.classList.toggle("hidden", !modal);
  calPop.classList.remove("hidden");
  if(!modal){
    const r = input.getBoundingClientRect();
    const pw = 302, ph = 350;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if(top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    calPop.style.left = left + "px";
    calPop.style.top = top + "px";
  }else{
    calPop.style.left = ""; calPop.style.top = "";
  }
}
function closeCal(){
  if(!calPop) return;
  calPop.classList.add("hidden");
  if(calOverlay) calOverlay.classList.add("hidden");
  calFor = null;
}
function renderCal(){
  if(!calFor) return;
  const [mn, mx] = calBounds(calFor);
  const {y, m} = calView;
  const mSel = calPop.querySelector(".cal-month"), ySel = calPop.querySelector(".cal-year");
  mSel.innerHTML = CAL_MONTHS.map((n,i) => `<option value="${i}"${i===m?" selected":""}>${n}</option>`).join("");
  const y0 = mn ? mn.getFullYear() : y - 30, y1 = mx ? mx.getFullYear() : y + 30;
  let opts = "";
  for(let yy = y0; yy <= y1; yy++) opts += `<option value="${yy}"${yy===y?" selected":""}>${yy}</option>`;
  ySel.innerHTML = opts;
  const today = new Date(); today.setHours(0,0,0,0);
  const sel = calFor.value ? parseDate(calFor.value) : null;
  let html = ["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => `<div class="dow">${d}</div>`).join("");
  const first = new Date(y, m, 1).getDay();
  const ndays = new Date(y, m+1, 0).getDate();
  for(let i = 0; i < first; i++) html += "<div></div>";
  for(let d = 1; d <= ndays; d++){
    const dt = new Date(y, m, d); dt.setHours(0,0,0,0);
    const dis = (mn && dt < mn) || (mx && dt > mx);
    const cls = ["cal-day"];
    if(dt.getTime() === today.getTime()) cls.push("today");
    if(sel && dt.getTime() === sel.getTime()) cls.push("sel");
    html += `<button type="button" class="${cls.join(" ")}" data-day="${d}"${dis?" disabled":""}>${d}</button>`;
  }
  calPop.querySelector(".cal-grid").innerHTML = html;
}
/* wrap a date input with a calendar trigger button */
function initDatePicker(id){
  const el = document.getElementById(id);
  if(!el || el.closest(".datewrap")) return;
  const wrap = document.createElement("div");
  wrap.className = "datewrap";
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "calbtn";
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  btn.setAttribute("aria-label", "Pick a date from the calendar");
  btn.addEventListener("click", e => { e.stopPropagation(); openCal(el); });
  wrap.appendChild(btn);
  el.addEventListener("click", () => openCal(el));
}
function setupInputs(){
  const minD = NAV[0].d, maxD = NAV[NAV.length-1].d;
  const today = new Date(); today.setHours(0,0,0,0);
  const capMax = maxD < today ? maxD : today;
  const set = (id, v) => { const el=document.getElementById(id); if(!touched.has(id)) el.value=v; };
  const lim = (id, mn, mx) => { const el=document.getElementById(id); el.min=fmtDate(mn); el.max=fmtDate(mx); };
  set("lumpsumDate", fmtDate(minD)); lim("lumpsumDate", minD, today);
  const swpStart = addMonths(minD < today ? minD : today, 12);
  set("swpStart", fmtDate(swpStart > today ? today : swpStart)); lim("swpStart", minD, today);
  set("swpEnd", fmtDate(capMax)); lim("swpEnd", minD, today);
  syncSwpMin();
  toggleSwpMode(); toggleEndMode();
  syncAllSliders();
  updateReadiness();
}
function syncSwpMin(){
  if(!NAV.length) return;
  const lv = document.getElementById("lumpsumDate").value;
  const l = lv ? parseDate(lv) : NAV[0].d;
  const s = document.getElementById("swpStart"), e = document.getElementById("swpEnd");
  s.min = fmtDate(l);
  if(s.value && parseDate(s.value) < l) s.value = fmtDate(l);
  if(s.value) e.min = s.value;
}
function toggleSwpMode(){
  const fixed = document.querySelector('input[name="swpMode"]:checked').value === "fixed";
  document.getElementById("fixedWrap").classList.toggle("hidden", !fixed);
  document.getElementById("pctWrap").classList.toggle("hidden", fixed);
}
function toggleEndMode(){
  const byDate = document.querySelector('input[name="endMode"]:checked').value === "date";
  document.getElementById("endDateWrap").classList.toggle("hidden", !byDate);
  document.getElementById("endCountWrap").classList.toggle("hidden", byDate);
}

/* ---------- readiness gate: nothing runs until every mandatory input is confirmed ---------- */
function updateReadiness(){
  const box = document.getElementById("readiness");
  if(!box) return;
  const g = id => document.getElementById(id);
  const items = [];
  const fundOk = !!(SCHEME && NAV.length);
  items.push({ok: fundOk, label: fundOk ? `Scheme: ${SCHEME.name}` : "Pick a mutual fund scheme in Step 2"});
  const lumpsum = parseFloat(g("lumpsumAmt").value);
  items.push({ok: lumpsum>0, label: lumpsum>0 ? `Corpus: ${formatINR(lumpsum)}` : "Enter your lumpsum corpus amount (₹)"});
  const ld = g("lumpsumDate").value, sd = g("swpStart").value;
  items.push({ok: !!ld, label: ld ? `Invested on: ${ld}` : "Enter the lumpsum (investment) date"});
  const startBad = ld && sd && parseDate(sd) < parseDate(ld);
  items.push({ok: !!sd && !startBad,
    label: !sd ? "Enter the SWP start date" : (startBad ? "SWP start can't be before the lumpsum date" : `SWP starts: ${sd}`)});
  const mode = document.querySelector('input[name="swpMode"]:checked').value;
  if(mode === "fixed"){
    const a = parseFloat(g("swpAmt").value);
    items.push({ok: a>0, label: a>0 ? `Withdrawal: ${formatINR(a)} per event` : "Enter the withdrawal amount per event"});
  }else{
    const pc = parseFloat(g("swpPct").value);
    items.push({ok: pc>0 && pc<=100, label: (pc>0 && pc<=100) ? `Withdrawal: ${pc}% of balance per event` : "Enter a withdrawal % between 0 and 100"});
  }
  const endMode = document.querySelector('input[name="endMode"]:checked').value;
  if(endMode === "date"){
    const ed = g("swpEnd").value;
    const ok = !!ed && (!sd || parseDate(ed) >= parseDate(sd));
    items.push({ok, label: !ed ? "Enter the SWP end date" : (ok ? `SWP ends: ${ed}` : "End date can't be before the start date")});
  }else{
    const n = parseInt(g("swpCount").value, 10);
    items.push({ok: n>=1, label: n>=1 ? `${n} withdrawal${n>1?"s":""} planned` : "Enter the number of withdrawals (≥ 1)"});
  }
  const allOk = items.every(i=>i.ok);
  box.innerHTML = items.map(i =>
    `<div class="ready-item ${i.ok?"ok":"miss"}"><span class="ric">${i.ok?"✓":"○"}</span><span>${i.label}</span></div>`).join("");
  document.getElementById("runBtn").disabled = !allOk;
}

/* ---------- simulation (faithful port of the run_sim block) ---------- */
function runSimulation(noscroll){
  const errBox = document.getElementById("simError");
  errBox.classList.add("hidden"); errBox.textContent = "";
  try{
    if(!NAV.length) throw new Error("NAV history is empty for this scheme — cannot simulate.");
    const lumpsum = parseFloat(document.getElementById("lumpsumAmt").value);
    const lumpsumDate = parseDate(document.getElementById("lumpsumDate").value);
    const swpStart = parseDate(document.getElementById("swpStart").value);
    const mode = document.querySelector('input[name="swpMode"]:checked').value;
    const swpAmt = parseFloat(document.getElementById("swpAmt").value);
    const swpPct = parseFloat(document.getElementById("swpPct").value);
    const freq = document.getElementById("freq").value;
    const endMode = document.querySelector('input[name="endMode"]:checked').value;
    const endDate = endMode==="date" ? parseDate(document.getElementById("swpEnd").value) : null;
    const maxW = endMode==="count" ? parseInt(document.getElementById("swpCount").value,10) : null;

    if(!(lumpsum>0)) throw new Error("Enter a lumpsum amount greater than zero.");
    if(mode==="fixed" && !(swpAmt>0)) throw new Error("Enter a withdrawal amount greater than zero.");
    if(mode==="pct" && !(swpPct>0 && swpPct<=100)) throw new Error("Withdrawal percent must be between 0 and 100.");
    if(swpStart < lumpsumDate) throw new Error("SWP start date cannot be before the lumpsum date.");

    const lrec = nearestPreviousNAV(lumpsumDate);
    if(!lrec) throw new Error("No NAV on or before the lumpsum date — pick a later date.");
    const lumpsumNAV = lrec.nav;
    let units = lumpsum / lumpsumNAV;
    const initialUnits = units;
    let totalWithdrawn = 0, done = 0;
    const cashflows = [[lumpsumDate.getTime(), -lumpsum]];
    const rows = [];

    const dates = generateWithdrawalDates(swpStart, freq, endDate);
    for(const wd of dates){
      if(maxW!=null && done>=maxW) break;
      const rec = nearestPreviousNAV(wd);
      if(!rec) continue;
      const nav = rec.nav;
      const balVal = units*nav;
      if(balVal <= 0) break;
      let amt = mode==="fixed" ? swpAmt : balVal*(swpPct/100);
      let sold, cash, finished;
      if(amt >= balVal - 1e-6){ sold=units; cash=balVal; units=0; finished=true; }
      else { sold=amt/nav; units-=sold; cash=amt; finished=false; }
      totalWithdrawn += cash; done++;
      cashflows.push([wd.getTime(), cash]);
      rows.push({wd:fmtDate(wd), navDate:fmtDate(rec.d), nav, sold, rem:units, cash, bal:units*nav});
      if(finished) break;
    }

    const latestNAV = NAV[NAV.length-1].nav;
    const latestNAVDate = NAV[NAV.length-1].d;
    const remainingValue = units * latestNAV;
    // Terminal value: units still held are worth remainingValue at the latest NAV.
    // Including it makes XIRR the true return of the whole plan. (Testing showed the
    // original app omitted it, which made XIRR meaningless for non-depleting SWPs.)
    if(remainingValue > 0) cashflows.push([latestNAVDate.getTime(), remainingValue]);
    const rate = xirr(cashflows);
    renderResults({lumpsum, lumpsumNAV, initialUnits, totalWithdrawn, remainingValue, done, rate, rows}, !!noscroll);
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
let whatifTimer = null;

function renderSchedPage(){
  const tb = document.getElementById("schedBody");
  const total = schedRows.length;
  const pages = Math.max(1, Math.ceil(total / SCHED_PAGE_SIZE));
  schedPage = Math.min(Math.max(0, schedPage), pages-1);
  const start = schedPage * SCHED_PAGE_SIZE;
  const slice = schedRows.slice(start, start + SCHED_PAGE_SIZE);
  tb.innerHTML = slice.map(x =>
    `<tr><td>${x.wd}</td><td>${x.navDate}</td><td>₹${x.nav.toFixed(4)}</td>` +
    `<td>${x.sold.toFixed(4)}</td><td>${x.rem.toFixed(4)}</td>` +
    `<td>${formatINR(x.cash)}</td><td>${formatINR(x.bal)}</td></tr>`).join("");
  const pager = document.getElementById("schedPager");
  pager.classList.toggle("hidden", total <= SCHED_PAGE_SIZE);
  document.getElementById("pgInfo").textContent =
    total ? `Showing ${start+1}–${start+slice.length} of ${total} · Page ${schedPage+1} of ${pages}` : "";
  document.getElementById("pgPrev").disabled = schedPage === 0;
  document.getElementById("pgNext").disabled = schedPage >= pages-1;
  document.getElementById("schedNote").textContent =
    total ? total + " withdrawals in the schedule." : "No withdrawals were generated (check dates and NAV availability).";
}

function renderResults(r, noscroll){
  const card = document.getElementById("resultsCard");
  card.classList.remove("hidden");
  card.classList.remove("rise"); void card.offsetWidth; card.classList.add("rise");
  const m = (k, raw, fmt, cls) =>
    `<div class="metric"><div class="k">${k}</div><div class="v${cls?" "+cls:""}" data-raw="${raw}" data-fmt="${fmt}">${FMT[fmt](raw)}</div></div>`;
  const xirrHtml = r.rate==null
    ? `<div class="metric"><div class="k">XIRR (annualized, incl. residual)</div><div class="v">n/a</div></div>`
    : m("XIRR (annualized, incl. residual)", r.rate*100, "pct", "good");
  document.getElementById("metrics").innerHTML =
    m("Initial lumpsum", r.lumpsum, "inr") +
    m("Lumpsum NAV", r.lumpsumNAV, "nav4") +
    m("Initial units", r.initialUnits, "num4") +
    m("Total withdrawn", r.totalWithdrawn, "inr", "good") +
    m("Current value (after SWP)", r.remainingValue, "inr", "good") +
    m("Withdrawals executed", r.done, "int") +
    xirrHtml +
    m("Total outcome", r.totalWithdrawn + r.remainingValue, "inr", "good");
  playCounts(document.getElementById("metrics"));

  // what-if slider (fixed-amount mode only)
  const mode = document.querySelector('input[name="swpMode"]:checked').value;
  const wi = document.getElementById("whatif");
  if(mode === "fixed" && r.rows.length){
    wi.classList.remove("hidden");
    const range = document.getElementById("whatifRange");
    const cur = parseFloat(document.getElementById("swpAmt").value) || 10000;
    range.max = Math.max(100000, Math.ceil(cur*2/1000)*1000);
    if(document.activeElement !== range) range.value = cur;
    document.getElementById("whatifVal").textContent = formatINR(parseFloat(range.value));
  } else {
    wi.classList.add("hidden");
  }

  // table (paginated)
  schedRows = r.rows; schedPage = 0;
  renderSchedPage();
  document.getElementById("csvBtn").onclick = () => {
    const head = "withdrawal_date,nav_date_used,nav,units_sold,units_remaining,cash_withdrawn,balance_value_after\n";
    const body = r.rows.map(x => [x.wd,x.navDate,x.nav.toFixed(4),x.sold.toFixed(6),x.rem.toFixed(6),x.cash.toFixed(2),x.bal.toFixed(2)].join(",")).join("\n");
    const blob = new Blob([head+body], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "swp_schedule.csv"; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  };

  // chart
  const wrap = document.getElementById("chartWrap");
  if(chartObj){ chartObj.destroy(); chartObj = null; }
  if(r.rows.length && window.Chart){
    wrap.innerHTML = '<canvas id="chart"></canvas>';
    const cvs = document.getElementById("chart");
    let cum = 0;
    const labels = r.rows.map(x=>x.wd);
    const bal = r.rows.map(x=>+x.bal.toFixed(2));
    const cumw = r.rows.map(x=>{ cum+=x.cash; return +cum.toFixed(2); });
    const dark = rootEl.getAttribute("data-theme")!=="light";
    const cs = getComputedStyle(rootEl);
    const c1 = (cs.getPropertyValue("--chart1")||"").trim() || "#D96C2C";
    const c2 = (cs.getPropertyValue("--chart2")||"").trim() || "#2E9E8F";
    const grid = dark ? "rgba(255,255,255,.08)" : "rgba(120,70,30,.10)";
    const tick = dark ? "#C8A181" : "#93765C";
    chartObj = new Chart(cvs, {type:"line",
      data:{labels, datasets:[
        {label:"Remaining balance (₹)", data:bal, borderColor:c1, backgroundColor:c1+"26", fill:true, tension:.25, pointRadius:2},
        {label:"Cumulative withdrawn (₹)", data:cumw, borderColor:c2, tension:.25, pointRadius:2}
      ]},
      options:{responsive:true, maintainAspectRatio:false,
        animation:{duration:900, easing:"easeOutQuart"},
        plugins:{legend:{labels:{color:tick}}, tooltip:{callbacks:{label:c=>" "+c.dataset.label+": "+formatINR(c.parsed.y)}}},
        scales:{x:{ticks:{color:tick, maxTicksLimit:10}, grid:{color:grid}},
                y:{ticks:{color:tick, callback:v=>formatINR(v)}, grid:{color:grid}}}}});
  } else if(r.rows.length){
    wrap.innerHTML = '<div class="hint" style="padding:28px 10px">Charts need an internet connection to load the chart library — your numbers and table above are complete.</div>';
  }
  if(!noscroll) card.scrollIntoView({behavior:"smooth", block:"start"});
  showAds();
}

/* ---------- AdSense: only activate after PAWAN replaces the publisher ID ---------- */
function showAds(){
  if(/X{4,}/.test(ADSENSE_CLIENT)) {
    document.querySelectorAll(".adslot").forEach(s => s.classList.add("hidden"));
    return;
  }
  document.querySelectorAll(".adslot").forEach(s => s.classList.remove("hidden"));
  document.querySelectorAll("ins.adsbygoogle").forEach(el => {
    el.setAttribute("data-ad-client", ADSENSE_CLIENT);
    try{ (window.adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
  });
}

/* ---------- wire up ---------- */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("themeBtn").addEventListener("click", () =>
    setTheme(rootEl.getAttribute("data-theme")==="light" ? "dark" : "light"));
  document.getElementById("fundSearch").addEventListener("input", e => { fundState.query = e.target.value; renderFundResults(); });
  document.getElementById("amcFilter").addEventListener("change", e => { fundState.amc = e.target.value; renderFundResults(); });
  document.getElementById("runBtn").addEventListener("click", () => runSimulation(false));
  // readiness tracking: mark touched fields + refresh the Step-3 checklist live
  ["lumpsumAmt","lumpsumDate","swpStart","swpAmt","swpPct","freq","swpEnd","swpCount"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => { touched.add(id); updateReadiness(); });
    el.addEventListener("change", () => { touched.add(id); updateReadiness(); });
  });
  document.querySelectorAll('input[name="swpMode"],input[name="endMode"]').forEach(r =>
    r.addEventListener("change", () => { touched.add(r.name); toggleSwpMode(); toggleEndMode(); updateReadiness(); }));
  document.getElementById("lumpsumDate").addEventListener("change", syncSwpMin);
  // smart dynamic defaults so the form is useful before any fund is picked
  const _t = new Date(); _t.setHours(0,0,0,0);
  const _pre = (id, d) => { const el = document.getElementById(id); if(!el.value) el.value = fmtDate(d); };
  _pre("lumpsumDate", addYears(_t, -5));
  _pre("swpStart", addYears(_t, -4));
  _pre("swpEnd", _t);
  toggleSwpMode(); toggleEndMode(); updateReadiness();
  // sliders (log-scale for wide money ranges; high upper limits)
  bindSlider("lumpsumAmt","lumpsumAmtSld",{min:10000,max:1000000000,step:1000,log:true});
  bindSlider("swpAmt","swpAmtSld",{min:1000,max:10000000,step:500,log:true});
  bindSlider("swpPct","swpPctSld",{min:0.1,max:100,step:0.1});
  bindSlider("swpCount","swpCountSld",{min:1,max:600,step:1});
  // calendar pickers on date fields
  ["lumpsumDate","swpStart","swpEnd"].forEach(initDatePicker);
  document.getElementById("pgPrev").addEventListener("click", () => { schedPage--; renderSchedPage(); });
  document.getElementById("pgNext").addEventListener("click", () => { schedPage++; renderSchedPage(); });
  const range = document.getElementById("whatifRange");
  range.addEventListener("input", () => {
    document.getElementById("whatifVal").textContent = formatINR(parseFloat(range.value));
    clearTimeout(whatifTimer);
    whatifTimer = setTimeout(() => {
      document.getElementById("swpAmt").value = range.value;
      syncAllSliders();
      runSimulation(true);
    }, 250);
  });
  document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
    const inp = document.getElementById("fundSearch");
    inp.value = c.dataset.q; inp.dispatchEvent(new Event("input", {bubbles:true})); inp.focus();
  }));
  document.querySelectorAll('a[href="#how"]').forEach(a => a.addEventListener("click", () => {
    const d = document.querySelector("details.howcard"); if(d) d.open = true;
  }));
  loadFundList();
  showAds();
});
