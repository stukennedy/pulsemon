# Pulsemon

Purpose-built observability platform for **realtime applications** — voice AI, WebSocket-based systems, SSE streams, and long-running connections.

Think DataDog meets Honeycomb, designed specifically for the patterns that matter in voice/realtime.

## Features

- **Connection lifecycle traces** — WebSocket/SSE/gRPC from open → messages → close
- **Voice pipeline visibility** — ASR, TTS, LLM latency breakdown per stage
- **Trace waterfall** — Jaeger-style span visualisation with parent-child nesting
- **Faceted search** — filter by service, type, status, client, session
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

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — live stats, latency percentiles, service overview |
| `/connections` | Filterable connection list with faceted search |
| `/connections/:id` | Connection detail — events timeline, spans |
| `/traces` | Trace list grouped by trace ID |
| `/traces/:id` | Waterfall trace view |
| `/voice` | Voice pipeline view — ASR→LLM→TTS flow |

## Using Pulsemon

Pulsemon is instrumented over HTTP. There is no SDK or OpenTelemetry collector in
this repo yet: your application sends JSON records to `/api/ingest/*`, and the UI
reads those records from D1.

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
`/api/ingest/otlp/v1/metrics`, and `/api/ingest/otlp/v1/logs`.

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

A small wrapper is enough for most services:

```ts
const pulsemonUrl = process.env.PULSEMON_URL ?? "http://localhost:8788";
const pulsemonKey = process.env.PULSEMON_KEY;

async function ingest(path: string, body: unknown, method = "POST") {
  if (!pulsemonKey) return;

  await fetch(`${pulsemonUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pulsemonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function recordSpan<T>(
  input: {
    traceId: string;
    connectionId?: string;
    parentSpanId?: string;
    service: string;
    operation: string;
    attributes?: Record<string, unknown>;
  },
  fn: () => Promise<T>
) {
  const spanId = crypto.randomUUID();
  const startedAt = new Date();
  const start = performance.now();

  try {
    const result = await fn();
    await ingest("/api/ingest/spans", {
      id: spanId,
      trace_id: input.traceId,
      parent_span_id: input.parentSpanId,
      connection_id: input.connectionId,
      service: input.service,
      operation: input.operation,
      started_at: startedAt.toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - start),
      status: "ok",
      attributes: input.attributes,
    });
    return result;
  } catch (error) {
    await ingest("/api/ingest/spans", {
      id: spanId,
      trace_id: input.traceId,
      parent_span_id: input.parentSpanId,
      connection_id: input.connectionId,
      service: input.service,
      operation: input.operation,
      started_at: startedAt.toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - start),
      status: "error",
      status_message: error instanceof Error ? error.message : String(error),
      attributes: input.attributes,
    });
    throw error;
  }
}
```

For high-volume services, buffer records and flush them through
`POST /api/ingest/batch` instead of sending one request per record.

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

`connections` and `spans` inserts are idempotent by `id`: duplicate IDs are
ignored. Use the `PATCH` endpoints when a connection or span changes state after
it was first created.

## Development

```bash
bun install
bun test           # Run tests
bun run dev        # Dev server on :8788
bun run routes     # Regenerate router after adding routes
```

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
