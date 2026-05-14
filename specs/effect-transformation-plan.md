# Effect Transformation Plan

## Goal

Move Pulsemon's backend core from ad hoc `any` parsing and direct route-side D1
calls to a typed Effect architecture that can support production observability
workloads: logs, traces, metrics, realtime voice sessions, and agentic workflows.

This is a staged migration. The existing Hono routes and SSR UI should keep
working while the ingest/query internals are replaced.

## Current State

- Hono route handlers parse JSON directly and validate payloads manually.
- Ingest payloads are mostly `any`, so bad records can reach SQL construction.
- Batch ingest silently skips malformed records.
- D1 is accessed directly from route handlers.
- Errors are mapped inconsistently across endpoints.
- There is no dependency injection boundary for auth, config, persistence, or
  observability services.

## Target Architecture

```text
Hono adapter
  -> Effect HTTP adapter
  -> AuthService
  -> IngestService
  -> Repository services
  -> D1

Schema layer
  -> runtime validation
  -> inferred TypeScript types
  -> API docs and future SDK generation
```

## Effect Layers

- `ConfigService`: validates Worker bindings and feature flags.
- `AuthService`: validates ingest API keys and future project/workspace scopes.
- `TelemetryRepository`: owns D1 inserts, updates, and query primitives.
- `IngestService`: validates, enriches, batches, and persists telemetry records.
- `QueryService`: typed read models for dashboards, logs, traces, metrics, and
  voice views.
- `RealtimeService`: publishes ingest changes to UI sessions when live updates
  become ingest-driven.

## Error Model

Use tagged errors throughout the backend:

- `UnauthorizedError`
- `MissingConfigError`
- `ValidationError`
- `PayloadTooLargeError`
- `NotFoundError`
- `DatabaseError`

The Hono adapter is responsible for converting these to HTTP responses. Internal
services should not construct `Response` objects.

## Migration Slices

1. **Ingest boundary**
   - Add `effect`.
   - Add Effect Schema payload definitions for current ingest endpoints.
   - Replace manual JSON parsing/validation with typed decode functions.
   - Route all ingest errors through a single HTTP error mapper.

2. **Repository boundary**
   - Move D1 writes out of route handlers.
   - Introduce repository functions that return `Effect`.
   - Stop silently dropping invalid batch records.

3. **Read/query boundary**
   - Move connection, trace, stats, and facet queries into Effect services.
   - Add typed pagination and time windows.
   - Add query errors instead of empty/fallback states for failures.

4. **First-class observability model**
   - Add logs as a real signal, not only connection events.
   - Add metric query/aggregation endpoints and UI.
   - Add trace compatibility work toward OTLP ingestion.

5. **Realtime agent and voice model**
   - Model sessions, turns, VAD, interruptions, tool calls, provider retries,
     token/cost usage, transcript confidence, audio latency, and conversation
     graph state.

6. **Production controls**
   - Add tenancy, UI auth, API key scopes, retention policies, rollups, sampling,
     payload limits, rate limits, and backpressure.

## First Slice Scope

The first implementation slice should keep external behavior stable while
improving safety:

- `POST /api/ingest/connections`
- `PATCH /api/ingest/connections/:id`
- `POST /api/ingest/spans`
- `PATCH /api/ingest/spans/:id`
- `POST /api/ingest/events`
- `POST /api/ingest/metrics`
- `POST /api/ingest/batch`

Expected outcomes:

- malformed JSON returns a typed validation response;
- malformed individual and batch payloads are rejected instead of skipped;
- database failures are represented as `DatabaseError`;
- route handlers become thin adapters around Effect programs.

