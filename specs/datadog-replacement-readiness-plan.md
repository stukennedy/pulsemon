# Datadog Replacement Readiness Plan

## Goal

Make Pulsemon credible as a production observability platform for realtime,
agentic, and realtime voice systems. The target is not feature parity with every
Datadog product surface; it is enough capability, reliability, and ergonomics
for a platform team to adopt Pulsemon as the primary telemetry surface for
logs, traces, metrics, realtime sessions, and agent workflows.

## Done Foundation

- Effect-based ingest, query, repository, auth, pressure, maintenance, and
  monitor boundaries.
- Native JSON ingest for connections, spans, events, metrics, logs, voice turns,
  and agent tool calls.
- OTLP JSON ingest for traces, metrics, and logs.
- Logs, metrics, traces, connections, voice pipeline, and monitor UI surfaces.
- Workspace/project tenancy and scoped ingest keys.
- UI auth, payload limits, rate limits, deterministic sampling, retention,
  metric rollups, and monitor evaluations.

## Remaining Work

### 1. First-Party Instrumentation SDK

Ship a TypeScript SDK that app teams can install or copy into services.

- Typed client configuration: endpoint, key, service name, default tags,
  retries, batching, and custom fetch.
- Helpers for connections, spans, events, logs, metrics, voice turns, and agent
  tool calls.
- `withSpan` / `recordSpan` wrappers with error capture and duration timing.
- W3C traceparent parse/inject helpers.
- Buffered batch transport with explicit flush.
- Retry/backoff for network, 429, and 5xx failures.
- Documentation and examples for realtime voice and agentic apps.

### 2. Voice And Agent Product UI

Move from ingest-only models to an operator-grade investigation surface.

- Session timeline combining connection, voice turns, spans, logs, events, and
  agent tool calls.
- Transcript timeline with confidence, VAD, interruption, and latency overlays.
- Tool-call waterfall with retries, inputs, outputs, and errors.
- Provider/model latency and token/cost breakdowns.
- Search facets for session, tool, role, provider, state, interruption, and
  status.

### 3. Rollup-Aware Metrics

Make metrics useful across long time windows.

- Time-range parameters for metric queries.
- Bucketed timeseries API using raw samples for short windows and
  `metric_rollups_1m` for longer windows.
- UI charts for latency, counters, error rates, token/cost, and realtime voice
  quality signals.
- Group-by service/name/type/tag support with guardrails for cardinality.

### 4. Alert Delivery And Incident State

Turn monitor evaluations into actionable alerting.

- Persistent monitor definitions rather than fixed built-in rules.
- Notification targets: webhook first, then Slack/email/PagerDuty.
- Alert state machine: ok, pending, firing, resolved, suppressed.
- Deduplication, cooldowns, and recovery notifications.
- Audit trail of evaluations and notifications.

### 5. OTLP And Collector Hardening

Make standard instrumentation work with minimal custom code.

- OTLP protobuf support for traces, metrics, and logs. Initial decoder support
  is in place for the export request shapes Pulsemon maps into native records.
- gzip/deflate request handling where Workers supports it.
- Better resource/scope attribute handling and semantic conventions.
- Collector configuration examples.
- Compatibility tests with representative OpenTelemetry payloads.

### 6. Operations Hardening

Prepare for real deployments.

- CI for typecheck, tests, build, migrations, and route generation drift.
- Staging/prod environment docs and migration workflow.
- Backup/restore and D1 capacity guidance.
- Load tests for ingest pressure, query latency, and retention maintenance.
- Synthetic smoke checks for ingest, query, UI auth, and scheduled maintenance.

### 7. Governance And Safety

Control risk in high-volume, multi-team telemetry.

- PII redaction and attribute allow/deny lists.
- Cardinality budgets per workspace/project/scope.
- Per-signal retention and sampling policies.
- RBAC and audit logs beyond Basic auth. Initial UI roles and admin audit
  events are in place; full enterprise SSO/team policy remains.

## Execution Order

1. Build the TypeScript SDK.
2. Add voice/agent session query APIs and UI.
3. Add rollup-aware metric timeseries APIs and charts.
4. Add configurable monitors, alert state, and webhook delivery.
5. Add OTLP protobuf/gzip hardening.
6. Add CI/deployment/load-test hardening.
7. Add governance controls.

## Progress Log

- 2026-05-14: created the Datadog replacement readiness plan and started the
  TypeScript SDK slice.
- 2026-05-14: added the first TypeScript SDK implementation with typed client
  helpers, W3C traceparent utilities, retrying transport, `withSpan`, buffered
  batching, and SDK tests.
- 2026-05-14: started voice/agent product UI by adding session summaries,
  `/api/sessions`, `/api/sessions/:id`, `/sessions/:id`, and a timeline that
  correlates voice turns, agent tool calls, spans, logs, and events.
- 2026-05-14: added rollup-aware metric series querying with
  `/api/metrics/timeseries` and a metrics-page trend chart that switches from
  raw samples to `metric_rollups_1m` for longer windows.
- 2026-05-14: added alert incident state and webhook delivery for monitor
  evaluations, including firing/resolved incidents, notification history,
  scheduled processing, and route-triggered processing from `/monitors` and
  `/api/monitors`.
- 2026-05-14: hardened OTLP transport handling by supporting gzip-compressed
  JSON bodies, validating content type/encoding, and returning explicit 415
  responses for protobuf payloads until a protobuf decoder is added.
- 2026-05-14: added baseline operations hardening with GitHub Actions CI for
  typecheck/tests/build and a configurable `bun run load:ingest` script for
  batch ingest load testing.
- 2026-05-14: started governance controls with default ingest-time sensitive key
  redaction, text PII redaction, attribute allow/deny lists, attribute key/value
  caps, native ingest wiring, and OTLP ingest wiring.
- 2026-05-14: added persistent cardinality budgets for structured ingest
  attributes and tags, backed by a workspace/project/scope D1 ledger and
  enforced before telemetry persistence.
- 2026-05-14: added role-aware UI users, admin-only audit reads, and audit
  events for manual maintenance attempts and outcomes.
- 2026-05-14: added OTLP protobuf request decoding for traces, metrics, and
  logs, including resource attributes, span IDs/status, metric datapoints,
  log bodies, and gzip-compatible binary request handling.
- 2026-05-14: added an operations readiness runbook and `bun run smoke` for
  deployment-level ingest/query/maintenance smoke checks.
