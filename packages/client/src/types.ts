/**
 * The Pulsemon ingest records this platform is willing to send.
 *
 * ## These types are the privacy control
 *
 * Pulsemon's ingest accepts conversation content: `voice_turns.transcript`,
 * `tool_calls.input`, `tool_calls.output`. **None of them appear here, and that
 * is deliberate.** the platform's steering carries an explicit
 * invariant that durable voice logs are content-free — never transcript,
 * prompt, completion, tool arguments, provider bodies or raw error messages —
 * and end-user conversation is PII crossing into a separately-owned platform.
 *
 * Enforcing that by TYPE rather than by review means adding content later is a
 * visible act: someone has to widen this file, and the reviewer sees it. A
 * runtime allow-list backs it up for the untyped edges (`attributes`, `tags`,
 * `data`, `metadata`), which Pulsemon types as `unknown` and would otherwise
 * accept anything a caller happened to spread in.
 *
 * ## Pinned against the INPUT schema, not the insert functions
 *
 * Field names here are Pulsemon's wire contract, taken from the validation
 * error its `/api/ingest/batch` returns for an empty record — i.e. the schema
 * it actually enforces. The insert helpers in its `src/lib/effect/ingest.ts`
 * use *different* names in several places (`type` vs `connection_type`,
 * `attributes` vs `tags`/`data`), and reading those instead produced a batch
 * that 400'd on every request while looking perfectly reasonable in review.
 * If ingest changes, re-derive from a rejected payload rather than the inserts.
 *
 * ## Timestamps
 *
 * The wire wants ISO-8601 strings. This API takes **epoch milliseconds**,
 * because that is what every emitter in the platform already has (`Date.now()`,
 * the voice logger's `t`), and converts at the single boundary in `client.ts`.
 * One conversion point beats an ISO string built at forty call sites.
 */

/** Values a tag/attribute may carry. Structured content can't sneak in as an object. */
export type Scalar = string | number | boolean | null;

/** Low-cardinality, non-content attributes. See `scrubAttributes`. */
export type Attributes = Record<string, Scalar | undefined>;

export interface ConnectionInput {
  id?: string;
  service: string;
  /** `websocket` | `sse` | `webrtc`. Wire name is `connection_type`. */
  connectionType: string;
  clientId?: string;
  sessionId?: string;
  /** Epoch ms. */
  startedAt?: number;
  status?: string;
  metadata?: Attributes;
}

/**
 * Close/update a connection already opened by {@link ConnectionInput}. Wire
 * shape pinned against the platform's `connection_updates` batch entry
 * (`surfaces/pulsemon/src/lib/effect/schemas.ts`'s `BatchInputSchema`, NOT
 * `PatchConnectionInputSchema` — the two differ: the batch entry requires
 * `id`, `PatchConnectionInputSchema` doesn't carry one at all because it
 * expects the id on the URL of a single-record PATCH route this client never
 * calls). `id` is required here for the same reason it's required there —
 * without it the platform has nothing to apply the update to.
 */
export interface ConnectionUpdateInput {
  id: string;
  /** Epoch ms. */
  endedAt?: number;
  durationMs?: number;
  closeReason?: string;
  status?: string;
  metadata?: Attributes;
}

export interface SpanInput {
  id?: string;
  traceId: string;
  parentSpanId?: string;
  connectionId?: string;
  service: string;
  /** METHOD + route PATTERN. Never a resolved path — that is unbounded cardinality. */
  operation: string;
  /** Epoch ms. */
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status?: 'ok' | 'error';
  /** Stable classification, never a raw error message. */
  statusMessage?: string;
  attributes?: Attributes;
}

export interface EventInput {
  id?: string;
  eventType: string;
  connectionId?: string;
  traceId?: string;
  spanId?: string;
  /** Epoch ms. */
  timestamp?: number;
  /** Wire name is `data`. Scrubbed like every other free-form bag. */
  attributes?: Attributes;
  direction?: string;
  sizeBytes?: number;
}

export interface LogInput {
  id?: string;
  /** Epoch ms. */
  timestamp?: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  /**
   * The log's message. Our loggers already forbid PII here, and the forwarder
   * passes it through as written rather than enriching it.
   */
  message: string;
  traceId?: string;
  spanId?: string;
  connectionId?: string;
  attributes?: Attributes;
}

export interface MetricInput {
  id?: string;
  service: string;
  metricName: string;
  /** Wire name is `metric_type`, and it is REQUIRED. */
  metricType: 'gauge' | 'counter' | 'histogram';
  value: number;
  /** Epoch ms. */
  timestamp?: number;
  unit?: string;
  /** Wire name is `tags` — metrics do not take `attributes`. */
  tags?: Attributes;
}

/**
 * A voice turn. Everything here is timing, shape or cost — except
 * `transcript`, which is verbatim conversation content and is DROPPED by the
 * client unless it was created with `PULSEMON_CONTENT_CAPTURE: 'true'`.
 * Content-free stays the default; capture is an explicit per-environment
 * product/DPA decision (2026-08-12: internal/UAT rigs only, for reading the
 * voice brain's raw output — never production).
 */
export interface VoiceTurnInput {
  id?: string;
  connectionId?: string;
  sessionId?: string;
  traceId?: string;
  turnIndex?: number;
  role: 'user' | 'agent';
  /** Epoch ms. */
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  interruption?: boolean;
  /** Release → first audio frame the user could hear. */
  audioLatencyMs?: number;
  asrLatencyMs?: number;
  /** Time to first token, not total generation — that is `durationMs`. */
  llmLatencyMs?: number;
  ttsLatencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  state?: string;
  /** See the interface doc: ignored unless the client captures content. */
  transcript?: string;
  /**
   * Set when this turn's spoken half was dropped by a TTS vendor capacity
   * failure, post-retry (the TTS capacity-degraded client event and metric).
   * Bounded to a three-value reason, so this
   * stays a low-cardinality dimension rather than free text — content-free
   * by construction, like every other field here. Not a new top-level wire
   * column (this file's wire contract is pinned against Pulsemon's actual
   * ingest schema — see the file header): `toVoiceTurn` folds it into
   * `metadata`, which Pulsemon already accepts as a free-form scalar bag,
   * so this ships without a Pulsemon-side schema change.
   */
  ttsDegradedReason?: 'rate_limited' | 'server_error' | 'other';
  metadata?: Attributes;
}

/**
 * A tool call. `toolName` only — `input` and `output` are content (a tool's
 * arguments carry the end user's data) and are omitted
 * by construction.
 */
export interface ToolCallInput {
  id?: string;
  traceId?: string;
  spanId?: string;
  connectionId?: string;
  sessionId?: string;
  turnId?: string;
  toolName: string;
  /** Epoch ms. */
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status?: 'ok' | 'error';
  retryCount?: number;
  /** Stable code, never a raw error message. */
  error?: string;
  metadata?: Attributes;
}
