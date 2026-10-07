/* mouse.js v20261006b — subtle cursor-driven ambience for poptanilabs.com
   1) soft ambient glow that follows the cursor
   2) faint spotlight inside cards, centered on the cursor
   Runs only on precise pointers; disabled entirely with prefers-reduced-motion. */
(function () {
  "use strict";
  if (!window.matchMedia) return;
  try {
    if (!matchMedia("(pointer:fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) { return; }

  var D = document.documentElement;
  var dark = function () { return D.getAttribute("data-theme") === "dark"; };

  /* Injected CSS — keeps styles.css untouched. */
  var st = document.createElement("style");
  st.textContent =
    ".cursor-glow{position:fixed;left:0;top:0;width:560px;height:560px;pointer-events:none;z-index:2000;" +
    "opacity:0;transition:opacity .7s ease;will-change:transform}" +
    ".card{position:relative}" +
    ".card::after{content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;" +
    "transition:opacity .35s ease;will-change:opacity;" +
    "background:radial-gradient(380px circle at var(--mx,50%) var(--my,50%),var(--spot,transparent),transparent 70%)}" +
    ".card:hover::after{opacity:1}";
  document.head.appendChild(st);

  var glow = document.createElement("div");
  glow.className = "cursor-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.appendChild(glow);

  function themeColors() {
    if (dark()) {
      glow.style.background = "radial-gradient(circle,rgba(216,171,112,.13) 0%,rgba(216,171,112,.045) 42%,transparent 66%)";
      D.style.setProperty("--spot", "rgba(216,171,112,.09)");
    } else {
      glow.style.background = "radial-gradient(circle,rgba(15,93,78,.10) 0%,rgba(15,93,78,.035) 42%,transparent 66%)";
      D.style.setProperty("--spot", "rgba(15,93,78,.07)");
    }
  }
  themeColors();
  if (window.MutationObserver) {
    new MutationObserver(themeColors).observe(D, { attributes: true, attributeFilter: ["data-theme"] });
  }

  var mx = window.innerWidth / 2, my = window.innerHeight / 3;
  var gx = mx, gy = my, seen = false;

  window.addEventListener("pointermove", function (e) {
    mx = e.clientX; my = e.clientY;
    if (!seen) { seen = true; glow.style.opacity = "1"; }
    var t = e.target;
    var card = (t && t.closest) ? t.closest(".card") : null;
    if (card) {
      var cr = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - cr.left) / cr.width * 100).toFixed(1) + "%");
      card.style.setProperty("--my", ((e.clientY - cr.top) / cr.height * 100).toFixed(1) + "%");
    }
  }, { passive: true });
  document.addEventListener("pointerleave", function () { glow.style.opacity = "0"; seen = false; });

  (function loop() {
    gx += (mx - gx) * 0.075;
    gy += (my - gy) * 0.075;
    glow.style.transform = "translate(" + (gx - 280).toFixed(1) + "px," + (gy - 280).toFixed(1) + "px)";
    requestAnimationFrame(loop);
  })();
})();
