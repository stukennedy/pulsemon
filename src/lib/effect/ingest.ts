import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  MissingConfigError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
  type IngestError,
} from "./errors";
import type {
  AgentToolCallInsert,
  ConnectionInsert,
  ConnectionUpdate,
  EventInsert,
  LogInsert,
  MetricInsert,
  SpanInsert,
  SpanUpdate,
  TelemetryBatchWrite,
  TelemetryRepository,
  VoiceTurnInsert,
} from "./repository";
import {
  BatchInputSchema,
  PatchConnectionInputSchema,
  PatchSpanInputSchema,
  PostAgentToolCallInputSchema,
  PostConnectionInputSchema,
  PostEventInputSchema,
  PostLogInputSchema,
  PostMetricInputSchema,
  PostSpanInputSchema,
  PostVoiceTurnInputSchema,
  type BatchInput,
  type PatchConnectionInput,
  type PatchSpanInput,
  type PostAgentToolCallInput,
  type PostConnectionInput,
  type PostEventInput,
  type PostLogInput,
  type PostMetricInput,
  type PostSpanInput,
  type PostVoiceTurnInput,
} from "./schemas";

export interface IngestDeps {
  readonly repository: TelemetryRepository;
  readonly expectedApiKey?: string;
  readonly authorization: string;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
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

function hasConnectionUpdateFields(input: PatchConnectionInput) {
  return (
    input.ended_at !== undefined ||
    input.duration_ms !== undefined ||
    input.close_reason !== undefined ||
    input.status !== undefined ||
    input.metadata !== undefined
  );
}

function hasSpanUpdateFields(input: PatchSpanInput) {
  return (
    input.ended_at !== undefined ||
    input.duration_ms !== undefined ||
    input.status !== undefined ||
    input.status_message !== undefined ||
    input.attributes !== undefined
  );
}

function ensureConnectionUpdate(input: PatchConnectionInput) {
  if (!hasConnectionUpdateFields(input)) {
    return Effect.fail(new ValidationError({ message: "No fields to update" }));
  }
  return Effect.void;
}

function ensureSpanUpdate(input: PatchSpanInput) {
  if (!hasSpanUpdateFields(input)) {
    return Effect.fail(new ValidationError({ message: "No fields to update" }));
  }
  return Effect.void;
}

function connectionInsert(input: PostConnectionInput): ConnectionInsert {
  return {
    id: input.id || uuid(),
    service: input.service,
    connection_type: input.connection_type,
    client_id: input.client_id,
    session_id: input.session_id,
    started_at: input.started_at || now(),
    status: input.status ?? "active",
    metadata: input.metadata,
  };
}

function spanInsert(input: PostSpanInput): SpanInsert {
  return {
    id: input.id || uuid(),
    trace_id: input.trace_id,
    parent_span_id: input.parent_span_id,
    connection_id: input.connection_id,
    service: input.service,
    operation: input.operation,
    started_at: input.started_at || now(),
    ended_at: input.ended_at,
    duration_ms: input.duration_ms,
    status: input.status ?? "ok",
    status_message: input.status_message,
    attributes: input.attributes,
  };
}

function eventInsert(input: PostEventInput): EventInsert {
  return {
    id: input.id || uuid(),
    connection_id: input.connection_id,
    span_id: input.span_id,
    trace_id: input.trace_id,
    event_type: input.event_type,
    timestamp: input.timestamp || now(),
    data: input.data,
    direction: input.direction,
    size_bytes: input.size_bytes,
  };
}

function metricInsert(input: PostMetricInput): MetricInsert {
  return {
    id: input.id || uuid(),
    service: input.service,
    metric_name: input.metric_name,
    metric_type: input.metric_type,
    timestamp: input.timestamp || now(),
    value: input.value,
    tags: input.tags,
  };
}

function logInsert(input: PostLogInput): LogInsert {
  return {
    id: input.id || uuid(),
    timestamp: input.timestamp || now(),
    level: input.level,
    service: input.service,
    message: input.message,
    trace_id: input.trace_id,
    span_id: input.span_id,
    connection_id: input.connection_id,
    attributes: input.attributes,
  };
}

function voiceTurnInsert(input: PostVoiceTurnInput): VoiceTurnInsert {
  return {
    id: input.id || uuid(),
    connection_id: input.connection_id,
    session_id: input.session_id,
    trace_id: input.trace_id,
    turn_index: input.turn_index,
    role: input.role,
    started_at: input.started_at || now(),
    ended_at: input.ended_at,
    duration_ms: input.duration_ms,
    transcript: input.transcript,
    transcript_confidence: input.transcript_confidence,
    vad_start_ms: input.vad_start_ms,
    vad_end_ms: input.vad_end_ms,
    interruption: input.interruption ?? false,
    audio_latency_ms: input.audio_latency_ms,
    asr_latency_ms: input.asr_latency_ms,
    llm_latency_ms: input.llm_latency_ms,
    tts_latency_ms: input.tts_latency_ms,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    cost_usd: input.cost_usd,
    state: input.state,
    metadata: input.metadata,
  };
}

function agentToolCallInsert(input: PostAgentToolCallInput): AgentToolCallInsert {
  return {
    id: input.id || uuid(),
    trace_id: input.trace_id,
    span_id: input.span_id,
    connection_id: input.connection_id,
    session_id: input.session_id,
    turn_id: input.turn_id,
    tool_name: input.tool_name,
    started_at: input.started_at || now(),
    ended_at: input.ended_at,
    duration_ms: input.duration_ms,
    status: input.status ?? "ok",
    retry_count: input.retry_count ?? 0,
    input: input.input,
    output: input.output,
    error: input.error,
    metadata: input.metadata,
  };
}

function normalizeBatch(input: BatchInput): TelemetryBatchWrite {
  const connectionUpdates: ConnectionUpdate[] = [];
  for (const update of input.connection_updates ?? []) {
    if (hasConnectionUpdateFields(update)) {
      connectionUpdates.push(update);
    }
  }

  const spanUpdates: SpanUpdate[] = [];
  for (const update of input.span_updates ?? []) {
    if (hasSpanUpdateFields(update)) {
      spanUpdates.push(update);
    }
  }

  return {
    connections: (input.connections ?? []).map(connectionInsert),
    connectionUpdates,
    spans: (input.spans ?? []).map(spanInsert),
    spanUpdates,
    events: (input.events ?? []).map(eventInsert),
    metrics: (input.metrics ?? []).map(metricInsert),
    logs: (input.logs ?? []).map(logInsert),
    voiceTurns: (input.voice_turns ?? []).map(voiceTurnInsert),
    toolCalls: (input.tool_calls ?? []).map(agentToolCallInsert),
  };
}

function batchCounts(input: TelemetryBatchWrite) {
  const counts: Record<string, number> = {};
  if (input.connections.length > 0) counts.connections = input.connections.length;
  if (input.connectionUpdates.length > 0) counts.connection_updates = input.connectionUpdates.length;
  if (input.spans.length > 0) counts.spans = input.spans.length;
  if (input.spanUpdates.length > 0) counts.span_updates = input.spanUpdates.length;
  if (input.events.length > 0) counts.events = input.events.length;
  if (input.metrics.length > 0) counts.metrics = input.metrics.length;
  if (input.logs.length > 0) counts.logs = input.logs.length;
  if (input.voiceTurns.length > 0) counts.voice_turns = input.voiceTurns.length;
  if (input.toolCalls.length > 0) counts.tool_calls = input.toolCalls.length;
  return counts;
}

function operationCount(input: TelemetryBatchWrite) {
  return (
    input.connections.length +
    input.connectionUpdates.length +
    input.spans.length +
    input.spanUpdates.length +
    input.events.length +
    input.metrics.length +
    input.logs.length +
    input.voiceTurns.length +
    input.toolCalls.length
  );
}

export function postConnection(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(PostConnectionInputSchema, raw);
    const record = connectionInsert(input);
    yield* deps.repository.insertConnection(record);
    return { id: record.id };
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
    yield* deps.repository.updateConnection(id, input);
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
    const record = spanInsert(input);
    yield* deps.repository.insertSpan(record);
    return { id: record.id };
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
    yield* deps.repository.updateSpan(id, input);
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
    const records = items.map(eventInsert);
    yield* deps.repository.insertEvents(records);
    return { count: records.length };
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
    const records = items.map(metricInsert);
    yield* deps.repository.insertMetrics(records);
    return { count: records.length };
  });
}

export function postLogs(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const items = yield* decodeArray(
      PostLogInputSchema,
      raw,
      "No logs provided",
      1000,
      "Max 1000 logs per request"
    );
    const records = items.map(logInsert);
    yield* deps.repository.insertLogs(records);
    return { count: records.length };
  });
}

export function postVoiceTurns(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const items = yield* decodeArray(
      PostVoiceTurnInputSchema,
      raw,
      "No voice turns provided",
      500,
      "Max 500 voice turns per request"
    );
    const records = items.map(voiceTurnInsert);
    yield* deps.repository.insertVoiceTurns(records);
    return { count: records.length };
  });
}

export function postAgentToolCalls(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const items = yield* decodeArray(
      PostAgentToolCallInputSchema,
      raw,
      "No tool calls provided",
      500,
      "Max 500 tool calls per request"
    );
    const records = items.map(agentToolCallInsert);
    yield* deps.repository.insertAgentToolCalls(records);
    return { count: records.length };
  });
}

export function postBatch(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ counts: Record<string, number> }, IngestError> {
  return Effect.gen(function* () {
    yield* authorize(deps);
    const input = yield* decode(BatchInputSchema, raw);
    const batch = normalizeBatch(input);
    const total = operationCount(batch);

    if (total === 0) {
      return yield* Effect.fail(new ValidationError({ message: "No valid records in batch" }));
    }
    if (total > 1000) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: "Max 1000 operations per batch" }));
    }

    yield* deps.repository.writeBatch(batch);
    return { counts: batchCounts(batch) };
  });
}
