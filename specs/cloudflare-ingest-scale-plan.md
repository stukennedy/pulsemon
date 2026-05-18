# Cloudflare Ingest Scale Plan

## Purpose

Document the expected Cloudflare platform pressure points for high-frequency
Pulsemon ingest and query traffic, and define the architecture needed before
positioning Pulsemon as a broad Datadog replacement for realtime, agentic, and
realtime voice workloads.

## Recommendation

D1 should not be the raw telemetry firehose for production-scale logs, traces,
events, and metrics. Keep D1 for control-plane data, tenant/project metadata,
monitor and SLO definitions, recent query indexes, rollups, alert state,
cardinality ledgers, and small operational records. Move high-volume raw
telemetry through a buffered ingest path and store raw records in a storage
layer designed for large append-heavy datasets.

The target ingestion shape is:

```text
SDK / OTLP collector
  -> HTTP ingest Worker
  -> validation, auth, redaction, sampling envelope
  -> Cloudflare Queue
  -> queue consumer batches
  -> raw telemetry store for logs/traces/events/metrics
  -> D1 summaries, indexes, rollups, monitor/SLO state
```

## Platform Limits Considered

Last checked: 2026-05-16.

- Workers Paid has no daily request limit, 128 MB memory per isolate, 10,000
  subrequests per request, six simultaneous outgoing connections per request,
  and CPU can be configured up to five minutes for HTTP requests. Source:
  <https://developers.cloudflare.com/workers/platform/limits/>
- D1 has a 10 GB maximum database size on Workers Paid, 1,000 D1 queries per
  Worker invocation on Workers Paid, 100 bound parameters per query, and a
  30-second maximum SQL query duration. D1 also processes queries one at a time
  per individual database, so throughput falls directly with query duration.
  Source: <https://developers.cloudflare.com/d1/platform/limits/>
- A single Durable Object is single-threaded and has a soft limit around 1,000
  requests per second. Individual objects can overload, but namespaces scale
  horizontally when traffic is spread across many object IDs. Source:
  <https://developers.cloudflare.com/durable-objects/platform/limits/>
- Cloudflare Queues allow 128 KB messages, 100-message consumer batches,
  100-message `sendBatch` calls with a 256 KB total cap, 5,000 messages/sec per
  queue, 250 concurrent push-based consumer invocations, and 15-minute consumer
  wall time. Source: <https://developers.cloudflare.com/queues/platform/limits/>

## Current Pulsemon Risk Areas

### Direct D1 Ingest

`src/lib/effect/ingest.ts` allows up to 1,000 operations per native batch.
`src/lib/effect/repository.ts` maps most telemetry records to one D1 statement
per record in `db.batch()`. That is close to the paid D1 per-invocation query
limit before rate-limit, cardinality, auth, or future enrichment queries are
included.

Immediate action:

- Reduce max synchronous D1 batch operations well below 1,000.
- Prefer `/api/ingest/batch` for local/dev and controlled staging, not as the
  final production firehose.
- Add queue-backed ingest that returns `202 Accepted` once validated and
  enqueued.

### D1-Backed Pressure Controls

`src/lib/effect/pressure.ts` does a D1 upsert plus read for request
rate-limiting. `src/lib/effect/cardinality.ts` can run many reads per batch
when checking per-attribute value budgets. These controls are useful, but under
large traffic they compete with the telemetry writes they are trying to
protect.

Immediate action:

- Keep D1-backed pressure controls for controlled rollout.
- Add an edge-native or sharded limiter for production firehose tokens.
- Make cardinality enforcement aggregate-first and cache-aware so one batch
  does not create many serial D1 reads.

### Query And UI Reads

The search UI Durable Object is not in the ingest path, but it can amplify read
load. `src/lib/search-session.ts` issues D1 queries on WebSocket connect,
suggest, tag changes, and refreshes. `src/lib/facets.ts` uses distinct facet
queries and `LIKE "%prefix%"`, which will not use normal prefix indexes well.
`src/lib/stats.ts` loads span latency rows into Worker memory to calculate
percentiles.

Immediate action:

- Debounce and cancel stale search requests server-side, not only in the
  browser.
- Store pre-aggregated facet dictionaries or prefix-search rows for common
  dimensions.
- Move dashboard percentile calculations to rollup tables instead of loading
  raw span rows.
- Key `SearchSession` by browser/session ID rather than tenant + IP + view to
  avoid shared NAT hot objects and cross-tab shared state.

### Scheduled Maintenance

`src/lib/effect/maintenance.ts` rolls up old metrics by scanning metric rows and
deletes old records using `datetime(column)` expressions. At high volume this
risks long D1 query times and the 30-second SQL duration ceiling.

Immediate action:

- Replace full old-data scans with watermark-driven incremental rollups.
- Delete in bounded chunks.
- Avoid wrapping indexed timestamp columns in `datetime()` in hot filters.
- Track maintenance duration and changed-row counts as first-class metrics.

## Target Storage Roles

### D1

Use D1 for:

- tenants, projects, auth policy, audit records, monitor definitions, SLO
  definitions, alert incidents, notification history.
- recent small indexes needed by the UI.
- rollups and summaries used for monitor/SLO evaluation and dashboard cards.
- cardinality ledgers and capacity run metadata.

Do not rely on one D1 database for:

- long-term raw logs.
- high-frequency metric samples.
- full trace/span retention at platform scale.
- per-message realtime voice events at high traffic.

### Queue

Use Queues to:

- decouple client response latency from persistence latency.
- smooth burst traffic.
- enforce bounded consumer concurrency.
- retry transient raw-store/D1 failures.
- route high-cardinality or large payloads to slower persistence paths.

### Raw Telemetry Store

Evaluate and choose one or more:

- R2 for compressed raw event blocks, partitioned by tenant/project/signal/date.
- Analytics Engine or an external columnar/time-series backend for high-volume
  metrics and log analytics.
- External OpenTelemetry-compatible backend if Pulsemon should remain a control
  and realtime-investigation layer rather than own all raw storage.

## Implementation Plan

### Phase 1: Guardrails

- Lower synchronous D1 batch limits and make them configurable per deployment.
- Add explicit capacity targets to `specs/operations-readiness.md`: max ingest
  p95, max D1 query latency, max queue backlog age, max failure rate.
- Add D1 query count/latency observations to load and capacity scripts where
  Cloudflare exposes them.
- Add indexes or query changes that remove `datetime(column)` wrappers from hot
  read/write paths.

### Phase 2: Queue-Backed Ingest

- [x] Add a queue binding in `wrangler.jsonc` for telemetry ingest.
- [x] Add an ingest mode flag:
  - `direct`: current synchronous D1 writes for local/dev.
  - `queued`: validate/auth/govern/sample then enqueue and return `202`.
- [x] Add queue message envelopes with tenant, scope, signal, normalized records,
  idempotency keys, and version.
- [x] Add a queue consumer that batches writes and enforces per-consumer caps below
  D1 query limits.
- [ ] Add queue backlog/dead-letter monitoring and replay tooling.

### Phase 3: Raw Store Separation

- Write raw logs/events/spans/metric samples to the selected raw telemetry
  store.
- Continue writing D1 rollups/index rows needed by UI, monitors, SLOs, and
  recent investigations.
- Add query APIs that can read D1 summaries first and fetch raw detail only when
  the user drills in.

### Phase 4: Durable Object And UI Read Hardening

- Introduce browser/session-scoped `SearchSession` IDs.
- Add server-side stale-request suppression for suggest and refresh messages.
- Add pre-aggregated facet dictionaries and rollup-backed dashboard queries.
- Add load tests for concurrent UI WebSocket sessions, not only ingest traffic.

### Phase 5: Evidence Gate

Before calling the system a production Datadog replacement candidate, capture:

- capacity run outputs for representative agentic and realtime voice traffic.
- queue backlog and consumer latency under burst load.
- D1 database size growth per million telemetry records.
- p95/p99 ingest acknowledgement latency.
- p95/p99 query latency for dashboard, trace detail, log search, metric series,
  session timeline, monitor evaluation, and SLO evaluation.
- failure/retry/dead-letter rates during raw-store and D1 partial outages.

## Open Decisions

- Which raw telemetry store should be primary for high-volume records.
- Whether to shard D1 by tenant/project or keep one D1 database for control
  plane plus rollups.
- Whether monitor/SLO evaluation should run from D1 rollups only or from the
  raw analytics store for larger windows.
- Whether to require OpenTelemetry Collector in production so SDKs send fewer
  direct requests to Pulsemon.
