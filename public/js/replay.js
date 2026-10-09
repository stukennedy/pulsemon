(function () {
  var root = document.getElementById("replay-root");
  if (!root || !window.rrwebPlayer) return;

  fetch(root.dataset.eventsUrl, { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (events) {
      root.textContent = "";
      if (!Array.isArray(events) || events.length < 2) {
        root.textContent = "Not enough replay data to play this session.";
        return;
      }
      var width = Math.max(320, root.clientWidth - 8);
      var player = new window.rrwebPlayer.Player({
        target: root,
        props: {
          events: events,
          width: width,
          height: Math.round(width * 0.56),
          autoPlay: false,
          skipInactive: true,
          showController: true,
          mouseTail: { strokeStyle: "#22d3ee", lineWidth: 2 },
        },
      });
      var start = player.getMetaData().startTime;
      document.querySelectorAll("[data-seek]").forEach(function (button) {
        button.addEventListener("click", function () {
          player.goto(Math.max(0, Number(button.dataset.seek) - start - 1000), true);
        });
      });
    })
    .catch(function () {
      root.textContent = "Could not load this replay.";
    });
})();
