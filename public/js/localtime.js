/**
 * Render `<time datetime="…">` elements in the VIEWER's timezone.
 *
 * Every timestamp in Pulsemon is formatted server-side, and Workers run in
 * UTC — so the strings were UTC regardless of who was looking, which made
 * "when did this happen" a mental arithmetic exercise. Components render a
 * UTC fallback inside <time> (truthful without JS); this script rewrites the
 * text locally.
 *
 * data-fmt selects the shape:
 *   time      → 09:28:55            (tables — same width as the old strings)
 *   datetime  → 12 Aug, 09:28:55    (detail views)
 *   date      → 12 Aug 2026
 *
 * Re-runs after HTMX swaps and hx-ws pushes via a MutationObserver on <body>
 * — one hook covers both, plus anything else that inserts markup.
 */
(function () {
  "use strict";

  var FMT = {
    time: { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
    "time-ms": {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      fractionalSecondDigits: 3, hour12: false,
    },
    datetime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
    date: { day: "numeric", month: "short", year: "numeric" },
  };

  function localise(root) {
    var nodes = (root.querySelectorAll ? root : document).querySelectorAll
      ? (root.querySelectorAll ? root : document).querySelectorAll("time[datetime]:not([data-localised])")
      : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var iso = el.getAttribute("datetime");
      var d = new Date(iso);
      if (isNaN(d.getTime())) continue;
      var fmt = FMT[el.getAttribute("data-fmt") || "time"] || FMT.time;
      el.textContent = d.toLocaleString(undefined, fmt);
      el.setAttribute("data-localised", "");
      // The full local+zone string on hover settles any residual doubt.
      el.setAttribute("title", d.toString());
    }
  }

  function run() {
    localise(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  // One observer covers htmx swaps, hx-ws pushes and anything else that
  // mutates the DOM. Scoped to childList so text edits don't retrigger.
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length > 0) {
        run();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
