import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { TenantScope } from "@/types";
import { authorizeIngest, type ApiKeyContext } from "./auth";
import type { IngestCardinalityController } from "./cardinality";
import {
  PayloadTooLargeError,
  ValidationError,
  type IngestError,
} from "./errors";
import {
  DEFAULT_INGEST_GOVERNANCE_CONFIG,
  governAgentToolCallInsert,
  governConnectionInsert,
  governConnectionUpdate,
  governEventInsert,
  governLogInsert,
  governMetricInsert,
  governSpanInsert,
  governSpanUpdate,
  governVoiceTurnInsert,
  type IngestGovernanceConfig,
} from "./governance";
import {
  DEFAULT_INGEST_PRESSURE_CONFIG,
  sampleItems,
  type IngestPressureConfig,
  type IngestPressureController,
} from "./pressure";
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
  readonly apiKeys?: string;
  readonly authorization: string;
  readonly requiredScope: string;
  readonly defaultTenant: TenantScope;
  readonly pressure?: IngestPressureController;
  readonly governance?: IngestGovernanceConfig;
  readonly cardinality?: IngestCardinalityController;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
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

function preparePressure(
  deps: IngestDeps,
  context: ApiKeyContext
): Effect.Effect<IngestPressureConfig, IngestError> {
  return deps.pressure
    ? deps.pressure.prepare(context, deps.requiredScope)
    : Effect.succeed(DEFAULT_INGEST_PRESSURE_CONFIG);
}

function governanceConfig(deps: IngestDeps) {
  return deps.governance ?? DEFAULT_INGEST_GOVERNANCE_CONFIG;
}

function emptyBatch(): TelemetryBatchWrite {
  return {
    connections: [],
    connectionUpdates: [],
    spans: [],
    spanUpdates: [],
    events: [],
    metrics: [],
    logs: [],
    voiceTurns: [],
    toolCalls: [],
  };
}

function enforceCardinality(
  deps: IngestDeps,
  context: ApiKeyContext,
  batch: TelemetryBatchWrite
): Effect.Effect<void, IngestError> {
  return deps.cardinality
    ? deps.cardinality.enforce(context, deps.requiredScope, batch)
    : Effect.void;
}

function countResult(count: number, sampledOut: number) {
  return sampledOut > 0 ? { count, sampled_out: sampledOut } : { count };
}

function eventSamplingKey(input: PostEventInput, index: number) {
  return input.id ?? input.trace_id ?? input.connection_id ?? `${input.event_type}:${input.timestamp ?? index}`;
}

function metricSamplingKey(input: PostMetricInput, index: number) {
  return input.id ?? `${input.service}:${input.metric_name}:${input.timestamp ?? index}:${input.value}`;
}

function logSamplingKey(input: PostLogInput, index: number) {
  return input.id ?? input.trace_id ?? input.span_id ?? `${input.service}:${input.level}:${input.message}:${index}`;
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

function connectionInsert(
  input: PostConnectionInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): ConnectionInsert {
  return governConnectionInsert({
    ...tenant,
    id: input.id || uuid(),
    service: input.service,
    connection_type: input.connection_type,
    client_id: input.client_id,
    session_id: input.session_id,
    started_at: input.started_at || now(),
    status: input.status ?? "active",
    metadata: input.metadata,
  }, governance);
}

function spanInsert(
  input: PostSpanInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): SpanInsert {
  return governSpanInsert({
    ...tenant,
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
  }, governance);
}

function eventInsert(
  input: PostEventInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): EventInsert {
  return governEventInsert({
    ...tenant,
    id: input.id || uuid(),
    connection_id: input.connection_id,
    span_id: input.span_id,
    trace_id: input.trace_id,
    event_type: input.event_type,
    timestamp: input.timestamp || now(),
    data: input.data,
    direction: input.direction,
    size_bytes: input.size_bytes,
  }, governance);
}

function metricInsert(
  input: PostMetricInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): MetricInsert {
  return governMetricInsert({
    ...tenant,
    id: input.id || uuid(),
    service: input.service,
    metric_name: input.metric_name,
    metric_type: input.metric_type,
    timestamp: input.timestamp || now(),
    value: input.value,
    tags: input.tags,
  }, governance);
}

function logInsert(
  input: PostLogInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): LogInsert {
  return governLogInsert({
    ...tenant,
    id: input.id || uuid(),
    timestamp: input.timestamp || now(),
    level: input.level,
    service: input.service,
    message: input.message,
    trace_id: input.trace_id,
    span_id: input.span_id,
    connection_id: input.connection_id,
    attributes: input.attributes,
  }, governance);
}

function voiceTurnInsert(
  input: PostVoiceTurnInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): VoiceTurnInsert {
  return governVoiceTurnInsert({
    ...tenant,
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
  }, governance);
}

function agentToolCallInsert(
  input: PostAgentToolCallInput,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): AgentToolCallInsert {
  return governAgentToolCallInsert({
    ...tenant,
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
  }, governance);
}

function normalizeBatch(
  input: BatchInput,
  tenant: TenantScope,
  pressure: IngestPressureConfig,
  governance: IngestGovernanceConfig
): { batch: TelemetryBatchWrite; sampledOut: number } {
  const connectionUpdates: ConnectionUpdate[] = [];
  for (const update of input.connection_updates ?? []) {
    if (hasConnectionUpdateFields(update)) {
      connectionUpdates.push(governConnectionUpdate({ ...tenant, ...update }, governance));
    }
  }

  const spanUpdates: SpanUpdate[] = [];
  for (const update of input.span_updates ?? []) {
    if (hasSpanUpdateFields(update)) {
      spanUpdates.push(governSpanUpdate({ ...tenant, ...update }, governance));
    }
  }

  const sampledEvents = sampleItems(input.events ?? [], pressure, eventSamplingKey);
  const sampledMetrics = sampleItems(input.metrics ?? [], pressure, metricSamplingKey);
  const sampledLogs = sampleItems(input.logs ?? [], pressure, logSamplingKey);

  return {
    batch: {
      connections: (input.connections ?? []).map((input) => connectionInsert(input, tenant, governance)),
      connectionUpdates,
      spans: (input.spans ?? []).map((input) => spanInsert(input, tenant, governance)),
      spanUpdates,
      events: sampledEvents.kept.map((input) => eventInsert(input, tenant, governance)),
      metrics: sampledMetrics.kept.map((input) => metricInsert(input, tenant, governance)),
      logs: sampledLogs.kept.map((input) => logInsert(input, tenant, governance)),
      voiceTurns: (input.voice_turns ?? []).map((input) => voiceTurnInsert(input, tenant, governance)),
      toolCalls: (input.tool_calls ?? []).map((input) => agentToolCallInsert(input, tenant, governance)),
    },
    sampledOut: sampledEvents.sampledOut + sampledMetrics.sampledOut + sampledLogs.sampledOut,
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
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const input = yield* decode(PostConnectionInputSchema, raw);
    const record = connectionInsert(input, auth, governanceConfig(deps));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), connections: [record] });
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
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const input = yield* decode(PatchConnectionInputSchema, raw);
    yield* ensureConnectionUpdate(input);
    const update = governConnectionUpdate({ ...auth, ...input }, governanceConfig(deps));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), connectionUpdates: [{ ...update, id }] });
    yield* deps.repository.updateConnection(id, update);
    return { id };
  });
}

export function postSpan(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ id: string }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const input = yield* decode(PostSpanInputSchema, raw);
    const record = spanInsert(input, auth, governanceConfig(deps));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), spans: [record] });
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
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const input = yield* decode(PatchSpanInputSchema, raw);
    yield* ensureSpanUpdate(input);
    const update = governSpanUpdate({ ...auth, ...input }, governanceConfig(deps));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), spanUpdates: [{ ...update, id }] });
    yield* deps.repository.updateSpan(id, update);
    return { id };
  });
}

export function postEvents(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const items = yield* decodeArray(
      PostEventInputSchema,
      raw,
      "No events provided",
      500,
      "Max 500 events per request"
    );
    const sampled = sampleItems(items, pressure, eventSamplingKey);
    const records = sampled.kept.map((input) => eventInsert(input, auth, governanceConfig(deps)));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), events: records });
    if (records.length > 0) {
      yield* deps.repository.insertEvents(records);
    }
    return countResult(records.length, sampled.sampledOut);
  });
}

export function postMetrics(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const items = yield* decodeArray(
      PostMetricInputSchema,
      raw,
      "No metrics provided",
      500,
      "Max 500 metrics per request"
    );
    const sampled = sampleItems(items, pressure, metricSamplingKey);
    const records = sampled.kept.map((input) => metricInsert(input, auth, governanceConfig(deps)));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), metrics: records });
    if (records.length > 0) {
      yield* deps.repository.insertMetrics(records);
    }
    return countResult(records.length, sampled.sampledOut);
  });
}

export function postLogs(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const items = yield* decodeArray(
      PostLogInputSchema,
      raw,
      "No logs provided",
      1000,
      "Max 1000 logs per request"
    );
    const sampled = sampleItems(items, pressure, logSamplingKey);
    const records = sampled.kept.map((input) => logInsert(input, auth, governanceConfig(deps)));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), logs: records });
    if (records.length > 0) {
      yield* deps.repository.insertLogs(records);
    }
    return countResult(records.length, sampled.sampledOut);
  });
}

export function postVoiceTurns(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const items = yield* decodeArray(
      PostVoiceTurnInputSchema,
      raw,
      "No voice turns provided",
      500,
      "Max 500 voice turns per request"
    );
    const records = items.map((input) => voiceTurnInsert(input, auth, governanceConfig(deps)));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), voiceTurns: records });
    yield* deps.repository.insertVoiceTurns(records);
    return { count: records.length };
  });
}

export function postAgentToolCalls(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ count: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const items = yield* decodeArray(
      PostAgentToolCallInputSchema,
      raw,
      "No tool calls provided",
      500,
      "Max 500 tool calls per request"
    );
    const records = items.map((input) => agentToolCallInsert(input, auth, governanceConfig(deps)));
    yield* enforceCardinality(deps, auth, { ...emptyBatch(), toolCalls: records });
    yield* deps.repository.insertAgentToolCalls(records);
    return { count: records.length };
  });
}

export function postBatch(
  deps: IngestDeps,
  raw: unknown
): Effect.Effect<{ counts: Record<string, number>; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const input = yield* decode(BatchInputSchema, raw);
    const { batch, sampledOut } = normalizeBatch(input, auth, pressure, governanceConfig(deps));
    const total = operationCount(batch);

    if (total === 0) {
      if (sampledOut > 0) {
        return { counts: {}, sampled_out: sampledOut };
      }
      return yield* Effect.fail(new ValidationError({ message: "No valid records in batch" }));
    }
    if (total > 1000) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: "Max 1000 operations per batch" }));
    }

    yield* enforceCardinality(deps, auth, batch);
    yield* deps.repository.writeBatch(batch);
    const counts = batchCounts(batch);
    return sampledOut > 0 ? { counts, sampled_out: sampledOut } : { counts };
  });
}
