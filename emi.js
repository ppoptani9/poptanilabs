/* EMI Calculator — loan amortization with part-prepayments.
   Everything runs locally in the browser. No data leaves the device. */
"use strict";

const rootEl = document.documentElement;
function paintThemeBtn(){
  const t = rootEl.getAttribute("data-theme");
  const k = document.getElementById("themeKnob"), n = document.getElementById("themeName");
  if(k) k.innerHTML = t === "light" ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  if(n) n.textContent = t === "light" ? "Dark" : "Light";
}
function setTheme(t){
  rootEl.setAttribute("data-theme", t);
  try{ localStorage.setItem("swp-theme", t); }catch(e){}
  paintThemeBtn();
  drawCharts(); /* re-render with theme-correct colors */
}
document.getElementById("themeBtn").addEventListener("click", () =>
  setTheme(rootEl.getAttribute("data-theme") === "light" ? "dark" : "light"));
paintThemeBtn();

/* ---------- formatting & parsing ---------- */
function formatINR(amount){
  const amt = Number(amount);
  if(!isFinite(amt)) return "—";
  const a = Math.abs(amt); let v, s;
  if(a >= 1e7){ v = amt/1e7; s = "Cr"; }
  else if(a >= 1e5){ v = amt/1e5; s = "L"; }
  else if(a >= 1e3){ v = amt/1e3; s = "K"; }
  else { v = amt; s = ""; }
  return "₹" + v.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}) + s;
}
/* Parse a money field: strips ₹, commas, spaces. Returns NaN when unusable. */
function parseMoney(str){
  if(str == null) return NaN;
  const c = String(str).replace(/[₹,\s]/g, "");
  if(c === "" || c === "-" || c === ".") return NaN;
  if(!/^-?\d*\.?\d+$/.test(c)) return NaN;
  const v = parseFloat(c);
  return isFinite(v) ? v : NaN;
}
function parseNum(str){
  if(str == null) return NaN;
  const c = String(str).trim().replace(/,/g, "");
  if(c === "") return NaN;
  const v = parseFloat(c);
  return isFinite(v) ? v : NaN;
}
const miToYM = mi => ({ y: Math.floor(mi/12), m: mi%12 });           /* mi: year*12+(m-1) */
const ymToMi = (y, m) => y*12 + (m-1);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const miLabel = mi => { const {y,m} = miToYM(mi); return MONTHS[m] + " " + y; };
function parseMonthInput(v){ /* "2026-10" -> mi */
  const m = /^(\d{4})-(\d{2})$/.exec(String(v||"").trim());
  if(!m) return null;
  const y = +m[1], mo = +m[2];
  if(mo < 1 || mo > 12 || y < 1900 || y > 2200) return null;
  return ymToMi(y, mo);
}
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ---------- amortization engine ---------- */
function amortize(P, annualRate, totalMonths, preps){
  /* preps: [{mi, amt, mode}] with mi = 0-based month offset from loan start */
  const r = annualRate/1200;
  const pow = Math.pow(1+r, totalMonths);
  let emi = r > 0 ? P*r*pow/(pow-1) : P/totalMonths;
  emi = Math.round(emi*100)/100;
  const firstEmi = emi;
  const byMonth = {};
  (preps||[]).forEach(p => { (byMonth[p.mi] = byMonth[p.mi] || []).push(p); });
  let bal = Math.round(P*100)/100, month = 0;
  let totalInterest = 0, totalPrepay = 0;
  const rows = [], notes = [];
  while(bal > 0.005 && month < 1200){
    let ppPaid = 0;
    for(const p of (byMonth[month] || [])){
      if(bal <= 0.005) break;
      if(p.amt > bal + 0.005)
        notes.push(`Prepayment in ${miLabel(curStartMi+month)} exceeded the outstanding balance — adjusted down to ${formatINR(bal)}.`);
      const pay = Math.min(p.amt, bal);
      bal = Math.round((bal-pay)*100)/100;
      ppPaid = Math.round((ppPaid+pay)*100)/100;
      totalPrepay = Math.round((totalPrepay+pay)*100)/100;
      if(p.mode === "emi" && bal > 0.005){
        const rem = totalMonths - month;
        const pw = Math.pow(1+r, rem);
        emi = r > 0 ? bal*r*pw/(pw-1) : bal/rem;
        emi = Math.round(emi*100)/100;
      }
    }
    if(bal <= 0.005){ bal = 0; break; }
    const interest = Math.round(bal*r*100)/100;
    let princ = Math.round((emi-interest)*100)/100;
    let paid = emi;
    if(princ < 0){ princ = 0; paid = interest; }
    /* fold rounding dust (max ~₹3.60 over 30 yrs) into the last instalment,
       like lenders do — a real EMI is never below ₹5 */
    if(princ >= bal || (bal - princ < 5 && bal - princ > 0)){ princ = bal; paid = Math.round((bal+interest)*100)/100; }
    bal = Math.round((bal-princ)*100)/100;
    totalInterest = Math.round((totalInterest+interest)*100)/100;
    rows.push({ mi: month, emi: paid, princ, interest, prepay: ppPaid, bal });
    month++;
  }
  return { firstEmi, rows, months: rows.length, totalInterest, totalPrepay, notes };
}
let curStartMi = 0; /* set before each amortize() so notes can name months */

/* ---------- state ---------- */
let lastResult = null;   /* {base, actual, params} for charts/table/csv */
let schedView = "monthly";
let schedPage = 0;
const PAGE_SIZE = 12;
let charts = [];

/* ---------- sliders ---------- */
function bindSlider(numId, sldId, o){
  const num = document.getElementById(numId), sld = document.getElementById(sldId);
  if(!num || !sld) return;
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
  sld.addEventListener("input", () => {
    num.value = fmtNumInput(numId, toVal(Number(sld.value)));
    num.dispatchEvent(new Event("input", {bubbles:true}));
  });
  num.addEventListener("input", () => { sld.value = toPos(parseMoney(num.value)); });
  sld.value = toPos(parseMoney(num.value));
}
function fmtNumInput(id, v){
  if(id === "loanAmt" || id === "procFee") return Math.round(v).toLocaleString("en-IN");
  return String(v);
}

/* ---------- prepayment rows ---------- */
function addPrepayRow(){
  const list = document.getElementById("ppList");
  const row = document.createElement("div");
  row.className = "pp-row";
  row.innerHTML =
    '<div><label>Month</label><input type="month" class="ppDate"></div>' +
    '<div><label>Amount (₹)</label><input type="text" class="ppAmt" inputmode="numeric" placeholder="e.g. 2,00,000" autocomplete="off"></div>' +
    '<div><label>Effect</label><select class="ppMode"><option value="tenure">Reduce tenure</option><option value="emi">Reduce EMI</option></select></div>' +
    '<button type="button" class="ppX" aria-label="Remove prepayment">✕</button>';
  list.appendChild(row);
  row.querySelector(".ppX").addEventListener("click", () => { row.remove(); scheduleRecalc(); });
  row.querySelectorAll("input,select").forEach(el =>
    el.addEventListener("input", scheduleRecalc));
  return row;
}
function readPrepayRows(){
  return [...document.querySelectorAll("#ppList .pp-row")].map(row => ({
    el: row,
    date: row.querySelector(".ppDate").value,
    amt: parseMoney(row.querySelector(".ppAmt").value),
    amtRaw: row.querySelector(".ppAmt").value,
    mode: row.querySelector(".ppMode").value
  }));
}

/* ---------- validation + computation ---------- */
function setErr(boxId, msgs){
  const box = document.getElementById(boxId);
  if(!msgs.length){ box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = msgs.map(m => `<div>• ${esc(m)}</div>`).join("");
  box.classList.remove("hidden");
}

function compute(){
  const loanErrs = [], ppErrs = [];
  const P = parseMoney(document.getElementById("loanAmt").value);
  const rate = parseNum(document.getElementById("loanRate").value);
  const tenureRaw = parseNum(document.getElementById("loanTenure").value);
  const unit = document.getElementById("tenureUnit").value;
  const startMi = parseMonthInput(document.getElementById("loanStart").value);
  const feeRaw = document.getElementById("procFee").value.trim();
  const fee = feeRaw === "" ? 0 : parseMoney(feeRaw);

  if(isNaN(P)) loanErrs.push("Enter the loan amount (numbers only — commas are fine).");
  else if(P <= 0) loanErrs.push("Loan amount must be more than ₹0.");
  else if(P > 1e9) loanErrs.push("Loan amount above ₹100 crore looks like a typo — please check the figure.");
  if(isNaN(rate)) loanErrs.push("Enter the annual interest rate.");
  else if(rate < 0) loanErrs.push("Interest rate can't be negative.");
  else if(rate > 60) loanErrs.push("Interest rate above 60% p.a. isn't realistic for any lender — please check.");
  let nMonths = NaN;
  if(isNaN(tenureRaw)) loanErrs.push("Enter the loan tenure.");
  else {
    nMonths = unit === "years" ? Math.round(tenureRaw*12) : Math.round(tenureRaw);
    if(nMonths < 1) loanErrs.push("Tenure must be at least 1 month.");
    else if(nMonths > 360) loanErrs.push("Tenure above 30 years isn't offered by lenders — please check.");
  }
  if(startMi == null) loanErrs.push("Pick the month your loan starts.");
  if(isNaN(fee)) loanErrs.push("Processing fee must be a number (or leave it 0).");
  else if(fee < 0) loanErrs.push("Processing fee can't be negative.");
  else if(!isNaN(P) && fee > P) loanErrs.push("Processing fee can't exceed the loan amount itself.");

  setErr("loanError", loanErrs);
  if(loanErrs.length){ hideResults(); return; }

  curStartMi = startMi;
  document.getElementById("loanAmtHint").textContent = formatINR(P) + " loan";
  document.getElementById("rateHint").textContent =
    rate === 0 ? "Interest-free loan — EMI is simply principal ÷ months." : "";

  /* baseline (no prepayments) for comparison + outstanding lookups */
  const base = amortize(P, rate, nMonths, []);
  const outByMi = base.rows.map(r => r.bal + r.princ); /* balance BEFORE month mi's EMI */
  const payoffLabel = miLabel(startMi + base.months - 1);

  /* validate prepayment rows */
  const rows = readPrepayRows();
  const preps = [];
  rows.forEach((r, i) => {
    const tag = `Prepayment #${i+1}`;
    const mi = parseMonthInput(r.date);
    if(mi == null){ ppErrs.push(`${tag}: pick a month.`); return; }
    if(mi < startMi){ ppErrs.push(`${tag}: ${miLabel(mi)} is before your loan starts (${miLabel(startMi)}).`); return; }
    if(mi >= startMi + base.months){ ppErrs.push(`${tag}: ${miLabel(mi)} is after your loan already pays off (${payoffLabel}).`); return; }
    if(isNaN(r.amt)){ ppErrs.push(`${tag}: enter an amount.`); return; }
    if(r.amt <= 0){ ppErrs.push(`${tag}: amount must be more than ₹0.`); return; }
    const off = mi - startMi;
    const out = outByMi[off];
    if(r.amt > out + 0.005){ ppErrs.push(`${tag}: ${formatINR(r.amt)} exceeds the outstanding balance in ${miLabel(mi)} (${formatINR(out)}).`); return; }
    preps.push({ mi: off, amt: r.amt, mode: r.mode });
  });

  /* recurring yearly prepayment */
  if(document.getElementById("ppRecurOn").checked){
    const ra = parseMoney(document.getElementById("ppRecurAmt").value);
    const rm = document.getElementById("ppRecurMode").value;
    if(isNaN(ra)) ppErrs.push("Yearly prepayment: enter an amount.");
    else if(ra <= 0) ppErrs.push("Yearly prepayment: amount must be more than ₹0.");
    else {
      for(let k = 1; k*12-1 < base.months; k++){
        const off = k*12 - 1;
        const out = outByMi[off];
        if(out == null || out <= 0.005) break;
        preps.push({ mi: off, amt: Math.min(ra, out), mode: rm, recur: true });
      }
      document.getElementById("ppRecurHint").textContent =
        `Applied every 12 months from the loan start month (${formatINR(ra)} each, ${rm === "tenure" ? "reducing tenure" : "reducing EMI"}), until the loan closes.`;
    }
  }

  setErr("ppError", ppErrs);
  if(ppErrs.length){ hideResults(); return; }

  const actual = amortize(P, rate, nMonths, preps);
  lastResult = { P, rate, nMonths, startMi, fee, base, actual, preps };
  renderResults();
}

function hideResults(){
  document.getElementById("resultsCard").classList.add("hidden");
  lastResult = null;
}

/* ---------- rendering ---------- */
function metric(label, value, cls){
  return `<div class="metric"><div class="k">${label}</div><div class="v ${cls||""}">${value}</div></div>`;
}
function renderResults(){
  const { P, rate, nMonths, startMi, fee, base, actual } = lastResult;
  document.getElementById("resultsCard").classList.remove("hidden");
  const m = document.getElementById("metrics");
  const totalPayable = P + actual.totalInterest + fee;
  const payoff = miLabel(startMi + actual.months - 1);
  m.innerHTML =
    metric("Monthly EMI", formatINR(actual.firstEmi)) +
    metric("Total interest", formatINR(actual.totalInterest), "neg") +
    metric("Total payable", formatINR(totalPayable)) +
    metric("Loan closes", payoff) +
    metric("Principal", formatINR(P));
  const sb = document.getElementById("saveBanner");
  const intSaved = Math.round((base.totalInterest - actual.totalInterest)*100)/100;
  const moSaved = base.months - actual.months;
  if(intSaved > 0.5 || moSaved > 0){
    sb.classList.remove("hidden");
    sb.innerHTML = `<div class="metric" style="border-color:var(--good)"><div class="k">Prepayment impact</div>` +
      `<div class="v good" style="font-size:1.05rem">You save <b>${formatINR(intSaved)}</b> in interest` +
      (moSaved > 0 ? ` and close <b>${moSaved} month${moSaved===1?"":"s"}</b> early` : "") +
      ` — debt-free by <b>${payoff}</b> instead of ${miLabel(startMi + base.months - 1)}.</div></div>`;
  } else {
    sb.classList.add("hidden"); sb.innerHTML = "";
  }
  const notes = actual.notes;
  document.getElementById("schedNote").textContent =
    `${actual.months} instalment${actual.months===1?"":"s"}` +
    (lastResult.preps.length ? ` · includes ${lastResult.preps.length} prepayment${lastResult.preps.length===1?"":"s"}` : "") +
    (notes.length ? ` · ${notes[0]}` : "");
  schedPage = 0;
  renderSchedPage();
  drawCharts();
}

function schedRowsFor(view){
  const { startMi, actual } = lastResult;
  if(view === "yearly"){
    const byY = {};
    actual.rows.forEach(r => {
      const y = miToYM(startMi + r.mi).y;
      (byY[y] = byY[y] || { y, princ: 0, interest: 0, prepay: 0, emi: 0, n: 0, bal: 0 });
      const o = byY[y];
      o.princ += r.princ; o.interest += r.interest; o.prepay += r.prepay; o.emi += r.emi; o.n++; o.bal = r.bal;
    });
    return Object.values(byY);
  }
  return actual.rows;
}
function renderSchedPage(){
  if(!lastResult) return;
  const { startMi } = lastResult;
  const rows = schedRowsFor(schedView);
  const head = document.getElementById("schedHead"), tb = document.getElementById("schedBody");
  if(schedView === "yearly"){
    head.innerHTML = "<tr><th>Year</th><th>Paid (EMI)</th><th>Principal</th><th>Interest</th><th>Prepayments</th><th>Closing balance</th></tr>";
  } else {
    head.innerHTML = "<tr><th>Month</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Prepayment</th><th>Balance</th></tr>";
  }
  const pages = Math.max(1, Math.ceil(rows.length/PAGE_SIZE));
  schedPage = Math.min(Math.max(0, schedPage), pages-1);
  const slice = rows.slice(schedPage*PAGE_SIZE, (schedPage+1)*PAGE_SIZE);
  tb.innerHTML = slice.map(r => {
    if(schedView === "yearly")
      return `<tr><td>${r.y}</td><td>${formatINR(r.emi)}</td><td>${formatINR(r.princ)}</td><td>${formatINR(r.interest)}</td><td>${r.prepay>0?formatINR(r.prepay):"—"}</td><td>${formatINR(r.bal)}</td></tr>`;
    const pp = r.prepay > 0 ? ` <span class="pill" style="font-size:.62rem;padding:3px 9px;letter-spacing:1px">+${formatINR(r.prepay)} prepay</span>` : "";
    return `<tr><td>${miLabel(startMi + r.mi)}${pp}</td><td>${formatINR(r.emi)}</td><td>${formatINR(r.princ)}</td><td>${formatINR(r.interest)}</td><td>${r.prepay>0?formatINR(r.prepay):"—"}</td><td>${formatINR(r.bal)}</td></tr>`;
  }).join("");
  document.getElementById("pgInfo").textContent = `Page ${schedPage+1} of ${pages} · ${rows.length} ${schedView==="yearly"?"years":"months"}`;
  document.getElementById("schedPager").classList.toggle("hidden", pages <= 1);
}

function drawCharts(){
  charts.forEach(c => { try{ c.destroy(); }catch(e){} });
  charts = [];
  if(!lastResult || typeof Chart === "undefined") return;
  const { startMi, actual, base } = lastResult;
  const dark = rootEl.getAttribute("data-theme") === "dark";
  const grid = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";
  const tick = dark ? "#c9c9d4" : "#555";

  /* stacked principal vs interest per year */
  const byY = {};
  actual.rows.forEach(r => {
    const y = miToYM(startMi + r.mi).y;
    (byY[y] = byY[y] || { p: 0, i: 0 });
    byY[y].p += r.princ; byY[y].i += r.interest;
  });
  const years = Object.keys(byY).sort();
  const cv1 = document.getElementById("chartSplit");
  if(cv1){
    charts.push(new Chart(cv1, {
      type: "bar",
      data: { labels: years,
        datasets: [
          { label: "Principal", data: years.map(y => +byY[y].p.toFixed(2)),
            backgroundColor: "#0F5D4E" },
          { label: "Interest", data: years.map(y => +byY[y].i.toFixed(2)),
            backgroundColor: "#D4A373" }
        ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tick } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${formatINR(c.parsed.y)}` } } },
        scales: { x: { stacked: true, ticks: { color: tick, maxTicksLimit: 10 }, grid: { color: grid } },
                  y: { stacked: true, ticks: { color: tick, callback: v => formatINR(v) }, grid: { color: grid } } } }
    }));
  }
  /* balance curves: with vs without prepayments */
  const cv2 = document.getElementById("chartBal");
  if(cv2){
    const labels = actual.rows.map(r => miLabel(startMi + r.mi));
    const ds = [{ label: "With your prepayments", data: actual.rows.map(r => +r.bal.toFixed(2)),
      borderColor: "#0F5D4E", backgroundColor: "rgba(15,93,78,.12)", fill: true, tension: .25, pointRadius: 0 }];
    if(lastResult.preps.length){
      const bmap = {};
      base.rows.forEach(r => { bmap[r.mi] = r.bal; });
      ds.push({ label: "Without prepayments", data: actual.rows.map(r => +(bmap[r.mi] != null ? bmap[r.mi] : 0).toFixed(2)),
        borderColor: "#b04848", borderDash: [6,4], fill: false, tension: .25, pointRadius: 0 });
    }
    charts.push(new Chart(cv2, {
      type: "line",
      data: { labels, datasets: ds },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tick } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${formatINR(c.parsed.y)}` } } },
        scales: { x: { ticks: { color: tick, maxTicksLimit: 8 }, grid: { color: grid } },
                  y: { ticks: { color: tick, callback: v => formatINR(v) }, grid: { color: grid } } } }
    }));
  }
}

function downloadCSV(){
  if(!lastResult) return;
  const { startMi, actual } = lastResult;
  const head = "Month,EMI (Rs),Principal (Rs),Interest (Rs),Prepayment (Rs),Balance (Rs)\n";
  const body = actual.rows.map(r =>
    [miLabel(startMi + r.mi), r.emi.toFixed(2), r.princ.toFixed(2), r.interest.toFixed(2), r.prepay.toFixed(2), r.bal.toFixed(2)]
    .join(",")).join("\n");
  const blob = new Blob([head + body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "emi-schedule.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- wiring ---------- */
let recalcT = null;
function scheduleRecalc(){
  clearTimeout(recalcT);
  recalcT = setTimeout(compute, 280);
}
function init(){
  const now = new Date();
  const ms = String(now.getMonth()+1).padStart(2, "0");
  document.getElementById("loanStart").value = `${now.getFullYear()}-${ms}`;

  bindSlider("loanAmt", "loanAmtSld", { min: 10000, max: 100000000, step: 10000, log: true });
  bindSlider("loanRate", "loanRateSld", { min: 0.05, max: 30, step: 0.05 });
  /* tenure slider works in months behind the scenes */
  const tSld = document.getElementById("loanTenureSld"), tNum = document.getElementById("loanTenure"), tUnit = document.getElementById("tenureUnit");
  const tToMonths = () => {
    const v = parseNum(tNum.value);
    if(isNaN(v)) return NaN;
    return tUnit.value === "years" ? Math.round(v*12) : Math.round(v);
  };
  const tFromMonths = m => {
    if(tUnit.value === "years"){ tNum.value = +(m/12).toFixed(2); }
    else tNum.value = m;
  };
  tSld.min = 12; tSld.max = 360; tSld.step = 12; tSld.value = 240;
  tSld.addEventListener("input", () => { tFromMonths(+tSld.value); tNum.dispatchEvent(new Event("input", { bubbles: true })); });
  tNum.addEventListener("input", () => {
    const m = tToMonths();
    if(!isNaN(m)) tSld.value = Math.min(360, Math.max(12, Math.round(m/12)*12));
    scheduleRecalc();
  });
  tUnit.addEventListener("change", () => {
    /* reinterpret the numeric value in the newly selected unit */
    const v = parseNum(tNum.value);
    if(!isNaN(v)){
      if(tUnit.value === "years") tNum.value = +(v/12).toFixed(2);
      else tNum.value = Math.round(v*12);
    }
    scheduleRecalc();
  });

  ["loanAmt","loanRate","procFee"].forEach(id =>
    document.getElementById(id).addEventListener("input", scheduleRecalc));
  document.getElementById("loanStart").addEventListener("change", scheduleRecalc);
  document.getElementById("ppAdd").addEventListener("click", () => { addPrepayRow(); });
  const recOn = document.getElementById("ppRecurOn");
  recOn.addEventListener("change", () => {
    document.getElementById("ppRecurBox").classList.toggle("hidden", !recOn.checked);
    scheduleRecalc();
  });
  ["ppRecurAmt","ppRecurMode"].forEach(id =>
    document.getElementById(id).addEventListener("input", scheduleRecalc));

  document.getElementById("viewMonthly").addEventListener("click", () => {
    schedView = "monthly"; schedPage = 0;
    document.getElementById("viewMonthly").classList.add("on");
    document.getElementById("viewYearly").classList.remove("on");
    renderSchedPage();
  });
  document.getElementById("viewYearly").addEventListener("click", () => {
    schedView = "yearly"; schedPage = 0;
    document.getElementById("viewYearly").classList.add("on");
    document.getElementById("viewMonthly").classList.remove("on");
    renderSchedPage();
  });
  document.getElementById("pgPrev").addEventListener("click", () => { schedPage--; renderSchedPage(); });
  document.getElementById("pgNext").addEventListener("click", () => { schedPage++; renderSchedPage(); });
  document.getElementById("csvBtn").addEventListener("click", downloadCSV);

  /* seed one example prepayment row so the feature is discoverable —
     complete and valid, so results (with savings banner) show on load */
  const ex = addPrepayRow();
  ex.querySelector(".ppAmt").value = "2,00,000";
  const exD = new Date(now.getFullYear()+1, now.getMonth(), 1);
  ex.querySelector(".ppDate").value = `${exD.getFullYear()}-${String(exD.getMonth()+1).padStart(2,"0")}`;

  compute();
}
document.addEventListener("DOMContentLoaded", init);
