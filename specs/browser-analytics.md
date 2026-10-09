# Browser Analytics: Session Replay, Heatmaps and Frustration Signals

Pulsemon's answer to Hotjar-style product analytics. A browser SDK
(`packages/browser`, published as `pulsemon-browser`) records sessions with
rrweb and reports interaction events; the receiver stores replay chunks in R2
and an index in D1; the UI lists sessions, replays them, and draws click and
scroll heatmaps per page.

## Privacy defaults

- All input values are masked (`maskAllInputs`).
- `privacy: "strict"` (default) also masks all text. Elements inside
  `[data-pulsemon-unmask]` are shown verbatim. `privacy: "balanced"` masks
  inputs only.
- Elements inside `[data-pulsemon-block]` are not recorded at all (rendered as
  a placeholder of the same size).
- Click events carry a CSS selector, never element text.
- Query strings are stripped from recorded URLs unless `captureQueryString`.
- `identify(id)` takes an opaque id; the SDK never reads cookies or storage
  other than its own session key.

## Authentication

Browsers cannot hold the ingest secret. Browser ingest uses public keys from
`BROWSER_INGEST_KEYS`, a JSON object:

```json
{
  "pk_example": {
    "origins": ["https://app.example.com"],
    "workspace_id": "default",
    "project_id": "default"
  }
}
```

A request is accepted only when the key exists and the request's `Origin`
header is in `origins` (`"*"` allows any origin, for local development).
Responses carry `Access-Control-Allow-Origin` for the matched origin.

## Wire format

`POST /api/ingest/browser?key=<public key>[&enc=gzip]`

- `Content-Type: text/plain` so `fetch` and `sendBeacon` avoid a CORS
  preflight. `enc=gzip` means the body is gzip-compressed JSON (the SDK uses
  `CompressionStream` when available). The receiver also answers `OPTIONS`.
- Body limit: 1 MiB after decompression, at most 500 `events` and 5000
  `rrweb` events per batch. The SDK splits larger batches.

```ts
interface BrowserBatch {
  v: 1;
  sid: string;            // session id, [A-Za-z0-9_-]{8,64}
  seq: number;            // monotonic per session, starting at 0
  uid?: string;           // identify() value, <= 128 chars
  page: {
    url: string;          // origin + path (+ query if opted in), <= 2048
    path: string;         // pathname, <= 1024
    title?: string;       // <= 256; omitted in strict privacy
    referrer?: string;    // origin + path only
    vw: number;           // viewport width, CSS px
    vh: number;           // viewport height
  };
  rrweb?: unknown[];      // rrweb events since the last batch; absent when replay is sampled out
  events: BrowserEvent[];
}

type BrowserEvent =
  | { t: number; type: "pageview"; path: string; vw: number; vh: number; dh: number }
  | { t: number; type: "click" | "rage_click" | "dead_click"; path: string;
      sel: string; x: number; y: number; vw: number; vh: number; dh: number }
  | { t: number; type: "scroll"; path: string; depth: number; vw: number; dh: number }
  | { t: number; type: "error"; path: string; msg: string; src?: string }
  | { t: number; type: "custom"; path: string; name: string; props?: Record<string, string | number | boolean> };
```

- `t` is epoch milliseconds.
- `x`/`y` are document coordinates (page offset included), `dh` is the document
  height at the time of the event.
- `scroll.depth` is the maximum percentage (0-100) of the document seen on this
  page view; the SDK sends one when the user leaves the page or the tab hides.
- A click becomes `rage_click` when it is the third or later click within 1 s
  inside a 30 px radius; `dead_click` when nothing mutates the DOM, navigates or
  scrolls within 1 s and the target is not a form control.
- `sel` is at most 512 chars, `msg` at most 500, `name` at most 128, at
  most 20 `props`.

Response: `202 {"accepted": <events>, "replayBytes": <n>}`.

## Storage

- R2 (`RAW_TELEMETRY`):
  `browser-replay/workspace=<w>/project=<p>/session=<sid>/<seq>.json`, one
  object per batch holding the rrweb array.
- D1 `browser_sessions`: one row per session, upserted per batch (counts,
  first/last seen, entry/exit path, device class, replay chunk list).
- D1 `browser_events`: one row per interaction event.

Device class: `mobile` when `vw < 768`, `tablet` when `vw < 1024`, otherwise
`desktop`.

## UI

- `/replays`: sessions with duration, pages, clicks, frustration counts,
  device; filters for path, device and "has frustration/error".
- `/replays/:id`: rrweb player plus an event timeline that seeks the player.
- `/heatmaps?path=&device=&type=`: click heatmap (or rage/dead clicks) and a
  scroll-depth map, drawn over a snapshot of that page taken from the most
  recent recorded session.

## Not in this phase

Surveys and feedback widgets, funnels, and linking browser sessions to backend
traces (W3C `traceparent` from the SDK).
