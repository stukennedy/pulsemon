# Enterprise Gap Closure Plan

The readiness work made Pulsemon credible for a controlled platform-team
rollout. This checklist tracks the remaining Datadog-replacement gaps through
repo-owned deliverables.

## 1. User-Managed Monitors

- Persist monitor definitions in D1 rather than evaluating only fixed rules.
- Keep default realtime voice/agent/connection monitors as editable seeded
  definitions.
- Add API and UI paths for creating and updating metric threshold monitors.
- Continue incident/open/resolved processing from persisted definitions.

## 2. Notification Providers

- Add alert notification channels beyond generic webhook.
- Support Slack incoming webhook payloads.
- Support PagerDuty Events API trigger/resolve payloads.
- Support email-oriented webhook payloads for external mail providers.
- Store delivery attempts per channel.

## 3. Dashboard And SLO Workflows

- Add SLO definitions backed by metric/log/session queries.
- Add dashboard widgets for SLO burn, error budget, alert state, and realtime
  voice quality.
- Keep dashboards dense and operator-focused rather than a marketing surface.

## 4. SSO And Policy Groundwork

- Add OIDC-compatible session/login primitives for Workers.
- Map external groups to roles.
- Keep current Basic auth as local fallback.
- Audit auth events and admin policy changes.

## 5. OpenTelemetry Compatibility

- Add representative OTLP JSON/protobuf fixtures for traces, metrics, and logs.
- Document tested fixture coverage and rollout certification in a compatibility
  matrix.
- Add tests that validate fixture ingestion and semantic conventions.

## 6. DR, Restore, And Capacity

- Add scripts/runbooks for D1 export, restore validation, and capacity checks.
- Add repeatable query/ingest load checks for capacity decisions.
- Document restore drill criteria and rollout gates.

## Migration Discipline

The repo currently applies ordered SQL files with `bun run db:migrate`, which
wraps `wrangler d1 migrations apply pulsemon-db`. `bun run db:generate` exists,
but this repository does not yet have Drizzle migration metadata snapshots for
the existing hand-written migration history. A test run on 2026-05-14 generated
a duplicate full-schema baseline migration, so Drizzle diff generation must not
be used for incremental migrations until a dedicated baseline conversion is
done. New schema work should update `src/db/schema.ts`, add the corresponding
ordered D1 SQL migration, and run the full test suite.

## Progress Log

- 2026-05-14: created this enterprise gap closure plan and started persistent
  monitor definitions.
- 2026-05-14: added D1-backed monitor definitions, seeded editable default
  realtime monitors, custom metric average monitors, admin CRUD APIs, and a
  `/monitors` form for creating metric monitors.
- 2026-05-14: added alert notification fan-out for Slack incoming webhooks,
  PagerDuty Events API v2 trigger/resolve events, and email-provider webhook
  bridges alongside the existing generic webhook.
- 2026-05-14: added metric-backed SLO definitions, SLO evaluation persistence,
  scheduled SLO evaluation, `/api/slos`, and an `/slos` error-budget view.
- 2026-05-14: added OIDC-oriented auth policy groundwork with role mapping from
  verified claims and an admin policy inspection API.
- 2026-05-14: added repo-owned OTLP JSON/protobuf/gzip fixtures, routed OTLP
  tests through those fixtures, and documented the compatibility matrix plus
  rollout certification checklist.
- 2026-05-14: added restore validation and capacity gate scripts with
  documented restore drill criteria, capacity thresholds, and rollout gates.
- 2026-05-14: completed the OIDC login/session increment with authorization
  redirects, callback token exchange, signed state/session cookies, logout, and
  auth audit events.
