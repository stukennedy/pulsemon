(function () {
  var root = document.getElementById("heatmap-root");
  if (!root) return;

  var mode = root.dataset.mode;
  var snapshotAt = Number(root.dataset.snapshotAt);
  var pageWidth = Number(root.dataset.snapshotWidth) || 1280;
  var snapshotHeight = Number(root.dataset.snapshotHeight) || 0;

  function getJson(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function message(text) {
    var note = document.createElement("div");
    note.className = "px-4 py-3 text-xs font-mono";
    note.style.color = "#64748b";
    note.textContent = text;
    root.appendChild(note);
  }

  // The recorded page is rendered at its original width, then the whole stage
  // (page + overlay) is scaled down together so coordinates stay aligned.
  function buildStage(pageHeight) {
    var scale = Math.min(1, (root.clientWidth || pageWidth) / pageWidth);
    var frame = document.createElement("div");
    frame.style.position = "relative";
    frame.style.width = pageWidth * scale + "px";
    frame.style.height = pageHeight * scale + "px";
    frame.style.overflow = "hidden";
    frame.style.margin = "0 auto";

    var stage = document.createElement("div");
    stage.style.position = "absolute";
    stage.style.left = "0";
    stage.style.top = "0";
    stage.style.width = pageWidth + "px";
    stage.style.height = pageHeight + "px";
    stage.style.transform = "scale(" + scale + ")";
    stage.style.transformOrigin = "0 0";
    stage.style.background = "#0b1120";

    var page = document.createElement("div");
    page.className = "pm-heatmap-page";
    page.style.position = "absolute";
    page.style.inset = "0";
    page.style.opacity = "0.55";
    page.style.pointerEvents = "none";

    var canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";

    stage.appendChild(page);
    stage.appendChild(canvas);
    frame.appendChild(stage);
    root.appendChild(frame);
    return { page: page, canvas: canvas };
  }

  function renderSnapshot(container, events, pageHeight) {
    if (!window.rrwebPlayer || !events || events.length < 2) return;
    var player = new window.rrwebPlayer.Player({
      target: container,
      props: { events: events, width: pageWidth, height: pageHeight, autoPlay: false, showController: false, skipInactive: false },
    });
    var start = player.getMetaData().startTime;
    player.goto(Math.max(0, snapshotAt - start + 500), false);
    var replayer = player.getReplayer();
    var wrapper = replayer.wrapper;
    var iframe = replayer.iframe;
    wrapper.style.transform = "none";
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    iframe.style.width = pageWidth + "px";
    iframe.style.height = pageHeight + "px";
    iframe.setAttribute("width", String(pageWidth));
    iframe.setAttribute("height", String(pageHeight));
    var mouse = wrapper.querySelector(".replayer-mouse");
    if (mouse) mouse.style.display = "none";
  }

  function drawClicks(canvas, points) {
    var context = canvas.getContext("2d");
    var radius = Math.max(14, Math.round(pageWidth / 60));
    var shadow = document.createElement("canvas");
    shadow.width = canvas.width;
    shadow.height = canvas.height;
    var alpha = shadow.getContext("2d");
    var weight = Math.min(0.6, Math.max(0.05, 8 / Math.sqrt(points.length || 1)));
    points.forEach(function (point) {
      var x = point.x * (pageWidth / point.vw);
      var y = point.y;
      var gradient = alpha.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(0,0,0," + weight + ")");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      alpha.fillStyle = gradient;
      alpha.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });

    var image = alpha.getImageData(0, 0, shadow.width, shadow.height);
    var data = image.data;
    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3] / 255;
      if (a === 0) continue;
      var hue = (1 - Math.min(1, a)) * 240;
      var rgb = hslToRgb(hue / 360, 1, 0.5);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = Math.min(220, 60 + a * 255);
    }
    context.putImageData(image, 0, 0);
  }

  function drawScroll(canvas, scroll) {
    var context = canvas.getContext("2d");
    var reach = scroll.reach || [];
    var height = canvas.height;
    for (var i = 0; i < reach.length - 1; i++) {
      var top = (reach[i].depth / 100) * height;
      var bottom = (reach[i + 1].depth / 100) * height;
      var share = reach[i + 1].percent / 100;
      var hue = share * 240;
      var rgb = hslToRgb((240 - hue) / 360, 0.9, 0.5);
      context.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.35)";
      context.fillRect(0, top, canvas.width, bottom - top);
      if (i % 2 === 1) {
        context.fillStyle = "rgba(255,255,255,0.85)";
        context.font = "600 " + Math.max(14, Math.round(pageWidth / 90)) + "px IBM Plex Mono, monospace";
        context.fillText(Math.round(reach[i + 1].percent) + "% reached " + reach[i + 1].depth + "%", 12, bottom - 6);
      }
    }
    if (typeof scroll.averageFold === "number") {
      var fold = (scroll.averageFold / 100) * height;
      context.strokeStyle = "rgba(255,255,255,0.9)";
      context.setLineDash([8, 6]);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, fold);
      context.lineTo(canvas.width, fold);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "rgba(255,255,255,0.9)";
      context.fillText("average fold", canvas.width - 160, fold - 6);
    }
  }

  function hslToRgb(h, s, l) {
    function channel(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [channel(p, q, h + 1 / 3), channel(p, q, h), channel(p, q, h - 1 / 3)].map(function (v) {
      return Math.round(v * 255);
    });
  }

  var data = getJson(root.dataset.dataUrl);
  var replay = root.dataset.eventsUrl ? getJson(root.dataset.eventsUrl).catch(function () { return null; }) : Promise.resolve(null);

  Promise.all([data, replay])
    .then(function (results) {
      var heat = results[0];
      var events = results[1];
      root.textContent = "";
      var maxY = (heat.points || []).reduce(function (max, point) { return Math.max(max, point.y + 40); }, 0);
      var pageHeight = Math.max(snapshotHeight, maxY, 800);
      var stage = buildStage(pageHeight);
      if (events) {
        renderSnapshot(stage.page, events, pageHeight);
      } else {
        message("No recorded snapshot for this page and device yet; showing the heatmap on a blank page.");
      }

      if (mode === "scroll") {
        if (!heat.scroll || heat.scroll.views === 0) message("No scroll data for this page in the selected window.");
        else drawScroll(stage.canvas, heat.scroll);
      } else if (!heat.points || heat.points.length === 0) {
        message("No clicks for this page in the selected window.");
      } else {
        drawClicks(stage.canvas, heat.points);
      }
    })
    .catch(function () {
      root.textContent = "";
      message("Could not load heatmap data.");
    });
})();
