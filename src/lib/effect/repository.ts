import { Effect } from "effect";
import { DatabaseError } from "./errors";
import type {
  PatchConnectionInput,
  PatchSpanInput,
  PostConnectionInput,
  PostEventInput,
  PostMetricInput,
  PostSpanInput,
} from "./schemas";

export type ConnectionInsert = Omit<PostConnectionInput, "id" | "started_at" | "status"> & {
  readonly id: string;
  readonly started_at: string;
  readonly status: string;
};

export type SpanInsert = Omit<PostSpanInput, "id" | "started_at" | "status"> & {
  readonly id: string;
  readonly started_at: string;
  readonly status: string;
};

export type EventInsert = Omit<PostEventInput, "id" | "timestamp"> & {
  readonly id: string;
  readonly timestamp: string;
};

export type MetricInsert = Omit<PostMetricInput, "id" | "timestamp"> & {
  readonly id: string;
  readonly timestamp: string;
};

export type ConnectionUpdate = PatchConnectionInput & {
  readonly id: string;
};

export type SpanUpdate = PatchSpanInput & {
  readonly id: string;
};

export interface TelemetryBatchWrite {
  readonly connections: readonly ConnectionInsert[];
  readonly connectionUpdates: readonly ConnectionUpdate[];
  readonly spans: readonly SpanInsert[];
  readonly spanUpdates: readonly SpanUpdate[];
  readonly events: readonly EventInsert[];
  readonly metrics: readonly MetricInsert[];
}

export interface TelemetryRepository {
  readonly insertConnection: (input: ConnectionInsert) => Effect.Effect<void, DatabaseError>;
  readonly updateConnection: (id: string, input: PatchConnectionInput) => Effect.Effect<void, DatabaseError>;
  readonly insertSpan: (input: SpanInsert) => Effect.Effect<void, DatabaseError>;
  readonly updateSpan: (id: string, input: PatchSpanInput) => Effect.Effect<void, DatabaseError>;
  readonly insertEvents: (input: readonly EventInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly insertMetrics: (input: readonly MetricInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly writeBatch: (input: TelemetryBatchWrite) => Effect.Effect<void, DatabaseError>;
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

function eventData(value: unknown): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function bindConnectionInsert(db: D1Database, input: ConnectionInsert) {
  return db.prepare(
    `INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.service,
    input.connection_type,
    input.client_id ?? null,
    input.session_id ?? null,
    input.started_at,
    input.status,
    optionalJson(input.metadata)
  );
}

function bindConnectionUpdate(db: D1Database, id: string, input: PatchConnectionInput) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.close_reason !== undefined) { fields.push("close_reason = ?"); values.push(input.close_reason); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(requiredJson(input.metadata)); }
  if (fields.length === 0) return null;
  values.push(id);
  return db.prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = ?`).bind(...values);
}

function bindSpanInsert(db: D1Database, input: SpanInsert) {
  return db.prepare(
    `INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.trace_id,
    input.parent_span_id ?? null,
    input.connection_id ?? null,
    input.service,
    input.operation,
    input.started_at,
    input.ended_at ?? null,
    input.duration_ms ?? null,
    input.status,
    input.status_message ?? null,
    optionalJson(input.attributes)
  );
}

function bindSpanUpdate(db: D1Database, id: string, input: PatchSpanInput) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.status_message !== undefined) { fields.push("status_message = ?"); values.push(input.status_message); }
  if (input.attributes !== undefined) { fields.push("attributes = ?"); values.push(requiredJson(input.attributes)); }
  if (fields.length === 0) return null;
  values.push(id);
  return db.prepare(`UPDATE spans SET ${fields.join(", ")} WHERE id = ?`).bind(...values);
}

function bindEventInsert(db: D1Database, input: EventInsert) {
  return db.prepare(
    `INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.connection_id ?? null,
    input.span_id ?? null,
    input.trace_id ?? null,
    input.event_type,
    input.timestamp,
    eventData(input.data),
    input.direction ?? null,
    input.size_bytes ?? null
  );
}

function bindMetricInsert(db: D1Database, input: MetricInsert) {
  return db.prepare(
    `INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.service,
    input.metric_name,
    input.metric_type,
    input.timestamp,
    input.value,
    optionalJson(input.tags)
  );
}

export function makeD1TelemetryRepository(db: D1Database): TelemetryRepository {
  return {
    insertConnection: (input) => dbEffect(() => bindConnectionInsert(db, input).run()).pipe(
      Effect.asVoid
    ),

    updateConnection: (id, input) => {
      const stmt = bindConnectionUpdate(db, id, input);
      if (!stmt) return Effect.void;
      return dbEffect(() => stmt.run()).pipe(Effect.asVoid);
    },

    insertSpan: (input) => dbEffect(() => bindSpanInsert(db, input).run()).pipe(
      Effect.asVoid
    ),

    updateSpan: (id, input) => {
      const stmt = bindSpanUpdate(db, id, input);
      if (!stmt) return Effect.void;
      return dbEffect(() => stmt.run()).pipe(Effect.asVoid);
    },

    insertEvents: (input) => dbEffect(() =>
      db.batch(input.map((event) => bindEventInsert(db, event)))
    ).pipe(Effect.asVoid),

    insertMetrics: (input) => dbEffect(() =>
      db.batch(input.map((metric) => bindMetricInsert(db, metric)))
    ).pipe(Effect.asVoid),

    writeBatch: (input) => {
      const stmts: D1PreparedStatement[] = [
        ...input.connections.map((conn) => bindConnectionInsert(db, conn)),
        ...input.connectionUpdates.flatMap((update) => {
          const stmt = bindConnectionUpdate(db, update.id, update);
          return stmt ? [stmt] : [];
        }),
        ...input.spans.map((span) => bindSpanInsert(db, span)),
        ...input.spanUpdates.flatMap((update) => {
          const stmt = bindSpanUpdate(db, update.id, update);
          return stmt ? [stmt] : [];
        }),
        ...input.events.map((event) => bindEventInsert(db, event)),
        ...input.metrics.map((metric) => bindMetricInsert(db, metric)),
      ];

      return dbEffect(() => db.batch(stmts)).pipe(Effect.asVoid);
    },
  };
}
