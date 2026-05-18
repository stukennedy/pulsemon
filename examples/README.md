# Pulsemon Local Logging Example

This example runs a small Bun HTTP application that sends structured logs,
request spans, and request-duration metrics to a local Pulsemon Worker at
`http://localhost:8788`.

## Run It

In the Pulsemon repo, create `.dev.vars` for the local Worker:

```bash
INGEST_API_KEY=local-dev-key
```

Start Pulsemon:

```bash
bun run dev
```

In another terminal, start the example app:

```bash
PULSEMON_URL=http://localhost:8788 \
PULSEMON_KEY=local-dev-key \
bun run example:logs
```

Generate telemetry:

```bash
curl http://localhost:3001/
curl http://localhost:3001/checkout
curl http://localhost:3001/error
```

Then open:

- `http://localhost:8788/logs`
- `http://localhost:8788/traces`
- `http://localhost:8788/metrics`

## How Security Works

Ingest is server-to-server. Every ingest request uses:

```http
Authorization: Bearer <token>
```

For this local example, Pulsemon accepts `local-dev-key` because `.dev.vars`
sets:

```bash
INGEST_API_KEY=local-dev-key
```

The example app sends the same value as `PULSEMON_KEY`. If the token is missing
or wrong, Pulsemon returns `401 Unauthorized` and stores nothing.

For production, prefer `INGEST_API_KEYS` instead of the single local
`INGEST_API_KEY`. Scoped keys can limit a token to only the telemetry signals it
needs, for example `["logs", "metrics", "traces"]`, and can bind writes to a
specific `workspace_id` and `project_id`.

Do not put ingest keys in browser code. Instrument backend services, edge
workers, collectors, and trusted server-side jobs. Browser telemetry should go
through your backend or a dedicated scoped collector path.
