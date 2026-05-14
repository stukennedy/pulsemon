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
- `MAINTENANCE_API_KEY` for scheduled/manual maintenance automation.
- `ALERT_WEBHOOK_URL` and `ALERT_WEBHOOK_SECRET` when alert delivery is enabled.

Recommended controls:

- `INGEST_MAX_BYTES=1000000`
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

Useful D1 checks:

```bash
wrangler d1 info pulsemon-db --remote
wrangler d1 insights pulsemon-db --remote
```

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

## Residual Enterprise Gaps

These are not blockers for a controlled platform-team rollout, but they remain
before calling Pulsemon a broad Datadog replacement:

- SSO/SAML/OIDC and team/group policy mapping.
- User-managed monitor definitions and UI editing.
- Notification provider integrations beyond webhook.
- Multi-region disaster recovery and tested restore drills.
- Formal compatibility suite against multiple OpenTelemetry SDK/Collector
  versions.
