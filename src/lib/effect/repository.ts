import { Effect } from "effect";
import type { TenantScope } from "@/types";
import type {
  AgentToolCallInsert as SchemaAgentToolCallInsert,
  Connection,
  ConnectionInsert as SchemaConnectionInsert,
  EventInsert as SchemaEventInsert,
  LogInsert as SchemaLogInsert,
  MetricInsert as SchemaMetricInsert,
  Span,
  SpanInsert as SchemaSpanInsert,
  VoiceTurnInsert as SchemaVoiceTurnInsert,
} from "@/db/schema";
import { DatabaseError } from "./errors";

type RequireColumns<T, K extends keyof T> = Omit<T, K> & {
  readonly [P in K]-?: Exclude<T[P], undefined>;
};

type RawJsonColumns<T, K extends keyof T> = Omit<T, K> & {
  readonly [P in K]?: unknown;
};

type BooleanColumns<T, K extends keyof T> = Omit<T, K> & {
  readonly [P in K]-?: boolean;
};

export type ConnectionInsert = RawJsonColumns<
  RequireColumns<SchemaConnectionInsert, "id" | "workspace_id" | "project_id" | "started_at" | "status">,
  "metadata"
>;

export type SpanInsert = RawJsonColumns<
  RequireColumns<SchemaSpanInsert, "id" | "workspace_id" | "project_id" | "started_at" | "status">,
  "attributes"
>;

export type EventInsert = RawJsonColumns<
  RequireColumns<SchemaEventInsert, "id" | "workspace_id" | "project_id" | "timestamp">,
  "data"
>;

export type MetricInsert = RawJsonColumns<
  RequireColumns<SchemaMetricInsert, "id" | "workspace_id" | "project_id" | "timestamp">,
  "buckets" | "quantiles" | "tags"
>;

export type LogInsert = RawJsonColumns<
  RequireColumns<SchemaLogInsert, "id" | "workspace_id" | "project_id" | "timestamp">,
  "attributes"
>;

export type VoiceTurnInsert = RawJsonColumns<
  BooleanColumns<
    RequireColumns<SchemaVoiceTurnInsert, "id" | "workspace_id" | "project_id" | "started_at">,
    "interruption"
  >,
  "metadata"
>;

export type AgentToolCallInsert = RawJsonColumns<
  RequireColumns<
    SchemaAgentToolCallInsert,
    "id" | "workspace_id" | "project_id" | "started_at" | "status" | "retry_count"
  >,
  "input" | "output" | "metadata"
>;

export type ConnectionUpdate = Pick<Connection, "id" | "workspace_id" | "project_id"> &
  RawJsonColumns<
    Partial<Pick<Connection, "ended_at" | "duration_ms" | "close_reason" | "status" | "metadata">>,
    "metadata"
  >;

export type SpanUpdate = Pick<Span, "id" | "workspace_id" | "project_id"> &
  RawJsonColumns<
    Partial<Pick<Span, "ended_at" | "duration_ms" | "status" | "status_message" | "attributes">>,
    "attributes"
  >;

export interface TelemetryBatchWrite {
  readonly connections: readonly ConnectionInsert[];
  readonly connectionUpdates: readonly ConnectionUpdate[];
  readonly spans: readonly SpanInsert[];
  readonly spanUpdates: readonly SpanUpdate[];
  readonly events: readonly EventInsert[];
  readonly metrics: readonly MetricInsert[];
  readonly logs: readonly LogInsert[];
  readonly voiceTurns: readonly VoiceTurnInsert[];
  readonly toolCalls: readonly AgentToolCallInsert[];
}

export interface TelemetryRepository {
  readonly insertConnection: (input: ConnectionInsert) => Effect.Effect<void, DatabaseError>;
  readonly updateConnection: (id: string, input: ConnectionUpdate) => Effect.Effect<void, DatabaseError>;
  readonly insertSpan: (input: SpanInsert) => Effect.Effect<void, DatabaseError>;
  readonly updateSpan: (id: string, input: SpanUpdate) => Effect.Effect<void, DatabaseError>;
  readonly insertEvents: (input: readonly EventInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly insertMetrics: (input: readonly MetricInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly insertLogs: (input: readonly LogInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly insertVoiceTurns: (input: readonly VoiceTurnInsert[]) => Effect.Effect<void, DatabaseError>;
  readonly insertAgentToolCalls: (input: readonly AgentToolCallInsert[]) => Effect.Effect<void, DatabaseError>;
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
    `INSERT INTO connections (id, workspace_id, project_id, service, connection_type, client_id, session_id, started_at, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
    input.service,
    input.connection_type,
    input.client_id ?? null,
    input.session_id ?? null,
    input.started_at,
    input.status,
    optionalJson(input.metadata)
  );
}

function bindConnectionUpdate(db: D1Database, id: string, input: ConnectionUpdate) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.close_reason !== undefined) { fields.push("close_reason = ?"); values.push(input.close_reason); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(requiredJson(input.metadata)); }
  if (fields.length === 0) return null;
  values.push(id, input.workspace_id, input.project_id);
  return db.prepare(
    `UPDATE connections SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ? AND project_id = ?`
  ).bind(...values);
}

function bindSpanInsert(db: D1Database, input: SpanInsert) {
  return db.prepare(
    `INSERT INTO spans (id, workspace_id, project_id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
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

function bindSpanUpdate(db: D1Database, id: string, input: SpanUpdate) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(input.ended_at); }
  if (input.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(input.duration_ms); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.status_message !== undefined) { fields.push("status_message = ?"); values.push(input.status_message); }
  if (input.attributes !== undefined) { fields.push("attributes = ?"); values.push(requiredJson(input.attributes)); }
  if (fields.length === 0) return null;
  values.push(id, input.workspace_id, input.project_id);
  return db.prepare(
    `UPDATE spans SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ? AND project_id = ?`
  ).bind(...values);
}

function bindEventInsert(db: D1Database, input: EventInsert) {
  return db.prepare(
    `INSERT INTO events (id, workspace_id, project_id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
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
    `INSERT INTO metrics (id, workspace_id, project_id, service, metric_name, metric_type, timestamp, value, unit, count, sum, min, max, buckets, quantiles, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
    input.service,
    input.metric_name,
    input.metric_type,
    input.timestamp,
    input.value,
    input.unit ?? null,
    input.count ?? null,
    input.sum ?? null,
    input.min ?? null,
    input.max ?? null,
    optionalJson(input.buckets),
    optionalJson(input.quantiles),
    optionalJson(input.tags)
  );
}

function bindLogInsert(db: D1Database, input: LogInsert) {
  return db.prepare(
    `INSERT INTO logs (id, workspace_id, project_id, timestamp, level, service, message, trace_id, span_id, connection_id, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
    input.timestamp,
    input.level,
    input.service,
    input.message,
    input.trace_id ?? null,
    input.span_id ?? null,
    input.connection_id ?? null,
    optionalJson(input.attributes)
  );
}

function bindVoiceTurnInsert(db: D1Database, input: VoiceTurnInsert) {
  return db.prepare(
    `INSERT INTO voice_turns (id, workspace_id, project_id, connection_id, session_id, trace_id, turn_index, role, started_at, ended_at, duration_ms, transcript, transcript_confidence, vad_start_ms, vad_end_ms, interruption, audio_latency_ms, asr_latency_ms, llm_latency_ms, tts_latency_ms, input_tokens, output_tokens, cost_usd, state, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
    input.connection_id ?? null,
    input.session_id ?? null,
    input.trace_id ?? null,
    input.turn_index ?? null,
    input.role,
    input.started_at,
    input.ended_at ?? null,
    input.duration_ms ?? null,
    input.transcript ?? null,
    input.transcript_confidence ?? null,
    input.vad_start_ms ?? null,
    input.vad_end_ms ?? null,
    input.interruption ? 1 : 0,
    input.audio_latency_ms ?? null,
    input.asr_latency_ms ?? null,
    input.llm_latency_ms ?? null,
    input.tts_latency_ms ?? null,
    input.input_tokens ?? null,
    input.output_tokens ?? null,
    input.cost_usd ?? null,
    input.state ?? null,
    optionalJson(input.metadata)
  );
}

function structuredJson(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}

function bindAgentToolCallInsert(db: D1Database, input: AgentToolCallInsert) {
  return db.prepare(
    `INSERT INTO agent_tool_calls (id, workspace_id, project_id, trace_id, span_id, connection_id, session_id, turn_id, tool_name, started_at, ended_at, duration_ms, status, retry_count, input, output, error, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    input.id,
    input.workspace_id,
    input.project_id,
    input.trace_id ?? null,
    input.span_id ?? null,
    input.connection_id ?? null,
    input.session_id ?? null,
    input.turn_id ?? null,
    input.tool_name,
    input.started_at,
    input.ended_at ?? null,
    input.duration_ms ?? null,
    input.status,
    input.retry_count,
    structuredJson(input.input),
    structuredJson(input.output),
    input.error ?? null,
    optionalJson(input.metadata)
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

    insertLogs: (input) => dbEffect(() =>
      db.batch(input.map((log) => bindLogInsert(db, log)))
    ).pipe(Effect.asVoid),

    insertVoiceTurns: (input) => dbEffect(() =>
      db.batch(input.map((turn) => bindVoiceTurnInsert(db, turn)))
    ).pipe(Effect.asVoid),

    insertAgentToolCalls: (input) => dbEffect(() =>
      db.batch(input.map((call) => bindAgentToolCallInsert(db, call)))
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
        ...input.logs.map((log) => bindLogInsert(db, log)),
        ...input.voiceTurns.map((turn) => bindVoiceTurnInsert(db, turn)),
        ...input.toolCalls.map((call) => bindAgentToolCallInsert(db, call)),
      ];

      return dbEffect(() => db.batch(stmts)).pipe(Effect.asVoid);
    },
  };
}
