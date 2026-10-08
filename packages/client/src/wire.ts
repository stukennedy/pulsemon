import { scrubAttributes } from './scrub';
import type {
  Attributes,
  ConnectionInput,
  ConnectionUpdateInput,
  EventInput,
  LogInput,
  MetricInput,
  SpanInput,
  ToolCallInput,
  VoiceTurnInput,
} from './types';

/**
 * Translate our record types onto Pulsemon's wire contract.
 *
 * One module because the mapping is fiddly in exactly the way that produced a
 * silent 400 on every batch: the field names differ from Pulsemon's own insert
 * helpers in several places, and timestamps are ISO strings on the wire while
 * every emitter here has epoch milliseconds. Keeping both concerns in one file
 * means the next contract change has one place to land.
 *
 * Every free-form bag (`attributes`, `tags`, `data`, `metadata`) is scrubbed on
 * the way out — Pulsemon types them `unknown`, so this is the only thing
 * standing between a careless caller and conversation content on the wire.
 */

/** Pulsemon wants ISO-8601; we carry epoch ms. Undefined stays undefined. */
const iso = (ms: number | undefined): string | undefined =>
  ms === undefined ? undefined : new Date(ms).toISOString();

/** Drop undefined keys so a batch never carries nulls the schema rejects. */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

const bag = (a: Attributes | undefined): Record<string, unknown> | undefined => scrubAttributes(a);

export const toConnection = (i: ConnectionInput): Record<string, unknown> =>
  compact({
    id: i.id,
    service: i.service,
    connection_type: i.connectionType,
    client_id: i.clientId,
    session_id: i.sessionId,
    started_at: iso(i.startedAt),
    status: i.status,
    metadata: bag(i.metadata),
  });

export const toConnectionUpdate = (i: ConnectionUpdateInput): Record<string, unknown> =>
  compact({
    id: i.id,
    ended_at: iso(i.endedAt),
    duration_ms: i.durationMs,
    close_reason: i.closeReason,
    status: i.status,
    metadata: bag(i.metadata),
  });

export const toSpan = (i: SpanInput): Record<string, unknown> =>
  compact({
    id: i.id,
    trace_id: i.traceId,
    parent_span_id: i.parentSpanId,
    connection_id: i.connectionId,
    service: i.service,
    operation: i.operation,
    started_at: iso(i.startedAt),
    ended_at: iso(i.endedAt),
    duration_ms: i.durationMs,
    status: i.status,
    status_message: i.statusMessage,
    attributes: bag(i.attributes),
  });

export const toEvent = (i: EventInput): Record<string, unknown> =>
  compact({
    id: i.id,
    event_type: i.eventType,
    connection_id: i.connectionId,
    trace_id: i.traceId,
    span_id: i.spanId,
    timestamp: iso(i.timestamp),
    // Events carry `data`, not `attributes`, and take no `service` — the event
    // type and its correlation ids are the identity.
    data: bag(i.attributes),
    direction: i.direction,
    size_bytes: i.sizeBytes,
  });

export const toLog = (i: LogInput): Record<string, unknown> =>
  compact({
    id: i.id,
    timestamp: iso(i.timestamp),
    level: i.level,
    service: i.service,
    message: i.message,
    trace_id: i.traceId,
    span_id: i.spanId,
    connection_id: i.connectionId,
    attributes: bag(i.attributes),
  });

export const toMetric = (i: MetricInput): Record<string, unknown> =>
  compact({
    id: i.id,
    service: i.service,
    metric_name: i.metricName,
    metric_type: i.metricType,
    timestamp: iso(i.timestamp),
    value: i.value,
    unit: i.unit,
    // Metrics label with `tags`, not `attributes`.
    tags: bag(i.tags),
  });

export const toVoiceTurn = (i: VoiceTurnInput): Record<string, unknown> =>
  compact({
    id: i.id,
    connection_id: i.connectionId,
    session_id: i.sessionId,
    trace_id: i.traceId,
    turn_index: i.turnIndex,
    role: i.role,
    started_at: iso(i.startedAt),
    ended_at: iso(i.endedAt),
    duration_ms: i.durationMs,
    interruption: i.interruption,
    audio_latency_ms: i.audioLatencyMs,
    asr_latency_ms: i.asrLatencyMs,
    llm_latency_ms: i.llmLatencyMs,
    tts_latency_ms: i.ttsLatencyMs,
    input_tokens: i.inputTokens,
    output_tokens: i.outputTokens,
    cost_usd: i.costUsd,
    state: i.state,
    // Reaches the wire only when the client was created with content capture
    // on — `client.ts` strips it at buffer time otherwise.
    transcript: i.transcript,
    // No dedicated wire column — folded into `metadata` (a scalar,
    // never CONTENT_KEYS-listed, so `scrubAttributes` keeps it) rather than
    // extending Pulsemon's schema for one low-cardinality flag.
    metadata: bag(
      i.ttsDegradedReason
        ? { ...i.metadata, tts_degraded_reason: i.ttsDegradedReason }
        : i.metadata,
    ),
  });

export const toToolCall = (i: ToolCallInput): Record<string, unknown> =>
  compact({
    id: i.id,
    trace_id: i.traceId,
    span_id: i.spanId,
    connection_id: i.connectionId,
    session_id: i.sessionId,
    turn_id: i.turnId,
    tool_name: i.toolName,
    started_at: iso(i.startedAt),
    ended_at: iso(i.endedAt),
    duration_ms: i.durationMs,
    status: i.status,
    retry_count: i.retryCount,
    error: i.error,
    metadata: bag(i.metadata),
  });
