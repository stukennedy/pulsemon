# Pulsemon

Purpose-built observability platform for **realtime applications** — voice AI, WebSocket-based systems, SSE streams, and long-running connections.

Think DataDog meets Honeycomb, designed specifically for the patterns that matter in voice/realtime.

## Features

- **Connection lifecycle traces** — WebSocket/SSE/gRPC from open → messages → close
- **Voice pipeline visibility** — ASR, TTS, LLM latency breakdown per stage
- **Trace waterfall** — Jaeger-style span visualisation with parent-child nesting
- **Faceted search** — filter by service, type, status, client, session
- **Realtime monitors** — voice latency, interruption, agent tool error, and connection error SLO checks
- **Real-time updates** — WebSocket-driven UI via HTMX

## Architecture

- **Hono** + Cloudflare Workers + D1 + Durable Objects
- **Vite** + JSX SSR + `vite-ssr-components`
- **HTMX 4** + WebSocket (`hx-ws`) for live updates
- **Tailwind CSS** dark theme
- **Drizzle ORM** for schema + migrations

## Schema

| Table | Purpose |
|-------|---------|
| `connections` | Long-lived connection tracking (WS/SSE/gRPC) |
| `spans` | OpenTelemetry-compatible trace spans |
| `events` | Discrete events within connections/spans |
| `metrics` | Time-series metrics (gauge/counter/histogram) |
| `logs` | Structured logs correlated to traces/connections |
| `voice_turns` | Turn-level voice state, transcripts, latency, token, and cost fields |
| `agent_tool_calls` | Agent tool execution, retries, inputs, outputs, and errors |
| `metric_rollups_1m` | 1-minute metric rollups produced by maintenance |
| `monitor_evaluations` | Realtime voice/agent/connection SLO snapshots |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — live stats, latency percentiles, service overview |
| `/connections` | Filterable connection list with faceted search |
| `/connections/:id` | Connection detail — events timeline, spans |
| `/logs` | Structured log browser with faceted search |
| `/metrics` | Queryable metrics summaries and recent samples |
| `/monitors` | Realtime voice, agent, and connection monitor evaluations |
| `/traces` | Trace list grouped by trace ID |
| `/traces/:id` | Waterfall trace view |
| `/voice` | Voice pipeline and realtime session summaries |
| `/sessions/:id` | Realtime voice/agent session timeline |

## Using Pulsemon

Pulsemon is instrumented over HTTP. This repo includes a TypeScript SDK in
`src/sdk`, and applications can also send JSON records directly to
`/api/ingest/*`. The UI reads those records from D1.

The basic model is:

- Create a `connection` when a long-lived channel opens.
- Add `events` for messages, errors, state changes, and other discrete moments.
- Add `spans` for timed operations such as `asr.transcribe`, `llm.generate`, or
  `tts.synthesize`.
- Patch the connection and any open spans when they finish.
- Reuse `connection_id`, `trace_id`, and `parent_span_id` to make the UI connect
  the records into connection detail pages and trace waterfalls.

### Ingest auth

All ingest routes require `Authorization: Bearer <INGEST_API_KEY>`.

For local development, create `.dev.vars`:

```bash
INGEST_API_KEY=local-dev-key
```

For a deployed Worker, set the secret:

```bash
wrangler secret put INGEST_API_KEY
```

Optional production controls:

```bash
wrangler secret put UI_BASIC_AUTH   # value format: username:password
wrangler secret put INGEST_API_KEYS # JSON map of bearer token to scopes
wrangler secret put INGEST_MAX_BYTES
wrangler secret put INGEST_REDACT_KEYS
wrangler secret put INGEST_ATTRIBUTE_DENY_KEYS
wrangler secret put INGEST_ATTRIBUTE_ALLOW_KEYS
wrangler secret put INGEST_MAX_ATTRIBUTE_KEYS
wrangler secret put INGEST_CARDINALITY_MAX_VALUES_PER_KEY
wrangler secret put DEFAULT_WORKSPACE_ID
wrangler secret put DEFAULT_PROJECT_ID
wrangler secret put MAINTENANCE_API_KEY
wrangler secret put ALERT_WEBHOOK_URL
wrangler secret put ALERT_WEBHOOK_SECRET
wrangler secret put UI_USERS
```

`UI_BASIC_AUTH` protects pages and read APIs with HTTP Basic auth when set.
`UI_USERS` can replace it with role-aware Basic auth. Admin routes require an
`admin` role; `viewer` users can read the UI but cannot run admin actions:

```json
{
  "alice": { "password": "secret", "role": "admin" },
  "bob": { "password": "readonly", "role": "viewer" }
}
```

`INGEST_MAX_BYTES` defaults to `1000000` bytes and rejects oversized ingest
payloads before decoding JSON.
`INGEST_API_KEYS` can replace `INGEST_API_KEY` when you need scoped keys, for
example `{ "logs-token": ["logs"], "admin-token": ["*"] }`. Scoped key entries
can also bind records to a workspace/project:

```json
{
  "voice-prod-token": {
    "scopes": ["connections", "traces", "logs", "metrics", "voice", "agent"],
    "workspace_id": "acme",
    "project_id": "voice-prod"
  },
  "admin-token": {
    "scopes": ["*"],
    "workspace_id": "acme",
    "project_id": "voice-prod"
  }
}
```

Read paths are filtered by `DEFAULT_WORKSPACE_ID` and `DEFAULT_PROJECT_ID`
(`default`/`default` when unset). Ingest records inherit the workspace/project
from the scoped key entry, or from those defaults when using the legacy single
`INGEST_API_KEY`. The mixed `/api/ingest/batch` endpoint requires a scoped key
with `*`.

Retention and rollups run from the Worker cron every 15 minutes and can also be
triggered with `POST /api/admin/maintenance` using
`Authorization: Bearer <MAINTENANCE_API_KEY>`. The defaults keep raw telemetry
for 30 days, roll up metric samples older than 5 minutes into
`metric_rollups_1m`, and keep rollups for 365 days. Override with:

```bash
RETENTION_DAYS=30
METRIC_ROLLUP_AFTER_MINUTES=5
METRIC_ROLLUP_RETENTION_DAYS=365
```

Manual maintenance attempts are stored in `audit_events`; admin users can read
recent audit entries from `/api/admin/audit`.

Ingest pressure controls are disabled by default. Set
`INGEST_RATE_LIMIT_PER_MINUTE` to cap requests per bearer token, workspace,
project, and scope. Set `INGEST_SAMPLE_RATE` between `0` and `1` to
deterministically sample high-volume events, metrics, and logs while retaining
connection and span lifecycle records.

Ingest governance is enabled by default before telemetry is persisted. Pulsemon
redacts common sensitive keys (`authorization`, `password`, `token`, `api_key`,
`secret`, cookies, and related variants), redacts emails, bearer tokens, and
Luhn-valid payment card numbers in text fields, and caps structured attribute
objects at 100 keys with string values capped at 4096 characters. Tune it with:

```bash
INGEST_REDACT_KEYS=authorization,password,token,api_key,secret
INGEST_ATTRIBUTE_DENY_KEYS=raw_audio,debug_payload
INGEST_ATTRIBUTE_ALLOW_KEYS=provider,model,region,session_id
INGEST_MAX_ATTRIBUTE_KEYS=100
INGEST_MAX_ATTRIBUTE_VALUE_LENGTH=4096
INGEST_CARDINALITY_MAX_VALUES_PER_KEY=0
INGEST_REDACT_TEXT=true
INGEST_REDACTION_DISABLED=false
```

`INGEST_CARDINALITY_MAX_VALUES_PER_KEY` is disabled at `0`. When set, Pulsemon
keeps a per-workspace/project/scope ledger of unique structured attribute/tag
values and rejects ingest that would exceed the configured unique-value budget
for a key such as `metrics.tags.provider` or `agent_tool_calls.input.customer_id`.

Monitor evaluations are available at `/monitors` and `/api/monitors`. They
currently cover ASR/LLM/TTS p95 latency, voice interruption rate, agent tool
error rate, and connection error rate over a 15-minute window, and each
evaluation is stored in `monitor_evaluations`. Alert incidents are opened and
resolved from those evaluations in `alert_incidents`; when `ALERT_WEBHOOK_URL`
is set, Pulsemon posts `opened` and `resolved` notifications and stores delivery
attempts in `alert_notifications`.

Voice sessions are available at `/voice`, `/sessions/:id`, `/api/sessions`, and
`/api/sessions/:id`. Session detail correlates voice turns, tool calls, spans,
logs, and events by `session_id`, `connection_id`, and `trace_id`.

### Minimal connection example

This records a WebSocket session with two message events and then closes the
connection:

```bash
export PULSEMON_URL=http://localhost:8788
export PULSEMON_KEY=local-dev-key
export CONNECTION_ID=conn_demo_1
export TRACE_ID=trace_demo_1

curl -s "$PULSEMON_URL/api/ingest/connections" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$CONNECTION_ID"'",
    "service": "voice-gateway",
    "connection_type": "ws",
    "client_id": "demo-client",
    "session_id": "demo-session",
    "metadata": { "path": "/voice" }
  }'

curl -s "$PULSEMON_URL/api/ingest/events" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "connection_id": "'"$CONNECTION_ID"'",
      "trace_id": "'"$TRACE_ID"'",
      "event_type": "message_received",
      "direction": "inbound",
      "size_bytes": 512,
      "data": { "type": "audio_chunk" }
    },
    {
      "connection_id": "'"$CONNECTION_ID"'",
      "trace_id": "'"$TRACE_ID"'",
      "event_type": "message_sent",
      "direction": "outbound",
      "size_bytes": 128,
      "data": { "type": "partial_transcript" }
    }
  ]'

curl -s -X PATCH "$PULSEMON_URL/api/ingest/connections/$CONNECTION_ID" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "closed",
    "ended_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
    "duration_ms": 4200,
    "close_reason": "client_disconnect"
  }'
```

Open `/connections` to see the session, and click it to inspect its events.

### Minimal trace example

Spans are how Pulsemon builds trace waterfalls. Use one `trace_id` for a single
request/session flow. Use `parent_span_id` when a span is nested under another
span. Send `duration_ms` if you want latency charts and waterfall widths to be
meaningful.

```bash
export ROOT_SPAN_ID=span_root_demo_1
export LLM_SPAN_ID=span_llm_demo_1

curl -s "$PULSEMON_URL/api/ingest/spans" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$ROOT_SPAN_ID"'",
    "trace_id": "'"$TRACE_ID"'",
    "connection_id": "'"$CONNECTION_ID"'",
    "service": "voice-gateway",
    "operation": "voice.turn",
    "duration_ms": 890,
    "status": "ok"
  }'

curl -s "$PULSEMON_URL/api/ingest/spans" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"$LLM_SPAN_ID"'",
    "trace_id": "'"$TRACE_ID"'",
    "parent_span_id": "'"$ROOT_SPAN_ID"'",
    "connection_id": "'"$CONNECTION_ID"'",
    "service": "llm-service",
    "operation": "llm.generate",
    "duration_ms": 640,
    "status": "ok",
    "attributes": { "model": "example-model" }
  }'
```

Open `/traces` and then the `trace_demo_1` trace to see the waterfall. The
`/voice` page groups spans by operation prefix, so operations starting with
`asr`, `llm`, and `tts` show in the voice pipeline view.

### Minimal log example

Logs are a first-class signal and can be linked back to traces, spans, and
connections:

```bash
curl -s "$PULSEMON_URL/api/ingest/logs" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "voice-gateway",
    "level": "error",
    "message": "provider timeout during realtime turn",
    "trace_id": "'"$TRACE_ID"'",
    "connection_id": "'"$CONNECTION_ID"'",
    "attributes": { "provider": "asr", "retryable": true }
  }'
```

Open `/logs` to filter logs by `service`, `level`, `trace`, `span`, or
`connection`.

### Minimal metric example

Metrics can be queried as recent samples and grouped summaries:

```bash
curl -s "$PULSEMON_URL/api/ingest/metrics" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "voice-gateway",
    "metric_name": "voice.latency_ms",
    "metric_type": "histogram",
    "value": 123.4,
    "tags": { "provider": "asr" }
  }'
```

Open `/metrics` to filter metrics by `service`, `name`, or `type`.

### OTLP-compatible JSON ingest

Pulsemon also accepts the common OTLP JSON export shapes and translates them
into its native signals:

```bash
curl -s "$PULSEMON_URL/api/ingest/otlp/v1/traces" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d @traces.json
```

The supported OTLP routes are `/api/ingest/otlp/v1/traces`,
`/api/ingest/otlp/v1/metrics`, and `/api/ingest/otlp/v1/logs`. JSON and
`application/x-protobuf` request bodies are supported, and both may use
`Content-Encoding: gzip`. The protobuf decoder covers the standard OTLP export
request shapes for resource spans, resource metrics, resource logs, attributes,
timestamps, IDs, status, gauge/sum datapoints, histogram count/sum datapoints,
and log bodies.

### Realtime voice and agent records

For realtime voice and agentic applications, Pulsemon has dedicated records for
turn-level voice state and tool calls:

```bash
curl -s "$PULSEMON_URL/api/ingest/voice/turns" \
  -H "Authorization: Bearer $PULSEMON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "'"$CONNECTION_ID"'",
    "session_id": "demo-session",
    "trace_id": "'"$TRACE_ID"'",
    "turn_index": 1,
    "role": "user",
    "transcript": "what is my account balance",
    "transcript_confidence": 0.96,
    "vad_start_ms": 120,
    "vad_end_ms": 1540,
    "asr_latency_ms": 240
  }'
```

### Instrumenting an app

Use the TypeScript SDK from `src/sdk` to keep instrumentation consistent:

```ts
import { PulsemonClient, traceparent } from "./src/sdk";

const pulsemon = new PulsemonClient({
  endpoint: process.env.PULSEMON_URL ?? "http://localhost:8788",
  apiKey: process.env.PULSEMON_KEY!,
  service: "voice-gateway",
  defaultAttributes: { environment: process.env.NODE_ENV },
});

const connection = await pulsemon.connection({
  connection_type: "ws",
  client_id: "demo-client",
  session_id: "demo-session",
});

await pulsemon.withSpan(
  {
    traceId: crypto.randomUUID().replaceAll("-", ""),
    connectionId: connection.id,
    operation: "llm.generate",
    attributes: { provider: "openai" },
  },
  async (span) => {
    await fetch("https://api.example/agent", {
      headers: { traceparent: traceparent(span) },
    });
  }
);

await pulsemon.log({
  level: "info",
  message: "agent response streamed",
  connection_id: connection.id,
});

await pulsemon.voiceTurn({
  connection_id: connection.id,
  session_id: "demo-session",
  role: "assistant",
  transcript: "Your account balance is...",
  llm_latency_ms: 850,
  tts_latency_ms: 320,
});
```

For high-volume services, buffer records and flush them through the batch
endpoint:

```ts
const batch = pulsemon.batcher()
  .log({ level: "info", message: "turn started" })
  .metric({ metric_name: "voice.latency_ms", metric_type: "histogram", value: 240 })
  .agentToolCall({
    tool_name: "lookup_account",
    status: "ok",
    duration_ms: 90,
  });

await batch.flush();
```

### Ingest endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/ingest/connections` | Open or record a connection |
| `PATCH` | `/api/ingest/connections/:id` | Close or update a connection |
| `POST` | `/api/ingest/spans` | Record a span |
| `PATCH` | `/api/ingest/spans/:id` | Close or update a span |
| `POST` | `/api/ingest/events` | Record one event or up to 500 events |
| `POST` | `/api/ingest/metrics` | Record one metric or up to 500 metrics |
| `POST` | `/api/ingest/logs` | Record one log or up to 1000 logs |
| `POST` | `/api/ingest/voice/turns` | Record voice turns with VAD, transcript, latency, token, and cost fields |
| `POST` | `/api/ingest/agent/tool-calls` | Record agent tool calls, retries, inputs, outputs, and errors |
| `POST` | `/api/ingest/batch` | Record up to 1000 mixed operations |
| `POST` | `/api/ingest/otlp/v1/traces` | Translate OTLP JSON traces into spans |
| `POST` | `/api/ingest/otlp/v1/metrics` | Translate OTLP JSON metrics into samples |
| `POST` | `/api/ingest/otlp/v1/logs` | Translate OTLP JSON logs into log records |

### Read APIs

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/connections` | HTML connection table for the UI |
| `GET` | `/api/logs` | HTML log table for the UI |
| `GET` | `/api/metrics` | HTML metrics table for the UI |
| `GET` | `/api/metrics/timeseries` | JSON bucketed metric series using raw samples or rollups |
| `GET` | `/api/traces` | HTML trace table for the UI |
| `GET` | `/api/sessions` | JSON realtime voice/agent session summaries |
| `GET` | `/api/sessions/:id` | JSON session timeline with turns, tools, spans, logs, and events |
| `GET` | `/api/monitors` | JSON realtime monitor evaluations |
| `GET` | `/api/admin/audit` | JSON audit events for admin users |

`connections` and `spans` inserts are idempotent by `id`: duplicate IDs are
ignored. Use the `PATCH` endpoints when a connection or span changes state after
it was first created.

## Development

```bash
bun install
bun test           # Run tests
bun run typecheck  # TypeScript checks
bun run build      # Production build
bun run dev        # Dev server on :8788
bun run routes     # Regenerate router after adding routes
bun run load:ingest # Configurable ingest load test
```

`load:ingest` requires `PULSEMON_KEY` and defaults to
`PULSEMON_URL=http://localhost:8788`. Tune it with
`PULSEMON_LOAD_REQUESTS`, `PULSEMON_LOAD_BATCH_SIZE`, and
`PULSEMON_LOAD_CONCURRENCY`.

CI runs on pushes and pull requests with `bun install --frozen-lockfile`,
`bun run typecheck`, `bun test`, and `bun run build`.

## Seed Data

```bash
bun scripts/generate-seed.ts > seed.sql   # Regenerate
# Apply to local D1:
# wrangler d1 execute pulsemon-db --file=./seed.sql
```

Generates 50 voice AI sessions with realistic data:
- Services: asr-service, llm-service, tts-service, voice-gateway, session-manager
- Connection types: WebSocket, SSE, gRPC
- Realistic latencies: ASR 200-800ms, LLM 300-2000ms, TTS 100-500ms
- ~12% error rate with timeouts, disconnects, model errors

## Migrations

```bash
bun run db:generate   # Generate from schema changes
bun run db:migrate    # Apply to D1
```
