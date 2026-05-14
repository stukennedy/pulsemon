import * as Schema from "effect/Schema";

const OptionalString = Schema.optional(Schema.String);
const OptionalNumber = Schema.optional(Schema.Number);
const OptionalBoolean = Schema.optional(Schema.Boolean);
const OptionalUnknown = Schema.optional(Schema.Unknown);

export const PostConnectionInputSchema = Schema.Struct({
  id: OptionalString,
  service: Schema.NonEmptyString,
  connection_type: Schema.NonEmptyString,
  client_id: OptionalString,
  session_id: OptionalString,
  started_at: OptionalString,
  status: OptionalString,
  metadata: OptionalUnknown,
});
export type PostConnectionInput = Schema.Schema.Type<typeof PostConnectionInputSchema>;

export const PatchConnectionInputSchema = Schema.Struct({
  ended_at: OptionalString,
  duration_ms: OptionalNumber,
  close_reason: OptionalString,
  status: OptionalString,
  metadata: OptionalUnknown,
});
export type PatchConnectionInput = Schema.Schema.Type<typeof PatchConnectionInputSchema>;

export const PostSpanInputSchema = Schema.Struct({
  id: OptionalString,
  trace_id: Schema.NonEmptyString,
  parent_span_id: OptionalString,
  connection_id: OptionalString,
  service: Schema.NonEmptyString,
  operation: Schema.NonEmptyString,
  started_at: OptionalString,
  ended_at: OptionalString,
  duration_ms: OptionalNumber,
  status: OptionalString,
  status_message: OptionalString,
  attributes: OptionalUnknown,
});
export type PostSpanInput = Schema.Schema.Type<typeof PostSpanInputSchema>;

export const PatchSpanInputSchema = Schema.Struct({
  ended_at: OptionalString,
  duration_ms: OptionalNumber,
  status: OptionalString,
  status_message: OptionalString,
  attributes: OptionalUnknown,
});
export type PatchSpanInput = Schema.Schema.Type<typeof PatchSpanInputSchema>;

export const PostEventInputSchema = Schema.Struct({
  id: OptionalString,
  connection_id: OptionalString,
  span_id: OptionalString,
  trace_id: OptionalString,
  event_type: Schema.NonEmptyString,
  timestamp: OptionalString,
  data: OptionalUnknown,
  direction: OptionalString,
  size_bytes: OptionalNumber,
});
export type PostEventInput = Schema.Schema.Type<typeof PostEventInputSchema>;

export const PostMetricInputSchema = Schema.Struct({
  id: OptionalString,
  service: Schema.NonEmptyString,
  metric_name: Schema.NonEmptyString,
  metric_type: Schema.NonEmptyString,
  timestamp: OptionalString,
  value: Schema.Number,
  unit: OptionalString,
  count: OptionalNumber,
  sum: OptionalNumber,
  min: OptionalNumber,
  max: OptionalNumber,
  buckets: OptionalUnknown,
  quantiles: OptionalUnknown,
  tags: OptionalUnknown,
});
export type PostMetricInput = Schema.Schema.Type<typeof PostMetricInputSchema>;

export const PostLogInputSchema = Schema.Struct({
  id: OptionalString,
  timestamp: OptionalString,
  level: Schema.NonEmptyString,
  service: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  trace_id: OptionalString,
  span_id: OptionalString,
  connection_id: OptionalString,
  attributes: OptionalUnknown,
});
export type PostLogInput = Schema.Schema.Type<typeof PostLogInputSchema>;

export const PostVoiceTurnInputSchema = Schema.Struct({
  id: OptionalString,
  connection_id: OptionalString,
  session_id: OptionalString,
  trace_id: OptionalString,
  turn_index: OptionalNumber,
  role: Schema.NonEmptyString,
  started_at: OptionalString,
  ended_at: OptionalString,
  duration_ms: OptionalNumber,
  transcript: OptionalString,
  transcript_confidence: OptionalNumber,
  vad_start_ms: OptionalNumber,
  vad_end_ms: OptionalNumber,
  interruption: OptionalBoolean,
  audio_latency_ms: OptionalNumber,
  asr_latency_ms: OptionalNumber,
  llm_latency_ms: OptionalNumber,
  tts_latency_ms: OptionalNumber,
  input_tokens: OptionalNumber,
  output_tokens: OptionalNumber,
  cost_usd: OptionalNumber,
  state: OptionalString,
  metadata: OptionalUnknown,
});
export type PostVoiceTurnInput = Schema.Schema.Type<typeof PostVoiceTurnInputSchema>;

export const PostAgentToolCallInputSchema = Schema.Struct({
  id: OptionalString,
  trace_id: OptionalString,
  span_id: OptionalString,
  connection_id: OptionalString,
  session_id: OptionalString,
  turn_id: OptionalString,
  tool_name: Schema.NonEmptyString,
  started_at: OptionalString,
  ended_at: OptionalString,
  duration_ms: OptionalNumber,
  status: OptionalString,
  retry_count: OptionalNumber,
  input: OptionalUnknown,
  output: OptionalUnknown,
  error: OptionalString,
  metadata: OptionalUnknown,
});
export type PostAgentToolCallInput = Schema.Schema.Type<typeof PostAgentToolCallInputSchema>;

export const BatchInputSchema = Schema.Struct({
  connections: Schema.optional(Schema.Array(PostConnectionInputSchema)),
  connection_updates: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.NonEmptyString,
    ended_at: OptionalString,
    duration_ms: OptionalNumber,
    close_reason: OptionalString,
    status: OptionalString,
    metadata: OptionalUnknown,
  }))),
  spans: Schema.optional(Schema.Array(PostSpanInputSchema)),
  span_updates: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.NonEmptyString,
    ended_at: OptionalString,
    duration_ms: OptionalNumber,
    status: OptionalString,
    status_message: OptionalString,
    attributes: OptionalUnknown,
  }))),
  events: Schema.optional(Schema.Array(PostEventInputSchema)),
  metrics: Schema.optional(Schema.Array(PostMetricInputSchema)),
  logs: Schema.optional(Schema.Array(PostLogInputSchema)),
  voice_turns: Schema.optional(Schema.Array(PostVoiceTurnInputSchema)),
  tool_calls: Schema.optional(Schema.Array(PostAgentToolCallInputSchema)),
});
export type BatchInput = Schema.Schema.Type<typeof BatchInputSchema>;
