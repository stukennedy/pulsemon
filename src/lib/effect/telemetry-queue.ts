import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { Env, TenantScope } from "@/types";
import { authorizeIngest, type ApiKeyContext, type ApiKeyDeps } from "./auth";
import { makeIngestCardinalityController } from "./cardinality";
import {
  PayloadTooLargeError,
  ValidationError,
  MissingConfigError,
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
  sampleItems,
  type IngestPressureConfig,
} from "./pressure";
import {
  normalizeOtlpLogBatch,
  normalizeOtlpMetricBatch,
  normalizeOtlpTraceBatch,
} from "./otlp";
import { archiveRawTelemetryMessage } from "./raw-telemetry";
import { makeD1TelemetryRepository } from "./repository";
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

export type TelemetryQueueSignal =
  | "connections"
  | "spans"
  | "events"
  | "metrics"
  | "logs"
  | "voice"
  | "agent"
  | "batch"
  | "otlp.traces"
  | "otlp.metrics"
  | "otlp.logs";

export interface TelemetryQueueMessage {
  readonly version: 1;
  readonly id: string;
  readonly enqueued_at: string;
  readonly signal: TelemetryQueueSignal;
  readonly required_scope: string;
  readonly context: ApiKeyContext;
  readonly batch: TelemetryBatchWrite;
  readonly counts: Record<string, number>;
  readonly sampled_out?: number;
}

export interface QueuedIngestDeps extends ApiKeyDeps {
  readonly queue?: Queue<TelemetryQueueMessage>;
  readonly governance?: IngestGovernanceConfig;
  readonly sampleRate?: string;
  readonly queueMaxBytes?: string;
  readonly queueMaxOperations?: string;
}

export interface QueuedIngestAccepted {
  readonly accepted: true;
  readonly mode: "queued";
  readonly id: string;
  readonly counts: Record<string, number>;
  readonly sampled_out?: number;
}

const DEFAULT_QUEUE_MAX_BYTES = 100_000;
const DEFAULT_QUEUE_MAX_OPERATIONS = 250;
const MAX_QUEUE_MAX_OPERATIONS = 900;

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

function queueMaxBytes(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_QUEUE_MAX_BYTES;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_QUEUE_MAX_BYTES;
}

function queueMaxOperations(value: string | undefined): Effect.Effect<number, ValidationError> {
  if (value === undefined || value.trim() === "") return Effect.succeed(DEFAULT_QUEUE_MAX_OPERATIONS);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_QUEUE_MAX_OPERATIONS) {
    return Effect.fail(new ValidationError({
      message: `INGEST_QUEUE_MAX_OPERATIONS must be an integer between 1 and ${MAX_QUEUE_MAX_OPERATIONS}`,
    }));
  }
  return Effect.succeed(parsed);
}

function sampleRate(value: string | undefined): Effect.Effect<number, ValidationError> {
  if (value === undefined || value.trim() === "") return Effect.succeed(1);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return Effect.fail(new ValidationError({ message: "INGEST_SAMPLE_RATE must be a number between 0 and 1" }));
  }
  return Effect.succeed(parsed);
}

function pressureConfig(rate: number): IngestPressureConfig {
  return { rateLimitPerMinute: 0, sampleRate: rate };
}

function governanceConfig(deps: QueuedIngestDeps) {
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
    unit: input.unit,
    count: input.count,
    sum: input.sum,
    min: input.min,
    max: input.max,
    buckets: input.buckets,
    quantiles: input.quantiles,
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

function eventSamplingKey(input: PostEventInput, index: number) {
  return input.id ?? input.trace_id ?? input.connection_id ?? `${input.event_type}:${input.timestamp ?? index}`;
}

function metricSamplingKey(input: PostMetricInput, index: number) {
  return input.id ?? `${input.service}:${input.metric_name}:${input.timestamp ?? index}:${input.value}`;
}

function logSamplingKey(input: PostLogInput, index: number) {
  return input.id ?? input.trace_id ?? input.span_id ?? `${input.service}:${input.level}:${input.message}:${index}`;
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

function normalizedBatch(
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
      connections: (input.connections ?? []).map((item) => connectionInsert(item, tenant, governance)),
      connectionUpdates,
      spans: (input.spans ?? []).map((item) => spanInsert(item, tenant, governance)),
      spanUpdates,
      events: sampledEvents.kept.map((item) => eventInsert(item, tenant, governance)),
      metrics: sampledMetrics.kept.map((item) => metricInsert(item, tenant, governance)),
      logs: sampledLogs.kept.map((item) => logInsert(item, tenant, governance)),
      voiceTurns: (input.voice_turns ?? []).map((item) => voiceTurnInsert(item, tenant, governance)),
      toolCalls: (input.tool_calls ?? []).map((item) => agentToolCallInsert(item, tenant, governance)),
    },
    sampledOut: sampledEvents.sampledOut + sampledMetrics.sampledOut + sampledLogs.sampledOut,
  };
}

function messageBytes(message: TelemetryQueueMessage) {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

function accepted(message: TelemetryQueueMessage): QueuedIngestAccepted {
  return message.sampled_out && message.sampled_out > 0
    ? { accepted: true, mode: "queued", id: message.id, counts: message.counts, sampled_out: message.sampled_out }
    : { accepted: true, mode: "queued", id: message.id, counts: message.counts };
}

function enqueueMessage(
  deps: QueuedIngestDeps,
  signal: TelemetryQueueSignal,
  context: ApiKeyContext,
  batch: TelemetryBatchWrite,
  sampledOut = 0
): Effect.Effect<QueuedIngestAccepted, IngestError> {
  return Effect.gen(function* () {
    if (!deps.queue) {
      return yield* Effect.fail(new MissingConfigError({ message: "Telemetry queue is not configured" }));
    }

    const total = operationCount(batch);
    if (total === 0 && sampledOut === 0) {
      return yield* Effect.fail(new ValidationError({ message: "No valid records in batch" }));
    }
    const maxOperations = yield* queueMaxOperations(deps.queueMaxOperations);
    if (total > maxOperations) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Max ${maxOperations} operations per batch` }));
    }

    const message: TelemetryQueueMessage = {
      version: 1,
      id: uuid(),
      enqueued_at: now(),
      signal,
      required_scope: deps.requiredScope,
      context,
      batch,
      counts: batchCounts(batch),
      ...(sampledOut > 0 ? { sampled_out: sampledOut } : {}),
    };

    if (total === 0) return accepted(message);

    const maxBytes = queueMaxBytes(deps.queueMaxBytes);
    const bytes = messageBytes(message);
    if (bytes > maxBytes) {
      return yield* Effect.fail(new PayloadTooLargeError({
        message: `Queued ingest payload exceeds ${maxBytes} bytes`,
      }));
    }

    return yield* Effect.tryPromise({
      try: async () => {
        await deps.queue!.send(message, { contentType: "json" });
        return accepted(message);
      },
      catch: (error) => new MissingConfigError({
        message: error instanceof Error ? error.message : "Failed to enqueue telemetry",
      }),
    });
  });
}

function enqueueDecoded(
  deps: QueuedIngestDeps,
  signal: TelemetryQueueSignal,
  raw: unknown,
  normalize: (
    raw: unknown,
    context: ApiKeyContext,
    pressure: IngestPressureConfig,
    governance: IngestGovernanceConfig
  ) => Effect.Effect<{ batch: TelemetryBatchWrite; sampledOut?: number }, IngestError>
) {
  return Effect.gen(function* () {
    const context = yield* authorizeIngest(deps);
    const rate = yield* sampleRate(deps.sampleRate);
    const result = yield* normalize(raw, context, pressureConfig(rate), governanceConfig(deps));
    return yield* enqueueMessage(deps, signal, context, result.batch, result.sampledOut ?? 0);
  });
}

export function enqueueConnection(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "connections", raw, (value, context, _pressure, governance) =>
    decode(PostConnectionInputSchema, value).pipe(Effect.map((input) => ({
      batch: { ...emptyBatch(), connections: [connectionInsert(input, context, governance)] },
    })))
  );
}

export function enqueueConnectionPatch(deps: QueuedIngestDeps, id: string, raw: unknown) {
  return enqueueDecoded(deps, "connections", raw, (value, context, _pressure, governance) =>
    Effect.gen(function* () {
      const input = yield* decode(PatchConnectionInputSchema, value);
      if (!hasConnectionUpdateFields(input)) {
        return yield* Effect.fail(new ValidationError({ message: "No fields to update" }));
      }
      return {
        batch: {
          ...emptyBatch(),
          connectionUpdates: [governConnectionUpdate({ ...context, ...input, id }, governance)],
        },
      };
    })
  );
}

export function enqueueSpan(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "spans", raw, (value, context, _pressure, governance) =>
    decode(PostSpanInputSchema, value).pipe(Effect.map((input) => ({
      batch: { ...emptyBatch(), spans: [spanInsert(input, context, governance)] },
    })))
  );
}

export function enqueueSpanPatch(deps: QueuedIngestDeps, id: string, raw: unknown) {
  return enqueueDecoded(deps, "spans", raw, (value, context, _pressure, governance) =>
    Effect.gen(function* () {
      const input = yield* decode(PatchSpanInputSchema, value);
      if (!hasSpanUpdateFields(input)) {
        return yield* Effect.fail(new ValidationError({ message: "No fields to update" }));
      }
      return {
        batch: {
          ...emptyBatch(),
          spanUpdates: [governSpanUpdate({ ...context, ...input, id }, governance)],
        },
      };
    })
  );
}

export function enqueueEvents(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "events", raw, (value, context, pressure, governance) =>
    Effect.gen(function* () {
      const items = yield* decodeArray(PostEventInputSchema, value, "No events provided", 500, "Max 500 events per request");
      const sampled = sampleItems(items, pressure, eventSamplingKey);
      return {
        batch: { ...emptyBatch(), events: sampled.kept.map((item) => eventInsert(item, context, governance)) },
        sampledOut: sampled.sampledOut,
      };
    })
  );
}

export function enqueueMetrics(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "metrics", raw, (value, context, pressure, governance) =>
    Effect.gen(function* () {
      const items = yield* decodeArray(PostMetricInputSchema, value, "No metrics provided", 500, "Max 500 metrics per request");
      const sampled = sampleItems(items, pressure, metricSamplingKey);
      return {
        batch: { ...emptyBatch(), metrics: sampled.kept.map((item) => metricInsert(item, context, governance)) },
        sampledOut: sampled.sampledOut,
      };
    })
  );
}

export function enqueueLogs(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "logs", raw, (value, context, pressure, governance) =>
    Effect.gen(function* () {
      const items = yield* decodeArray(PostLogInputSchema, value, "No logs provided", 1000, "Max 1000 logs per request");
      const sampled = sampleItems(items, pressure, logSamplingKey);
      return {
        batch: { ...emptyBatch(), logs: sampled.kept.map((item) => logInsert(item, context, governance)) },
        sampledOut: sampled.sampledOut,
      };
    })
  );
}

export function enqueueVoiceTurns(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "voice", raw, (value, context, _pressure, governance) =>
    Effect.gen(function* () {
      const items = yield* decodeArray(PostVoiceTurnInputSchema, value, "No voice turns provided", 500, "Max 500 voice turns per request");
      return {
        batch: { ...emptyBatch(), voiceTurns: items.map((item) => voiceTurnInsert(item, context, governance)) },
      };
    })
  );
}

export function enqueueAgentToolCalls(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "agent", raw, (value, context, _pressure, governance) =>
    Effect.gen(function* () {
      const items = yield* decodeArray(PostAgentToolCallInputSchema, value, "No tool calls provided", 500, "Max 500 tool calls per request");
      return {
        batch: { ...emptyBatch(), toolCalls: items.map((item) => agentToolCallInsert(item, context, governance)) },
      };
    })
  );
}

export function enqueueBatch(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "batch", raw, (value, context, pressure, governance) =>
    Effect.gen(function* () {
      const input = yield* decode(BatchInputSchema, value);
      const { batch, sampledOut } = normalizedBatch(input, context, pressure, governance);
      const total = operationCount(batch);
      if (total === 0 && sampledOut === 0) {
        return yield* Effect.fail(new ValidationError({ message: "No valid records in batch" }));
      }
      if (total > 1000) {
        return yield* Effect.fail(new PayloadTooLargeError({ message: "Max 1000 operations per batch" }));
      }
      return { batch, sampledOut };
    })
  );
}

export function enqueueOtlpTraces(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "otlp.traces", raw, (_value, context, _pressure, governance) =>
    Effect.succeed({ batch: normalizeOtlpTraceBatch(raw, context, governance) })
  );
}

export function enqueueOtlpMetrics(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "otlp.metrics", raw, (_value, context, pressure, governance) => {
    const batch = normalizeOtlpMetricBatch(raw, context, governance);
    const sampled = sampleItems(batch.metrics, pressure, (metric) => metric.id);
    return Effect.succeed({
      batch: { ...emptyBatch(), metrics: sampled.kept },
      sampledOut: sampled.sampledOut,
    });
  });
}

export function enqueueOtlpLogs(deps: QueuedIngestDeps, raw: unknown) {
  return enqueueDecoded(deps, "otlp.logs", raw, (_value, context, pressure, governance) => {
    const batch = normalizeOtlpLogBatch(raw, context, governance);
    const sampled = sampleItems(batch.logs, pressure, (log) => log.id);
    return Effect.succeed({
      batch: { ...emptyBatch(), logs: sampled.kept },
      sampledOut: sampled.sampledOut,
    });
  });
}

export function writeTelemetryQueueMessage(
  env: Pick<
    Env,
    | "DB"
    | "INGEST_CARDINALITY_MAX_VALUES_PER_KEY"
    | "INGEST_QUEUE_MAX_OPERATIONS"
    | "RAW_TELEMETRY"
    | "RAW_TELEMETRY_PREFIX"
    | "RAW_TELEMETRY_REQUIRED"
  >,
  message: TelemetryQueueMessage
): Effect.Effect<void, IngestError> {
  const repository = makeD1TelemetryRepository(env.DB);
  const cardinality = makeIngestCardinalityController(env.DB, env);
  return Effect.gen(function* () {
    const maxOperations = yield* queueMaxOperations(env.INGEST_QUEUE_MAX_OPERATIONS);
    const total = operationCount(message.batch);
    if (total > maxOperations) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Max ${maxOperations} operations per batch` }));
    }
    yield* archiveRawTelemetryMessage(env, message);
    yield* cardinality.enforce(message.context, message.required_scope, message.batch);
    yield* repository.writeBatch(message.batch);
  });
}

export async function processTelemetryQueueMessages(
  env: Pick<
    Env,
    | "DB"
    | "INGEST_CARDINALITY_MAX_VALUES_PER_KEY"
    | "INGEST_QUEUE_MAX_OPERATIONS"
    | "RAW_TELEMETRY"
    | "RAW_TELEMETRY_PREFIX"
    | "RAW_TELEMETRY_REQUIRED"
  >,
  messages: readonly TelemetryQueueMessage[]
) {
  for (const message of messages) {
    await Effect.runPromise(writeTelemetryQueueMessage(env, message));
  }
}

export async function processTelemetryQueueBatch(
  env: Pick<
    Env,
    | "DB"
    | "INGEST_CARDINALITY_MAX_VALUES_PER_KEY"
    | "INGEST_QUEUE_MAX_OPERATIONS"
    | "RAW_TELEMETRY"
    | "RAW_TELEMETRY_PREFIX"
    | "RAW_TELEMETRY_REQUIRED"
  >,
  batch: MessageBatch<TelemetryQueueMessage>
) {
  for (const message of batch.messages) {
    const result = await Effect.runPromise(Effect.either(writeTelemetryQueueMessage(env, message.body)));
    if (result._tag === "Left") {
      message.retry({ delaySeconds: Math.min(300, 2 ** Math.min(message.attempts, 8)) });
    } else {
      message.ack();
    }
  }
}
