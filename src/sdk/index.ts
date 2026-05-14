export type PulsemonFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PulsemonClientOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly service: string;
  readonly fetch?: PulsemonFetch;
  readonly defaultAttributes?: Record<string, unknown>;
  readonly retries?: number;
  readonly retryBaseMs?: number;
}

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags?: string;
}

export interface ConnectionInput {
  readonly id?: string;
  readonly service?: string;
  readonly connection_type: string;
  readonly client_id?: string;
  readonly session_id?: string;
  readonly started_at?: string;
  readonly status?: string;
  readonly metadata?: unknown;
}

export interface ConnectionPatchInput {
  readonly ended_at?: string;
  readonly duration_ms?: number;
  readonly close_reason?: string;
  readonly status?: string;
  readonly metadata?: unknown;
}

export interface SpanInput {
  readonly id?: string;
  readonly trace_id: string;
  readonly parent_span_id?: string;
  readonly connection_id?: string;
  readonly service?: string;
  readonly operation: string;
  readonly started_at?: string;
  readonly ended_at?: string;
  readonly duration_ms?: number;
  readonly status?: string;
  readonly status_message?: string;
  readonly attributes?: unknown;
}

export interface SpanPatchInput {
  readonly ended_at?: string;
  readonly duration_ms?: number;
  readonly status?: string;
  readonly status_message?: string;
  readonly attributes?: unknown;
}

export interface EventInput {
  readonly id?: string;
  readonly connection_id?: string;
  readonly span_id?: string;
  readonly trace_id?: string;
  readonly event_type: string;
  readonly timestamp?: string;
  readonly data?: unknown;
  readonly direction?: string;
  readonly size_bytes?: number;
}

export interface MetricInput {
  readonly id?: string;
  readonly service?: string;
  readonly metric_name: string;
  readonly metric_type: string;
  readonly timestamp?: string;
  readonly value: number;
  readonly unit?: string;
  readonly count?: number;
  readonly sum?: number;
  readonly min?: number;
  readonly max?: number;
  readonly buckets?: unknown;
  readonly quantiles?: unknown;
  readonly tags?: unknown;
}

export interface LogInput {
  readonly id?: string;
  readonly timestamp?: string;
  readonly level: string;
  readonly service?: string;
  readonly message: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly connection_id?: string;
  readonly attributes?: unknown;
}

export interface VoiceTurnInput {
  readonly id?: string;
  readonly connection_id?: string;
  readonly session_id?: string;
  readonly trace_id?: string;
  readonly turn_index?: number;
  readonly role: string;
  readonly started_at?: string;
  readonly ended_at?: string;
  readonly duration_ms?: number;
  readonly transcript?: string;
  readonly transcript_confidence?: number;
  readonly vad_start_ms?: number;
  readonly vad_end_ms?: number;
  readonly interruption?: boolean;
  readonly audio_latency_ms?: number;
  readonly asr_latency_ms?: number;
  readonly llm_latency_ms?: number;
  readonly tts_latency_ms?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cost_usd?: number;
  readonly state?: string;
  readonly metadata?: unknown;
}

export interface AgentToolCallInput {
  readonly id?: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly connection_id?: string;
  readonly session_id?: string;
  readonly turn_id?: string;
  readonly tool_name: string;
  readonly started_at?: string;
  readonly ended_at?: string;
  readonly duration_ms?: number;
  readonly status?: string;
  readonly retry_count?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: unknown;
}

export interface BatchInput {
  readonly connections?: readonly ConnectionInput[];
  readonly connection_updates?: readonly (ConnectionPatchInput & { readonly id: string })[];
  readonly spans?: readonly SpanInput[];
  readonly span_updates?: readonly (SpanPatchInput & { readonly id: string })[];
  readonly events?: readonly EventInput[];
  readonly metrics?: readonly MetricInput[];
  readonly logs?: readonly LogInput[];
  readonly voice_turns?: readonly VoiceTurnInput[];
  readonly tool_calls?: readonly AgentToolCallInput[];
}

export interface WithSpanInput {
  readonly traceId?: string;
  readonly parentSpanId?: string;
  readonly connectionId?: string;
  readonly operation: string;
  readonly attributes?: Record<string, unknown>;
}

export class PulsemonError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "PulsemonError";
  }
}

function endpointUrl(endpoint: string, path: string) {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return `${base}${path}`;
}

function nowIso() {
  return new Date().toISOString();
}

function randomHex(bytes: number) {
  const array = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTraceContext(parent?: Partial<TraceContext>): TraceContext {
  return {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    traceFlags: parent?.traceFlags ?? "01",
  };
}

export function traceparent(context: TraceContext) {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags ?? "01"}`;
}

export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length !== 4 || parts[0] !== "00") return null;
  const [, traceId, spanId, traceFlags] = parts;
  if (!/^[a-f0-9]{32}$/i.test(traceId)) return null;
  if (!/^[a-f0-9]{16}$/i.test(spanId)) return null;
  if (!/^[a-f0-9]{2}$/i.test(traceFlags)) return null;
  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase(), traceFlags: traceFlags.toLowerCase() };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeAttributes(defaults: Record<string, unknown> | undefined, attributes: unknown) {
  if (!defaults) return attributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return defaults;
  }
  return { ...defaults, ...attributes as Record<string, unknown> };
}

function serviceRecord<T extends { readonly service?: string; readonly attributes?: unknown }>(
  input: T,
  service: string,
  defaultAttributes?: Record<string, unknown>
): Omit<T, "service" | "attributes"> & { service: string; attributes?: unknown } {
  return {
    ...input,
    service: input.service ?? service,
    attributes: mergeAttributes(defaultAttributes, input.attributes),
  };
}

function isReadonlyArray<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

export class PulsemonClient {
  private readonly fetcher: PulsemonFetch;
  private readonly retries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly options: PulsemonClientOptions) {
    if (!options.endpoint) throw new PulsemonError("Pulsemon endpoint is required");
    if (!options.apiKey) throw new PulsemonError("Pulsemon API key is required");
    if (!options.service) throw new PulsemonError("Pulsemon service name is required");

    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.retries = options.retries ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 100;
  }

  async connection(input: ConnectionInput) {
    return this.post<{ id: string }>("/api/ingest/connections", {
      ...input,
      service: input.service ?? this.options.service,
    });
  }

  async closeConnection(id: string, input: ConnectionPatchInput = {}) {
    return this.patch<{ id: string }>(`/api/ingest/connections/${encodeURIComponent(id)}`, {
      ended_at: input.ended_at ?? nowIso(),
      status: input.status ?? "closed",
      ...input,
    });
  }

  async span(input: SpanInput) {
    return this.post<{ id: string }>("/api/ingest/spans", serviceRecord(
      input,
      this.options.service,
      this.options.defaultAttributes
    ));
  }

  async closeSpan(id: string, input: SpanPatchInput = {}) {
    return this.patch<{ id: string }>(`/api/ingest/spans/${encodeURIComponent(id)}`, {
      ended_at: input.ended_at ?? nowIso(),
      status: input.status ?? "ok",
      ...input,
    });
  }

  async event(input: EventInput | readonly EventInput[]) {
    return this.post<{ count: number; sampled_out?: number }>("/api/ingest/events", input);
  }

  async metric(input: MetricInput | readonly MetricInput[]) {
    const body = isReadonlyArray(input)
      ? input.map((item) => ({ ...item, service: item.service ?? this.options.service }))
      : { ...input, service: input.service ?? this.options.service };
    return this.post<{ count: number; sampled_out?: number }>("/api/ingest/metrics", body);
  }

  async log(input: LogInput | readonly LogInput[]) {
    const body = isReadonlyArray(input)
      ? input.map((item) => serviceRecord(item, this.options.service, this.options.defaultAttributes))
      : serviceRecord(input, this.options.service, this.options.defaultAttributes);
    return this.post<{ count: number; sampled_out?: number }>("/api/ingest/logs", body);
  }

  async voiceTurn(input: VoiceTurnInput | readonly VoiceTurnInput[]) {
    return this.post<{ count: number }>("/api/ingest/voice/turns", input);
  }

  async agentToolCall(input: AgentToolCallInput | readonly AgentToolCallInput[]) {
    return this.post<{ count: number }>("/api/ingest/agent/tool-calls", input);
  }

  async batch(input: BatchInput) {
    return this.post<{ counts: Record<string, number>; sampled_out?: number }>("/api/ingest/batch", {
      ...input,
      connections: input.connections?.map((item) => ({ ...item, service: item.service ?? this.options.service })),
      spans: input.spans?.map((item) => serviceRecord(item, this.options.service, this.options.defaultAttributes)),
      metrics: input.metrics?.map((item) => ({ ...item, service: item.service ?? this.options.service })),
      logs: input.logs?.map((item) => serviceRecord(item, this.options.service, this.options.defaultAttributes)),
    });
  }

  batcher() {
    return new PulsemonBatcher(this);
  }

  async withSpan<T>(input: WithSpanInput, fn: (context: TraceContext) => Promise<T>): Promise<T> {
    const context = createTraceContext({ traceId: input.traceId, spanId: input.parentSpanId });
    const startedAt = nowIso();
    const started = performance.now();

    try {
      const result = await fn(context);
      await this.span({
        id: context.spanId,
        trace_id: context.traceId,
        parent_span_id: input.parentSpanId,
        connection_id: input.connectionId,
        operation: input.operation,
        started_at: startedAt,
        ended_at: nowIso(),
        duration_ms: Math.round(performance.now() - started),
        status: "ok",
        attributes: input.attributes,
      });
      return result;
    } catch (error) {
      await this.span({
        id: context.spanId,
        trace_id: context.traceId,
        parent_span_id: input.parentSpanId,
        connection_id: input.connectionId,
        operation: input.operation,
        started_at: startedAt,
        ended_at: nowIso(),
        duration_ms: Math.round(performance.now() - started),
        status: "error",
        status_message: error instanceof Error ? error.message : String(error),
        attributes: input.attributes,
      });
      throw error;
    }
  }

  private async post<T>(path: string, body: unknown) {
    return this.request<T>("POST", path, body);
  }

  private async patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetcher(endpointUrl(this.options.endpoint, path), {
          method,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) return await response.json() as T;

        const responseBody = await readResponseBody(response);
        if (attempt < this.retries && (response.status === 429 || response.status >= 500)) {
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }

        throw new PulsemonError(`Pulsemon request failed with ${response.status}`, response.status, responseBody);
      } catch (error) {
        lastError = error;
        if (error instanceof PulsemonError || attempt >= this.retries) break;
        await sleep(this.retryBaseMs * 2 ** attempt);
      }
    }

    if (lastError instanceof PulsemonError) throw lastError;
    throw new PulsemonError(lastError instanceof Error ? lastError.message : String(lastError));
  }
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class PulsemonBatcher {
  private readonly input: MutableBatchInput = {};

  constructor(private readonly client: PulsemonClient) {}

  connection(input: ConnectionInput) {
    this.push("connections", input);
    return this;
  }

  connectionUpdate(input: ConnectionPatchInput & { readonly id: string }) {
    this.push("connection_updates", input);
    return this;
  }

  span(input: SpanInput) {
    this.push("spans", input);
    return this;
  }

  spanUpdate(input: SpanPatchInput & { readonly id: string }) {
    this.push("span_updates", input);
    return this;
  }

  event(input: EventInput) {
    this.push("events", input);
    return this;
  }

  metric(input: MetricInput) {
    this.push("metrics", input);
    return this;
  }

  log(input: LogInput) {
    this.push("logs", input);
    return this;
  }

  voiceTurn(input: VoiceTurnInput) {
    this.push("voice_turns", input);
    return this;
  }

  agentToolCall(input: AgentToolCallInput) {
    this.push("tool_calls", input);
    return this;
  }

  size() {
    return Object.values(this.input).reduce((total, items) => total + (items?.length ?? 0), 0);
  }

  clear() {
    for (const key of Object.keys(this.input) as (keyof MutableBatchInput)[]) {
      delete this.input[key];
    }
  }

  async flush() {
    const input = this.snapshot();
    this.clear();
    return this.client.batch(input);
  }

  private snapshot(): BatchInput {
    return {
      connections: this.input.connections,
      connection_updates: this.input.connection_updates,
      spans: this.input.spans,
      span_updates: this.input.span_updates,
      events: this.input.events,
      metrics: this.input.metrics,
      logs: this.input.logs,
      voice_turns: this.input.voice_turns,
      tool_calls: this.input.tool_calls,
    };
  }

  private push<K extends keyof MutableBatchInput>(
    key: K,
    value: NonNullable<MutableBatchInput[K]>[number]
  ) {
    const list = this.input[key] ?? [];
    list.push(value as never);
    this.input[key] = list as MutableBatchInput[K];
  }
}

type MutableBatchInput = {
  connections?: ConnectionInput[];
  connection_updates?: (ConnectionPatchInput & { readonly id: string })[];
  spans?: SpanInput[];
  span_updates?: (SpanPatchInput & { readonly id: string })[];
  events?: EventInput[];
  metrics?: MetricInput[];
  logs?: LogInput[];
  voice_turns?: VoiceTurnInput[];
  tool_calls?: AgentToolCallInput[];
};
