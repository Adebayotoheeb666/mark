/* Minimal site behaviour: mobile nav + current-year stamp. No dependencies, no tracking. */
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
  // Keep the download page's sizes and hashes in sync with version.json, so a new
  // release only needs the artifacts and the manifest replaced.
  async function hydrateRelease() {
    try {
      var res = await fetch("version.json", { cache: "no-store" });
      if (!res.ok) return;
      var v = await res.json();
      var w = v.windows || {};
      var mb = function (n) { return (n / 1048576).toFixed(2) + " MB"; };
      var short = function (h) { return h.slice(0, 8) + "…" + h.slice(-6); };
      var set = function (id, text) { var el = document.getElementById(id); if (el) el.textContent = text; };
      var wire = function (prefix, art) {
        if (!art || !art.sha256) return;
        set("h-" + prefix, art.sha256);
        set("size-" + prefix, mb(art.bytes));
        set("tbl-size-" + prefix, mb(art.bytes));
        set("tbl-hash-" + prefix, short(art.sha256));
        var copy = document.getElementById("copy-" + prefix);
        if (copy) copy.setAttribute("data-copy", art.sha256);
      };
      wire("setup", w.installer);
      wire("portable", w.portable);
    } catch (e) { /* keep the static fallback values */ }
  }
  hydrateRelease();

  // Copy-to-clipboard for checksums.
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var text = btn.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(text);
        var old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = old; }, 1400);
      } catch (e) { /* clipboard blocked: the hash is still selectable */ }
    });
  });

  // Install prompt for the mobile PWA (only fires on supporting browsers).
  var installBtn = document.getElementById("install-app");
  if (installBtn) {
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      installBtn.hidden = false;
    });
    installBtn.addEventListener("click", async function () {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      installBtn.hidden = true;
    });
  }
})();
