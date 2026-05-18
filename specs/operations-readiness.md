# Operations Readiness Runbook

This is the minimum operating model for treating Pulsemon as a production
observability surface rather than a demo Worker.

## Environments

Use separate Cloudflare Workers and D1 databases for staging and production.
Keep the same binding names, but use separate database IDs and secrets per
environment.

Required secrets:

- `INGEST_API_KEYS` for scoped app/collector tokens.
- `UI_USERS` for admin/viewer access.
- `UI_SESSION_SECRET`, `UI_ROLE_GROUPS`, and OIDC client settings when SSO is
  enabled.
- `MAINTENANCE_API_KEY` for scheduled/manual maintenance automation.
- `ALERT_WEBHOOK_URL` and `ALERT_WEBHOOK_SECRET` when alert delivery is enabled.

Recommended controls:

- `INGEST_MAX_BYTES=1000000`
- `INGEST_MODE=queued` for production traffic after the queue binding and
  dead-letter queue exist.
- `INGEST_QUEUE_MAX_BYTES=100000` unless capacity tests prove a lower bound is
  needed.
- `INGEST_RATE_LIMIT_PER_MINUTE` sized per ingest token.
- `INGEST_SAMPLE_RATE=1` initially, lowered only for high-volume events/logs.
- `INGEST_CARDINALITY_MAX_VALUES_PER_KEY` enabled after observing normal tag
  cardinality in staging.
- `RETENTION_DAYS`, `METRIC_ROLLUP_AFTER_MINUTES`, and
  `METRIC_ROLLUP_RETENTION_DAYS` set explicitly rather than relying on defaults.

## Migration Workflow

1. Run `bun run typecheck`, `bun test`, and `bun run build`.
2. Review unapplied migrations:

```bash
wrangler d1 migrations list pulsemon-db --remote
```

3. Apply migrations to staging first:

```bash
wrangler d1 migrations apply pulsemon-db --remote --env staging
```

4. Run smoke checks against staging:

```bash
PULSEMON_URL=https://staging.example.com \
PULSEMON_KEY=<staging-ingest-key> \
PULSEMON_BASIC_AUTH=admin:secret \
bun run smoke
```

5. Apply migrations to production and run the same smoke check.

## Backups And Restore

Export D1 before production migrations and on a regular schedule:

```bash
wrangler d1 export pulsemon-db --remote --output backups/pulsemon-$(date +%Y%m%d%H%M).sql
```

Restore options:

- Prefer Cloudflare D1 Time Travel for point-in-time restore or fork.
- For SQL exports, restore into a fresh D1 database with `wrangler d1 execute`
  and move traffic only after smoke checks pass.
- Validate the current migration set and any exported SQL before relying on the
  backup:

```bash
bun run restore:check
bun run restore:check backups/pulsemon-202605141200.sql
```

Useful D1 checks:

```bash
wrangler d1 info pulsemon-db --remote
wrangler d1 insights pulsemon-db --remote
```

Restore drill pass criteria:

- All ordered migrations apply cleanly to an empty database.
- The exported SQL imports without parser or constraint errors.
- Required observability tables are present.
- Smoke checks pass against the restored database before traffic is moved.
- Any orphaned trace/log correlation warnings are triaged and accepted or fixed.

## Multi-Region Readiness

Deploy a standby Worker and D1 database with the same migrations, secrets, and
bindings as production. Use `bun run dr:check` before a planned cutover and
after any restore into the standby database:

```bash
PULSEMON_DR_PRIMARY_URL=https://pulsemon.example.com \
PULSEMON_DR_STANDBY_URL=https://pulsemon-standby.example.com \
PULSEMON_KEY=<shared-ingest-key> \
PULSEMON_BASIC_AUTH=admin:secret \
bun run dr:check
```

Use endpoint-specific credentials when primary and standby use different
secrets:

```bash
PULSEMON_DR_PRIMARY_KEY=<primary-ingest-key> \
PULSEMON_DR_STANDBY_KEY=<standby-ingest-key> \
PULSEMON_DR_PRIMARY_BASIC_AUTH=admin:primary \
PULSEMON_DR_STANDBY_BASIC_AUTH=admin:standby \
bun run dr:check
```

DR cutover pass criteria:

- Primary and standby both accept ingest writes.
- Primary and standby both return metric readback for the generated DR metric.
- Primary and standby read APIs return successfully under configured UI auth.
- The standby deployment has passed `bun run smoke`, `bun run capacity:check`,
  and `bun run restore:check <export.sql>` for the restored export.

## Queued Ingest

Pulsemon supports two ingest modes:

- `direct`: request handlers validate and write to D1 synchronously. Use for
  local development, tests, and low-volume staging.
- `queued`: request handlers validate, authorize, govern, sample, and enqueue a
  normalized telemetry envelope. Successful requests return `202 Accepted`; the
  queue consumer enforces cardinality and persists to D1.

Production deployments should create both queues named in `wrangler.jsonc`:
`pulsemon-telemetry` and `pulsemon-telemetry-dlq`. Keep queue consumer batch
sizes below D1 statement and CPU limits, then raise only with capacity evidence.

Queued ingest pass criteria:

- `TELEMETRY_QUEUE` is bound in every deployed environment that sets
  `INGEST_MODE=queued`.
- `pulsemon-telemetry-dlq` exists and is monitored.
- Queue backlog age and retry/dead-letter counts are part of the capacity gate.
- Smoke checks verify eventual readback rather than only immediate HTTP
  acknowledgement.

## Smoke And Load Checks

`bun run smoke` writes a connection, span, log, and metric through
`/api/ingest/batch`, then verifies query/read paths. Set
`PULSEMON_SMOKE_MAINTENANCE=true` and `PULSEMON_MAINTENANCE_KEY` to include the
maintenance endpoint.

`bun run load:ingest` sends configurable batch ingest traffic:

```bash
PULSEMON_URL=https://pulsemon.example.com \
PULSEMON_KEY=<ingest-key> \
PULSEMON_LOAD_REQUESTS=1000 \
PULSEMON_LOAD_BATCH_SIZE=50 \
PULSEMON_LOAD_CONCURRENCY=10 \
bun run load:ingest
```

Track request failure rate, p95 latency, D1 size, and alert webhook delivery
after each load run.

`bun run capacity:check` sends a gated load run and verifies metric readback:

```bash
PULSEMON_URL=https://pulsemon.example.com \
PULSEMON_KEY=<ingest-key> \
PULSEMON_BASIC_AUTH=admin:secret \
PULSEMON_CAPACITY_REQUESTS=1000 \
PULSEMON_CAPACITY_BATCH_SIZE=50 \
PULSEMON_CAPACITY_CONCURRENCY=10 \
PULSEMON_CAPACITY_MAX_FAILURE_RATE=0 \
PULSEMON_CAPACITY_MAX_P95_MS=1000 \
PULSEMON_CAPACITY_MIN_RPS=25 \
bun run capacity:check
```

Capacity gate pass criteria:

- Failure rate is at or below `PULSEMON_CAPACITY_MAX_FAILURE_RATE`.
- p95 ingest latency is below `PULSEMON_CAPACITY_MAX_P95_MS` when set.
- Throughput is above `PULSEMON_CAPACITY_MIN_RPS` when set.
- Metric readback returns samples for the generated capacity run.

## OpenTelemetry Collector

Use scoped collector tokens and OTLP HTTP/protobuf. Example collector exporter:

```yaml
exporters:
  otlphttp/pulsemon:
    endpoint: https://pulsemon.example.com/api/ingest/otlp
    encoding: proto
    compression: gzip
    headers:
      Authorization: Bearer ${env:PULSEMON_OTLP_KEY}

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/pulsemon]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp/pulsemon]
    logs:
      receivers: [otlp]
      exporters: [otlphttp/pulsemon]
```

The OTLP HTTP exporter appends `/v1/traces`, `/v1/metrics`, and `/v1/logs` to
the configured endpoint.

Run the fixture certification suite against staging before onboarding a new
SDK/Collector version:

```bash
PULSEMON_URL=https://staging.example.com \
PULSEMON_KEY=<staging-otlp-key> \
PULSEMON_OTEL_SDK=nodejs \
PULSEMON_OTEL_SDK_VERSION=<sdk-version> \
PULSEMON_OTEL_COLLECTOR_VERSION=<collector-version> \
bun run otlp:certify
```

## Residual Enterprise Gaps

These are not blockers for a controlled platform-team rollout, but they remain
before calling Pulsemon a broad Datadog replacement:

- Live certification evidence should be added for each platform team's exact
  OpenTelemetry SDK and Collector versions as they are onboarded.
