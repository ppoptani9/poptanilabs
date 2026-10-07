/* Ink Guess — draw fast, the AI guesses live.
   All inference runs locally in the browser via onnxruntime-web.
   Preprocessing below is an EXACT mirror of preprocess.py used in training:
   bbox -> scale to 20px box -> center in 28x28 -> binary rasterize (Bresenham + 3x3 brush). */
(function () {
"use strict";

var ROUNDS = 6;
var ROUND_SECS = 20;
var CW = 800, CH = 600;              // canvas backing store
var GUESS_MS = 600;                  // live-guess throttle

var canvas, ctx, session = null, labels = [];
var state = "boot";                  // boot | ready | playing | roundEndWon | roundEndLost | finished
var order = [], roundIdx = 0, score = 0, streak = 0, bestStreak = 0;
var strokes = [], cur = null, drawing = false, guessing = false;
var soundOn = true, lastSpoke = 0, lastSpokenLabel = "", phraseIdx = 0, voice = null;
var timeLeft = 0, timerId = null, lastGuess = 0, guessPending = false;
var lastTop = [];                    // last top-3 [{label, pct}]
var gallery = [];                    // {img, label, won}
var totalPoints = 0;

function $(id) { return document.getElementById(id); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---------- preprocessing: mirror of training ---------- */
function rasterize(strokes255) {
  var g = new Float32Array(28 * 28);
  var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  var si, pi, p;
  for (si = 0; si < strokes255.length; si++) {
    var s = strokes255[si];
    for (pi = 0; pi < s.length; pi++) {
      p = s[pi]; n++;
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
  }
  if (!n) return g;
  if (maxx === minx) maxx = minx + 1;
  if (maxy === miny) maxy = miny + 1;
  var w = maxx - minx, h = maxy - miny;
  var scale = 20 / Math.max(w, h);
  var ox = (28 - w * scale) / 2, oy = (28 - h * scale) / 2;

  function stamp(x, y) {
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < 28 && yy >= 0 && yy < 28) g[yy * 28 + xx] = 1;
    }
  }
  function rne(v) { // round-half-to-even, matches numpy.round
    var f = Math.floor(v), d = v - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }
  function line(x0, y0, x1, y1) { // bit-identical to preprocess.py _bresenham
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, x = x0, y = y0, e2;
    for (;;) {
      stamp(x, y);
      if (x === x1 && y === y1) break;
      e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  for (si = 0; si < strokes255.length; si++) {
    var t = [], i;
    s = strokes255[si];
    for (i = 0; i < s.length; i++)
      t.push([rne((s[i][0] - minx) * scale + ox), rne((s[i][1] - miny) * scale + oy)]);
    for (i = 0; i < t.length; i++) {
      stamp(t[i][0], t[i][1]);
      if (i > 0) line(t[i - 1][0], t[i - 1][1], t[i][0], t[i][1]);
    }
  }
  return g;
}

function to255() {
  var out = [], i, j;
  for (i = 0; i < strokes.length; i++) {
    var s = [];
    for (j = 0; j < strokes[i].length; j++)
      s.push([strokes[i][j][0] / CW * 255, strokes[i][j][1] / CH * 255]);
    out.push(s);
  }
  return out;
}

/* ---------- voice: the AI talks through its guesses ---------- */
function pickVoice() {
  try {
    var vs = speechSynthesis.getVoices();
    if (!vs.length) return;
    var en = vs.filter(function (v) { return v.lang && /^en/i.test(v.lang); });
    var pool = en.length ? en : vs;
    voice = pool.filter(function (v) { return /google us english/i.test(v.name); })[0] ||
            pool.filter(function (v) { return /en[-_]us/i.test(v.lang); })[0] ||
            pool[0];
  } catch (e) { /* voice stays default */ }
}
function art(w) { // "a cat", "an airplane", "eyeglasses"
  if (w === "eyeglasses") return "";
  return /^[aeiou]/i.test(w) ? "an " : "a ";
}
function speak(text) {
  if (!soundOn) return;
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel(); // never stack utterances
    var u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) { /* silent */ }
}
function guessPhrase(label, pct) {
  var a = art(label);
  phraseIdx++;
  if (pct >= 0.5) {
    var hi = ["I see " + a + label + "!", "That's " + a + label + "!", "It's " + a + label + "!"];
    return hi[phraseIdx % hi.length];
  }
  var lo = ["Is it " + a + label + "?", "Hmm... " + a + label + "?", "Could it be " + a + label + "?"];
  return lo[phraseIdx % lo.length];
}
function maybeSpeak(label, pct) {
  var now = Date.now();
  if (label === lastSpokenLabel || now - lastSpoke < 4000) return; // no babbling
  lastSpokenLabel = label; lastSpoke = now;
  speak(guessPhrase(label, pct));
}

/* ---------- inference ---------- */
function softmax(logits) {
  var m = -Infinity, i;
  for (i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
  var ex = [], sum = 0;
  for (i = 0; i < logits.length; i++) { ex[i] = Math.exp(logits[i] - m); sum += ex[i]; }
  for (i = 0; i < ex.length; i++) ex[i] /= sum;
  return ex;
}

function renderGuesses(top) {
  lastTop = top;
  var box = $("guesses");
  if (!top.length) {
    box.innerHTML = '<div class="g-empty">Start drawing — the AI guesses as you go.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < top.length; i++) {
    html += '<div class="guess' + (i === 0 ? " top" : "") + '">' +
      '<span class="g-label">' + cap(top[i].label) + "</span>" +
      '<span class="g-bar"><span style="width:' + Math.round(top[i].pct * 100) + '%"></span></span>' +
      '<span class="g-pct">' + Math.round(top[i].pct * 100) + "%</span></div>";
  }
  box.innerHTML = html;
}

async function runGuess() {
  if (!session || state !== "playing" || !totalPoints || guessing) return;
  guessing = true;
  var myRound = roundIdx;
  lastGuess = Date.now(); guessPending = false;
  try {
    var data = rasterize(to255());
    var tensor = new ort.Tensor("float32", data, [1, 1, 28, 28]);
    var out = await Promise.race([
      session.run({ input: tensor }),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error("infer timeout")); }, 4000); })
    ]);
    if (myRound !== roundIdx || state !== "playing") return; // round moved on; discard
    var probs = softmax(out.output.data);
    var idx = [];
    for (var i = 0; i < probs.length; i++) idx.push(i);
    idx.sort(function (a, b) { return probs[b] - probs[a]; });
    var top = [];
    for (var k = 0; k < 3 && k < idx.length; k++)
      top.push({ label: labels[idx[k]], pct: probs[idx[k]] });
    renderGuesses(top);
    maybeSpeak(top[0].label, top[0].pct);
    if (top[0].label === order[roundIdx]) onWin(top[0].pct);
  } catch (e) { /* inference hiccup: keep playing */ }
  finally { guessing = false; }
}

function maybeGuess(force) {
  if (state !== "playing" || !totalPoints) return;
  var now = Date.now();
  if (force || now - lastGuess > GUESS_MS) runGuess();
  else if (!guessPending) {
    guessPending = true;
    setTimeout(function () { guessPending = false; runGuess(); }, GUESS_MS - (now - lastGuess) + 30);
  }
}

/* ---------- canvas ---------- */
function pos(e) {
  var r = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(CW, (e.clientX - r.left) / r.width * CW)),
    Math.max(0, Math.min(CH, (e.clientY - r.top) / r.height * CH))
  ];
}

function redraw() {
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = "#23211d"; ctx.lineWidth = 9;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (var i = 0; i < strokes.length; i++) {
    var s = strokes[i];
    if (!s.length) continue;
    ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
    for (var j = 1; j < s.length; j++) ctx.lineTo(s[j][0], s[j][1]);
    ctx.stroke();
  }
  if (cur && cur.length) {
    ctx.beginPath(); ctx.moveTo(cur[0][0], cur[0][1]);
    for (var k = 1; k < cur.length; k++) ctx.lineTo(cur[k][0], cur[k][1]);
    ctx.stroke();
  }
}

function clearCanvas() {
  strokes = []; cur = null; totalPoints = 0; lastSpokenLabel = "";
  redraw(); renderGuesses([]);
}

function bindCanvas() {
  canvas = $("pad"); ctx = canvas.getContext("2d");
  redraw();
  canvas.addEventListener("pointerdown", function (e) {
    if (state !== "playing") return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true; cur = [pos(e)]; totalPoints++;
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drawing || state !== "playing") return;
    e.preventDefault();
    var p = pos(e), last = cur[cur.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    cur.push(p); totalPoints++;
    redraw(); maybeGuess(false);
  });
  function endStroke(e) {
    if (!drawing) return;
    drawing = false;
    if (cur && cur.length >= 1) strokes.push(cur);
    cur = null; redraw(); maybeGuess(true);
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
}

/* ---------- game flow ---------- */
function setOverlay(html) {
  var o = $("overlay");
  if (!html) { o.classList.add("hidden"); o.innerHTML = ""; return; }
  o.innerHTML = html; o.classList.remove("hidden");
}

function startScreen() {
  state = "ready";
  setOverlay(
    '<div class="ov-card"><h2>Ink Guess</h2>' +
    '<p class="ov-sub">Six rounds. Twenty seconds each.<br>Draw the prompt — the AI guesses live.</p>' +
    '<ul class="ov-rules"><li>Draw with your finger or mouse, right on the paper.</li>' +
    '<li>The moment the AI\'s top guess matches, the round is won.</li>' +
    '<li>Everything runs in your browser — your drawings never leave this device.</li></ul>' +
    '<ul class="ov-rules short"><li>Draw the prompt before the clock runs out.</li>' +
    '<li>The AI guesses live — nothing ever leaves your device.</li></ul>' +
    '<button class="btn" id="startBtn">Start drawing</button></div>'
  );
  $("startBtn").addEventListener("click", startGame);
}

function startGame() {
  order = shuffle(labels.slice()).slice(0, ROUNDS);
  roundIdx = 0; score = 0; streak = 0; bestStreak = 0; gallery = [];
  setOverlay(null);
  startRound();
}

function startRound() {
  state = "playing";
  clearCanvas();
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
  lastSpokenLabel = "";
  timeLeft = ROUND_SECS;
  $("prompt").innerHTML = "<small>Draw this</small>" + cap(order[roundIdx]);
  $("roundLabel").textContent = "Round " + (roundIdx + 1) + " of " + ROUNDS;
  $("scoreLabel").textContent = "Score " + score;
  paintDots(); paintTimer();
  setBanner(null);
  $("skipBtn").disabled = false; $("clearBtn").disabled = false;
  clearInterval(timerId);
  timerId = setInterval(tick, 100);
}

function tick() {
  timeLeft = Math.max(0, timeLeft - 0.1);
  paintTimer();
  if (timeLeft <= 0) onTimeout();
}

function paintTimer() {
  var frac = timeLeft / ROUND_SECS;
  var bar = $("timebar");
  bar.style.width = (frac * 100) + "%";
  bar.classList.toggle("low", timeLeft <= 5);
  $("timeText").textContent = Math.ceil(timeLeft) + "s";
}

function paintDots() {
  var html = "";
  for (var i = 0; i < ROUNDS; i++) {
    var cls = i < roundIdx ? (gallery[i] && gallery[i].won ? "done" : "miss") : (i === roundIdx ? "now" : "");
    html += '<span class="dot ' + cls + '"></span>';
  }
  $("dots").innerHTML = html;
}

function setBanner(html, kind) {
  var b = $("banner");
  if (!html) { b.className = "banner hidden"; b.innerHTML = ""; return; }
  b.className = "banner " + (kind || ""); b.innerHTML = html;
}

function snapshot() {
  try { return canvas.toDataURL("image/png"); } catch (e) { return ""; }
}

function finishStroke() { drawing = false; cur = null; }

function endRoundCommon() {
  clearInterval(timerId); finishStroke();
  gallery.push({ img: snapshot(), label: order[roundIdx], won: state === "roundEndWon" });
  $("skipBtn").disabled = true; $("clearBtn").disabled = true;
}

function onWin(pct) {
  if (state !== "playing") return;
  state = "roundEndWon";
  score++; streak++; if (streak > bestStreak) bestStreak = streak;
  $("scoreLabel").textContent = "Score " + score;
  endRoundCommon();
  paintDots();
  setBanner("Got it — that's a <b>" + cap(order[roundIdx]) + "</b>! " +
    "<span>" + Math.round(pct * 100) + "% sure, " +
    Math.max(1, ROUND_SECS - Math.ceil(timeLeft)) + "s in.</span>", "win");
  speak("Yes! That's " + art(order[roundIdx]) + order[roundIdx] + "!");
  setTimeout(nextRound, 1700);
}

function onTimeout() {
  if (state !== "playing") return;
  state = "roundEndLost";
  streak = 0;
  var best = lastTop.length ? "The AI's best guess was <b>" + cap(lastTop[0].label) + "</b> (" + Math.round(lastTop[0].pct * 100) + "%)." : "The AI didn't venture a guess.";
  endRoundCommon(); paintDots();
  setBanner("Time! It was a <b>" + cap(order[roundIdx]) + "</b>. " + best +
    ' <button class="btn ghost sm" id="nextBtn">Next &rarr;</button>', "miss");
  speak("Time! It was " + art(order[roundIdx]) + order[roundIdx] + ".");
  $("nextBtn").addEventListener("click", nextRound);
}

function skipRound() {
  if (state !== "playing") return;
  state = "roundEndLost";
  streak = 0;
  endRoundCommon(); paintDots();
  setBanner("Skipped — it was a <b>" + cap(order[roundIdx]) + "</b>." +
    ' <button class="btn ghost sm" id="nextBtn">Next &rarr;</button>', "miss");
  speak("Okay, skipping it.");
  $("nextBtn").addEventListener("click", nextRound);
}

function nextRound() {
  if (state !== "roundEndWon" && state !== "roundEndLost") return; // idempotent: only advance from a finished round
  roundIdx++;
  if (roundIdx >= ROUNDS) finishGame();
  else startRound();
}

function finishGame() {
  state = "finished";
  var prev = 0;
  try { prev = parseInt(localStorage.getItem("ink-guess-best") || "0", 10) || 0; } catch (e) {}
  var isBest = score > prev;
  if (isBest) { try { localStorage.setItem("ink-guess-best", String(score)); } catch (e) {} }
  var html = "<h2>" +
    (score === ROUNDS ? "A perfect round!" : score >= 4 ? "Sharp sketching!" : score >= 2 ? "Not bad!" : "The AI wins this one.") + "</h2>" +
    '<div class="final-score"><b>' + score + " / " + ROUNDS + "</b><span>best streak " + bestStreak + (isBest ? " · new personal best!" : " · personal best " + Math.max(prev, score)) + "</span></div>" +
    '<div class="gallery">';
  for (var i = 0; i < gallery.length; i++) {
    var g = gallery[i];
    html += '<figure class="' + (g.won ? "won" : "lost") + '">' +
      (g.img ? '<img src="' + g.img + '" alt="Drawing of ' + g.label + '">' : '<div class="g-ph"></div>') +
      "<figcaption>" + cap(g.label) + (g.won ? " ✓" : " ✗") + "</figcaption></figure>";
  }
  html += '</div><button class="btn" id="againBtn">Play again</button>';
  // results live in normal page flow (no nested scrollbar): hide the game UI, show results
  document.querySelector(".pad-card").style.display = "none";
  document.querySelector(".guess-panel").style.display = "none";
  document.querySelector(".ds-actions").style.display = "none";
  setBanner(null);
  var res = $("results");
  res.innerHTML = html;
  res.classList.remove("hidden");
  res.scrollIntoView({ block: "nearest" });
  $("againBtn").addEventListener("click", function () {
    res.classList.add("hidden"); res.innerHTML = "";
    document.querySelector(".pad-card").style.display = "";
    document.querySelector(".guess-panel").style.display = "";
    document.querySelector(".ds-actions").style.display = "";
    startGame();
  });
}

/* ---------- boot ---------- */
function fail(msg) {
  state = "boot";
  setOverlay('<div class="ov-card"><h2>Hmm.</h2><p class="ov-sub">' + msg + "</p></div>");
}

async function boot() {
  bindCanvas();
  setOverlay('<div class="ov-card"><h2>Ink Guess</h2><p class="ov-sub">Warming up the AI…</p></div>');
  if (typeof ort === "undefined") { fail("The AI engine couldn't load. Check your connection and reload."); return; }
  try { ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"; } catch (e) {}
  try {
    var lr = await fetch("labels.json", { cache: "no-store" });
    if (!lr.ok) throw new Error("labels");
    labels = await lr.json();
    session = await ort.InferenceSession.create("model.onnx", { executionProviders: ["wasm"] });
    // warmup so the first real guess is instant
    var t = new ort.Tensor("float32", new Float32Array(784), [1, 1, 28, 28]);
    await session.run({ input: t });
    var list = $("knowsList");
    if (list) list.textContent = labels.map(cap).join(", ") + ".";
    startScreen();
  } catch (e) {
    fail("The AI model couldn't load. Check your connection and reload.");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  $("clearBtn").addEventListener("click", function () { if (state === "playing") clearCanvas(); });
  $("skipBtn").addEventListener("click", skipRound);
  // recovery: tapping the result banner always advances (button or not)
  $("banner").addEventListener("click", function () { nextRound(); });
  // voice toggle
  var sbtn = $("soundBtn");
  try { soundOn = localStorage.getItem("ink-guess-sound") !== "off"; } catch (e) {}
  function paintSound() { sbtn.textContent = soundOn ? "Sound on" : "Muted"; }
  if (!("speechSynthesis" in window)) {
    sbtn.style.display = "none";
  } else {
    paintSound();
    pickVoice();
    try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}
    sbtn.addEventListener("click", function () {
      soundOn = !soundOn;
      try { localStorage.setItem("ink-guess-sound", soundOn ? "on" : "off"); } catch (e) {}
      if (!soundOn) { try { speechSynthesis.cancel(); } catch (e) {} }
      paintSound();
    });
  }
  boot();
});
})();
