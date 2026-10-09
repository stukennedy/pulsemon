# pulsemon-browser

Browser SDK for [Pulsemon](https://github.com/stukennedy/pulsemon): session replay
(rrweb), click and scroll heatmap events, rage and dead clicks, and JavaScript
errors. It is private by default. The wire contract is
[`specs/browser-analytics.md`](../../specs/browser-analytics.md).

## Install

```bash
bun add pulsemon-browser   # or npm i pulsemon-browser
```

```ts
import { initPulsemonBrowser } from 'pulsemon-browser';

const pulsemon = initPulsemonBrowser({
  endpoint: 'https://pulsemon.example.com',
  key: 'pk_live_app',
});

pulsemon.identify('user_8f2c');            // opaque id, never an email
pulsemon.track('checkout_started', { plan: 'pro', seats: 3 });
```

### Script tag

`dist/pulsemon-browser.iife.js` bundles everything, rrweb included, and exposes
`window.PulsemonBrowser = { init }`. When its own `<script>` tag has
`data-endpoint` and `data-key`, it starts itself, and the handle is at
`window.PulsemonBrowser.instance`.

```html
<script
  src="/vendor/pulsemon-browser.iife.js"
  data-endpoint="https://pulsemon.example.com"
  data-key="pk_live_app"
  data-privacy="strict"
></script>
```

Other attributes: `data-replay="false"`, `data-replay-sample-rate`,
`data-session-sample-rate`, `data-capture-query-string="true"`,
`data-flush-interval-ms`.

## Options

| Option | Default | |
| --- | --- | --- |
| `endpoint` | required | Base URL of the Pulsemon deployment. |
| `key` | required | Public key from `BROWSER_INGEST_KEYS`. The page's origin must be listed for it. |
| `replay.enabled` | `true` | Record rrweb replay. |
| `replay.sampleRate` | `1` | Fraction of recorded sessions that also capture replay. |
| `replay.privacy` | `"strict"` | `"strict"` masks all text; `"balanced"` masks inputs only. |
| `sessionSampleRate` | `1` | Fraction of sessions recorded at all. A sampled-out session sends nothing. |
| `captureQueryString` | `false` | Keep query strings in recorded URLs. |
| `flushIntervalMs` | `5000` | How often buffered data is sent (minimum 1000). |
| `fetch` | `window.fetch` | Injectable transport, for tests. |

The handle is `{ sessionId, identify(id), track(name, props?), flush(), stop() }`.
`flush()` always resolves.

The SDK is inert (a no-op handle with an empty `sessionId`) when `endpoint` or
`key` is missing, outside a browser, or when the session is sampled out. It
never throws into the host page: its own failures are swallowed and the data is
dropped.

## Privacy

- Input values are always masked.
- `strict` (the default) masks all page text in replays. Wrap content that is
  safe to show in `data-pulsemon-unmask` and it is recorded verbatim. Input
  values inside it stay masked.
- Anything inside `data-pulsemon-block` is not recorded at all; the replay shows
  a placeholder of the same size.
- The page title is sent only in `balanced` mode.
- Clicks carry a structural CSS selector (tag, id, up to two classes,
  `:nth-of-type`), never element text.
- Query strings and fragments are stripped from page URLs, the referrer and
  rrweb's Meta event unless `captureQueryString` is set. The referrer never
  carries a query string.
- Error `src` is `file:line:col` without the file's query string.
- The only storage the SDK reads or writes is its own `sessionStorage` key,
  `pulsemon_session`. It reads no cookies.

What it does not do: rrweb records attribute values such as `href`, `alt`,
`title` and `placeholder` as they are. Pages that put personal data in
attributes should mark those regions with `data-pulsemon-block`.

## Behaviour

- **Sessions.** One id per tab (`sessionStorage`), renewed after 30 minutes
  without a click, key press, scroll or navigation. The sampling decisions
  and `seq` are stored with it, so they hold across reloads.
- **Events.** `pageview` on load and on every SPA path change (`pushState`,
  `replaceState`, `popstate`, `hashchange`), preceded by the previous page's
  `scroll` depth. Changes to the hash alone do not count as a new page.
  `scroll` is also sent when the tab hides, and again later only if the depth
  has grown since. A click is held for 1 s, then sent as `rage_click` (the
  third or later click within 1 s and 30 px), `dead_click` (no DOM mutation,
  scroll or navigation within 1 s, on something that is not a value-entry
  control: `input`, `select`, `textarea`, `label`, `contenteditable`), or
  `click`. Rage takes precedence over dead. Coordinates are document CSS
  pixels. Errors come from `error` and `unhandledrejection`, at most 100 per
  page view.
- **Transport.** `POST {endpoint}/api/ingest/browser?key=…` with
  `Content-Type: text/plain`, gzip-compressed with `enc=gzip` when
  `CompressionStream` exists. Batches are split to stay within 1 MiB, 500
  events and 5000 rrweb events each. A single item that cannot fit in 1 MiB
  on its own, such as a huge full snapshot, is dropped. Bodies under 60 KB use
  `fetch` with `keepalive`. On `pagehide` or when the tab hides, the SDK uses
  `navigator.sendBeacon` when the body fits and falls back to a keepalive
  `fetch`.
- **Failure.** A batch that fails on the network is retried once, on the next
  flush, with the same `seq`, then dropped. A non-2xx response is not retried.
- **Memory.** The replay buffer is capped at about 5 MB. When it overflows,
  everything before the most recent full snapshot is dropped. If the data
  since that snapshot is still over the cap, the buffer is cleared and rrweb
  takes a fresh full snapshot. Interaction events are capped at 1000, oldest
  dropped first.

## Development

```bash
bun run type-check   # package (DOM-typed) + tests
bun run test         # bun test; happy-dom for the integration tests
bun run build        # dist/index.js (ESM, rrweb external), dist/pulsemon-browser.iife.js, .d.ts
```
