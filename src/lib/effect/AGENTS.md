# Effect Services Agent Guide

This directory is the domain layer. It should contain the business behavior that
route handlers and scheduled jobs invoke.

## Local Map

- `schemas.ts`: Effect Schema request/input definitions.
- `errors.ts`: typed errors and HTTP status mapping.
- `repository.ts`: D1 write repository and schema-derived insert/update types.
- `ingest.ts`: native JSON ingest pipeline.
- `otlp.ts`, `otlp-protobuf.ts`: OTLP translation and protobuf decoding.
- `governance.ts`: redaction, allow/deny, caps, and telemetry safety.
- `pressure.ts`, `cardinality.ts`: rate limiting, sampling, and cardinality
  budgets.
- `query.ts`, `metric-series.ts`, `sessions.ts`: read-side query services.
- `monitors.ts`, `alerts.ts`, `slos.ts`, `maintenance.ts`, `audit.ts`: operator
  workflows and scheduled/admin behaviors.
- `auth.ts`: ingest API key and scope authorization.

## Service Shape

Use this shape for new domain functions:

```ts
export function doThing(
  deps: ThingDeps,
  raw: unknown
): Effect.Effect<Result, ThingError> {
  return Effect.gen(function* () {
    const input = yield* decode(InputSchema, raw);
    const auth = yield* authorizeIngest(deps);
    // validate, govern, persist
    return result;
  });
}
```

Prefer dependency objects for repositories/controllers/config rather than direct
global access. Keep `Env` parsing in routes or small `fromEnv` helpers.

## Data Safety

- Apply governance before persistence for telemetry payloads.
- Preserve `workspace_id` and `project_id` in inserts, updates, and reads.
- Keep idempotency for retryable ingest writes.
- Keep cardinality and pressure checks before repository writes.
- Do not log raw sensitive telemetry.
- Derive DB-facing row and write types from `@/db/schema`. API/request input
  types belong in Effect schemas; persisted table contracts should not be
  redeclared by hand.

## Error Standards

- Use typed errors from `errors.ts`.
- Validation problems should be `ValidationError`.
- Payload size problems should be `PayloadTooLargeError`.
- Storage failures should be `DatabaseError`.
- Unsupported content types/encodings should use `UnsupportedMediaTypeError`.

## Tests

- Add direct service tests in `src/test/lib` for domain behavior.
- Mock repositories/controllers by passing dependency objects.
- Route tests should not be the only coverage for non-trivial domain logic.
