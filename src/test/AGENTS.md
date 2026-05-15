# Tests Agent Guide

Tests use Bun and an in-memory SQLite shim that applies every migration before
each test context.

## Structure

- `helpers.ts`: `createTestContext`, D1 shim, seed helpers.
- `api/`: route/API tests through Hono requests.
- `lib/`: direct Effect service and query tests.
- `sdk/`: client SDK tests.
- `fixtures/`: shared deterministic payloads, especially OTLP fixtures.
- `routes.test.ts`: page-level route smoke tests.

## Test Standards

- Prefer focused tests with deterministic data.
- Use `createTestContext({ env })` for route tests.
- Use seed helpers for common rows; update helpers when schema changes.
- For ingest/schema changes, assert data was persisted with the expected D1
  columns.
- For auth changes, test both allowed and denied paths.
- For operations scripts, at least compile with `bun build` if the script needs
  live credentials to execute.

## Commands

```bash
bun test
bun test src/test/api/otlp.test.ts
bun test src/test/lib/effect-ingest.test.ts
```

Run `bun run typecheck` after changing tests because the test tsconfig is part
of the strict type gate.
