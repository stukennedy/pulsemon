# Getting Started For Coding Agents

Use this when you need to understand Pulsemon quickly without reading every
file first.

## What Pulsemon Does

Pulsemon ingests telemetry from realtime applications and exposes operator
views for:

- long-lived connections;
- traces and spans;
- structured logs;
- metrics and metric rollups;
- realtime voice turns;
- agent tool calls;
- monitors, incidents, alert notifications, and SLOs;
- OTLP JSON/protobuf/gzip ingest.

## Fast Orientation

Read these files in order:

1. `AGENTS.md`
2. `README.md`
3. `src/index.ts`
4. `src/routes/api/ingest.ts`
5. `src/lib/effect/ingest.ts`
6. `src/lib/effect/repository.ts`
7. `src/test/helpers.ts`

For feature work, then read the nearest nested `AGENTS.md`.

## Development Setup

```bash
bun install
bun run dev
```

The dev server defaults to port `8788`.

For local ingest, create `.dev.vars`:

```bash
INGEST_API_KEY=local-dev-key
```

Then POST telemetry to `http://localhost:8788/api/ingest/*`.

## Verification Loop

Use the smallest useful test first while editing, then run the full gate before
handoff:

```bash
bun run typecheck
bun test
bun run build
bun run restore:check
```

The full gate is available as:

```bash
bun run check
```

## Common Tasks

### Add An Ingest Field

1. Update `src/lib/effect/schemas.ts`.
2. Update insert types and persistence in `src/lib/effect/repository.ts`.
3. Update governance if the field can contain structured data or sensitive text.
4. Update `src/db/schema.ts` and add a SQL migration.
5. Update `src/test/helpers.ts` seed helpers if the column is relevant to tests.
6. Add route/service tests.

### Add A Page Or API Route

1. Add a file under `src/routes`.
2. Keep the route thin and call an Effect service for behavior.
3. Run `bun run routes`.
4. Add a route/API test.

### Add A Monitor Or SLO Behavior

1. Start in `src/lib/effect/monitors.ts` or `src/lib/effect/slos.ts`.
2. Add or update definitions/evaluation logic.
3. Persist through D1 helpers in the same service or repository patterns.
4. Add service tests, then page/API tests.

### Add OTLP Support

1. Update `src/test/fixtures/otlp.ts`.
2. Update `src/lib/effect/otlp.ts` for JSON mapping.
3. Update `src/lib/effect/otlp-protobuf.ts` for protobuf mapping.
4. Update `src/test/api/otlp.test.ts`.
5. Update `specs/opentelemetry-compatibility.md`.

## Do Not Do This

- Do not hand-write migrations while Drizzle can express the schema change.
- Do not put domain behavior into JSX components.
- Do not bypass tenant scope.
- Do not persist telemetry before governance/redaction.
- Do not add Node-only APIs to Worker runtime code.
