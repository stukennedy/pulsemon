# pulsemon-browser

Browser SDK for Pulsemon: rrweb session replay plus heatmap, frustration and
error events, POSTed to the receiver's `/api/ingest/browser`.

## Purpose and boundary

- **The wire contract is `specs/browser-analytics.md`.** The receiver is built
  against the same spec. Change the spec and both sides in one PR, never one
  side alone. `src/wire.ts` is the only file that names a wire field or a cap.
- **It knows nothing about the receiver.** No imports from `../../src`. The
  package is typed against the DOM lib only (`types: []` in `tsconfig.json`).
- **Pure logic stays DOM-free** so it can be tested without a browser:
  `batch.ts` (splitting, buffer trimming), `session.ts` (sid, seq, sampling,
  rotation), `interactions.ts` (rage/dead rules, selectors, scroll depth),
  `transport.ts`. `browser.ts` wires them to `window`.

## Load-bearing invariants

**Never throws into the host page.** Every listener is wrapped by `safe()`,
`flush()` always resolves, and init failures return the no-op handle. A
telemetry bug must never break a customer's page.

**Private by default.** Inputs are always masked, `strict` masks all text,
query strings are stripped (including rrweb's Meta `href`), and click events
carry a structural selector, never text. Any new field that could carry user
content needs an explicit opt-in.

**Inert when unconfigured or sampled out.** The no-op handle sends nothing,
records nothing and adds no listeners.

**Pinned rrweb.** `@rrweb/record` and its whole rrweb family (`rrweb`,
`rrweb-snapshot`, `rrdom`, `@rrweb/types`, `@rrweb/utils`) are pinned exactly
to 2.1.6. `@rrweb/record` depends on the others with `^` ranges, so they are
listed directly to stop a resolver pulling a newer release. The same goes for
`ws`/`@types/ws` under happy-dom. Bump them together, and only to versions
published at least two weeks earlier.

```bash
bun run type-check
bun run test
bun run build
```
