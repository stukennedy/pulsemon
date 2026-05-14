import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  MissingConfigError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
  type IngestError,
} from "./errors";
import {
  BatchInputSchema,
  PatchConnectionInputSchema,
  PatchSpanInputSchema,
  PostConnectionInputSchema,
  PostEventInputSchema,
  PostMetricInputSchema,
  PostSpanInputSchema,
  type BatchInput,
  type PatchConnectionInput,
  type PatchSpanInput,
  type PostConnectionInput,
  type PostEventInput,
  type PostMetricInput,
  type PostSpanInput,
} from "./schemas";

export interface IngestDeps {
  readonly db: D1Database;
  readonly expectedApiKey?: string;
  readonly authorization: string;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function requiredJson(value: unknown): string {
  return JSON.stringify(value);
}

function authorize(deps: IngestDeps): Effect.Effect<void, MissingConfigError | UnauthorizedError> {
  const expected = deps.expectedApiKey;
  if (!expected) {
    return Effect.fail(new MissingConfigError({ message: "Ingest API not configured" }));
  }

  const token = deps.authorization.startsWith("Bearer ")
    ? deps.authorization.slice(7).trim()
    : "";

  if (!token || token !== expected) {
    return Effect.fail(new UnauthorizedError({ message: "Unauthorized" }));
  }

  return Effect.void;
}

function decode<A, I>(
  schema: Schema.Schema<A, I, never>,
  raw: unknown
): Effect.Effect<A, ValidationError> {
  return Schema.decodeUnknown(schema, { errors: "all" })(raw).pipe(
    Effect.mapError((error) => new ValidationError({ message: error.message }))
  );
}

function decodeArray<A, I>(
  schema: Schema.Schema<A, I, never>,
  raw: unknown,
  emptyMessage: string,
  maxItems: number,
  maxMessage: string
): Effect.Effect<readonly A[], ValidationError | PayloadTooLargeError> {
  const items = Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) {
    return Effect.fail(new ValidationError({ message: emptyMessage }));
  }
  if (items.length > maxItems) {
    return Effect.fail(new PayloadTooLargeError({ message: maxMessage }));
  }
  return decode(Schema.Array(schema), items);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function ensureConnectionUpdate(input: PatchConnectionInput) {
  if (
    input.ended_at === undefined &&
    input.duration_ms === undefined &&
    input.close_reason === undefined &&
    input.status === undefined &&
    input.metadata === undefined
  ) {
    return Effect.fail(new ValidationError({ message: "No fields to update" }));
  }
  return Effect.void;
}

function ensureSpanUpdate(input: PatchSpanInput) {
  if (
    input.ended_at === undefined &&
    input.duration_ms === undefined &&
    input.status === undefined &&
    input.status_message === undefined &&
    input.attributes === undefined
  ) {
    return Effect.fail(new ValidationError({ message: "No fields to update" }));
  }
  return Effect.void;
}

export function postConnection(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(PostConnectionInputSchema, raw);
    const id = input.id || uuid();

    yield* dbEffect(() =>
      deps.db.prepare(
        `INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        id,
        input.service,
        input.connection_type,
        input.client_id ?? null,
        input.session_id ?? null,
        input.started_at || now(),
        input.status ?? "active",
        optionalJson(input.metadata)
      ).run()
    );

    return { id };
  });
}

export function patchConnection(
  deps: IngestDeps,
  id: string,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(PatchConnectionInputSchema, raw);
    yield* ensureConnectionUpdate(input);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
    if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
    if (input.close_reason !== undefined) { fields.push("close_reason = ?"); values.push(input.close_reason); }
    if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
    if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(requiredJson(input.metadata)); }

    values.push(id);
    yield* dbEffect(() =>
      deps.db.prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run()
    );

    return { id };
  });
}

export function postSpan(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(PostSpanInputSchema, raw);
    const id = input.id || uuid();

    yield* dbEffect(() =>
      deps.db.prepare(
        `INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        id,
        input.trace_id,
        input.parent_span_id ?? null,
        input.connection_id ?? null,
        input.service,
        input.operation,
        input.started_at || now(),
        input.ended_at ?? null,
        input.duration_ms ?? null,
        input.status ?? "ok",
        input.status_message ?? null,
        optionalJson(input.attributes)
      ).run()
    );

    return { id };
  });
}

export function patchSpan(
  deps: IngestDeps,
  id: string,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(PatchSpanInputSchema, raw);
    yield* ensureSpanUpdate(input);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
    if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
    if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
    if (input.status_message !== undefined) { fields.push("status_message = ?"); values.push(input.status_message); }
    if (input.attributes !== undefined) { fields.push("attributes = ?"); values.push(requiredJson(input.attributes)); }

    values.push(id);
    yield* dbEffect(() =>
      deps.db.prepare(`UPDATE spans SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run()
    );

    return { id };
  });
}

export function postEvents(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const items = yield* decodeArray(
      PostEventInputSchema,
      raw,
      "No events provided",
      500,
      "Max 500 events per request"
    );

    const stmt = deps.db.prepare(
      `INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    );

    yield* dbEffect(() => deps.db.batch(items.map((event: PostEventInput) =>
      stmt.bind(
        event.id || uuid(),
        event.connection_id ?? null,
        event.span_id ?? null,
        event.trace_id ?? null,
        event.event_type,
        event.timestamp || now(),
        event.data !== undefined
          ? (typeof event.data === "string" ? event.data : JSON.stringify(event.data))
          : null,
        event.direction ?? null,
        event.size_bytes ?? null
      )
    )));

    return { count: items.length };
  });
}

export function postMetrics(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const items = yield* decodeArray(
      PostMetricInputSchema,
      raw,
      "No metrics provided",
      500,
      "Max 500 metrics per request"
    );

    const stmt = deps.db.prepare(
      `INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    );

    yield* dbEffect(() => deps.db.batch(items.map((metric: PostMetricInput) =>
      stmt.bind(
        metric.id || uuid(),
        metric.service,
        metric.metric_name,
        metric.metric_type,
        metric.timestamp || now(),
        metric.value,
        optionalJson(metric.tags)
      )
    )));

    return { count: items.length };
  });
}

type BatchConnectionUpdate = NonNullable<BatchInput["connection_updates"]>[number];
type BatchSpanUpdate = NonNullable<BatchInput["span_updates"]>[number];

function bindConnectionUpdate(db: D1Database, input: BatchConnectionUpdate) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.close_reason !== undefined) { fields.push("close_reason = ?"); values.push(input.close_reason); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(requiredJson(input.metadata)); }
  if (fields.length === 0) return null;
  values.push(input.id);
  return db.prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = ?`).bind(...values);
}

function bindSpanUpdate(db: D1Database, input: BatchSpanUpdate) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.status_message !== undefined) { fields.push("status_message = ?"); values.push(input.status_message); }
  if (input.attributes !== undefined) { fields.push("attributes = ?"); values.push(requiredJson(input.attributes)); }
  if (fields.length === 0) return null;
  values.push(input.id);
  return db.prepare(`UPDATE spans SET ${fields.join(", ")} WHERE id = ?`).bind(...values);
}

export function postBatch(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ counts: Record<string, number> }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(BatchInputSchema, raw);
    const stmts: D1PreparedStatement[] = [];
    const counts: Record<string, number> = {};

    for (const conn of input.connections ?? []) {
      stmts.push(
        deps.db.prepare(
          `INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, status, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
        ).bind(
          conn.id || uuid(),
          conn.service,
          conn.connection_type,
          conn.client_id ?? null,
          conn.session_id ?? null,
          conn.started_at || now(),
          conn.status ?? "active",
          optionalJson(conn.metadata)
        )
      );
      counts.connections = (counts.connections ?? 0) + 1;
    }

    for (const update of input.connection_updates ?? []) {
      const stmt = bindConnectionUpdate(deps.db, update);
      if (stmt) {
        stmts.push(stmt);
        counts.connection_updates = (counts.connection_updates ?? 0) + 1;
      }
    }

    for (const span of input.spans ?? []) {
      stmts.push(
        deps.db.prepare(
          `INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
        ).bind(
          span.id || uuid(),
          span.trace_id,
          span.parent_span_id ?? null,
          span.connection_id ?? null,
          span.service,
          span.operation,
          span.started_at || now(),
          span.ended_at ?? null,
          span.duration_ms ?? null,
          span.status ?? "ok",
          span.status_message ?? null,
          optionalJson(span.attributes)
        )
      );
      counts.spans = (counts.spans ?? 0) + 1;
    }

    for (const update of input.span_updates ?? []) {
      const stmt = bindSpanUpdate(deps.db, update);
      if (stmt) {
        stmts.push(stmt);
        counts.span_updates = (counts.span_updates ?? 0) + 1;
      }
    }

    const eventStmt = deps.db.prepare(
      `INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
    );
    for (const event of input.events ?? []) {
      stmts.push(eventStmt.bind(
        event.id || uuid(),
        event.connection_id ?? null,
        event.span_id ?? null,
        event.trace_id ?? null,
        event.event_type,
        event.timestamp || now(),
        event.data !== undefined
          ? (typeof event.data === "string" ? event.data : JSON.stringify(event.data))
          : null,
        event.direction ?? null,
        event.size_bytes ?? null
      ));
      counts.events = (counts.events ?? 0) + 1;
    }

    const metricStmt = deps.db.prepare(
      `INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
    );
    for (const metric of input.metrics ?? []) {
      stmts.push(metricStmt.bind(
        metric.id || uuid(),
        metric.service,
        metric.metric_name,
        metric.metric_type,
        metric.timestamp || now(),
        metric.value,
        optionalJson(metric.tags)
      ));
      counts.metrics = (counts.metrics ?? 0) + 1;
    }

    if (stmts.length === 0) {
      return yield* Effect.fail(new ValidationError({ message: "No valid records in batch" }));
    }
    if (stmts.length > 1000) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: "Max 1000 operations per batch" }));
    }

    yield* dbEffect(() => deps.db.batch(stmts));

    return { counts };
  });
}
