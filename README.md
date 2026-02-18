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

## Development

```bash
bun install
bun test           # Run tests (21 tests, all passing)
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
