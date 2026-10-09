import {
  toConnection,
  toConnectionUpdate,
  toEvent,
  toLog,
  toMetric,
  toSpan,
  toToolCall,
  toVoiceTurn,
} from './wire';
import type {
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
 * A buffered, best-effort Pulsemon ingest client.
 *
 * ## Three properties it must never lose
 *
 * **Inert without config.** No URL or no key means every method is a no-op —
 * not a degraded mode, not a queue that grows. A surface with Pulsemon
 * unconfigured behaves exactly as it did before this package existed.
 *
 * **Never on the critical path.** Records buffer in memory; `flush()` is the
 * only thing that touches the network, it resolves rather than rejects, and
 * callers hand it to `waitUntil`. A user never waits for telemetry and a
 * dead Pulsemon never fails a scan.
 *
 * **One subrequest per flush.** Workers cap subrequests per invocation, so a
 * POST per record would burn that budget and eventually start failing real
 * work. Everything goes through `POST /api/ingest/batch`.
 */
export interface PulsemonClient {
  /** False when unconfigured — callers can skip building payloads entirely. */
  readonly enabled: boolean;
  connection(input: ConnectionInput): void;
  /** Close/update a connection opened by {@link connection}. Ships in the
   *  batch's `connection_updates` bucket, never `connections` — the platform
   *  distinguishes POST (open) from update by which bucket a record rides. */
  connectionUpdate(input: ConnectionUpdateInput): void;
  span(input: SpanInput): void;
  event(input: EventInput): void;
  log(input: LogInput): void;
  metric(input: MetricInput): void;
  voiceTurn(input: VoiceTurnInput): void;
  toolCall(input: ToolCallInput): void;
  /** How many records are waiting. Exposed for tests and flush-threshold logic. */
  readonly pending: number;
  /**
   * Send everything buffered. Always resolves — a transport failure is
   * swallowed, because the alternative is an unhandled rejection inside
   * someone's `waitUntil`. Buffers are cleared BEFORE the request so a failure
   * drops one batch rather than replaying it forever.
   */
  flush(): Promise<void>;
}

export interface PulsemonConfig {
  /** Base URL of the Pulsemon deployment, e.g. `https://pulsemon-uat.example.com`. */
  PULSEMON_INGEST_URL?: string | undefined;
  PULSEMON_INGEST_KEY?: string | undefined;
  /**
   * `'true'` lets `VoiceTurnInput.transcript` through to the wire; any other
   * value (or absence) strips it at buffer time, so the package stays
   * content-free by default no matter what a caller populates. Turning this on
   * is a per-environment product/DPA decision (2026-08-12: internal/UAT rigs
   * only), not a debugging convenience — see the package CLAUDE.md.
   */
  PULSEMON_CONTENT_CAPTURE?: string | undefined;
}

/**
 * Records buffered before `flush` is forced. A voice call emits a few hundred
 * events; without a ceiling a long call would hold them all in DO memory and
 * then fail the batch on size. Callers still flush explicitly at natural
 * boundaries (end of request, end of turn, end of call).
 */
export const MAX_BUFFERED = 200;

const NOOP: PulsemonClient = {
  enabled: false,
  connection: () => {/* no-op */},
  connectionUpdate: () => {/* no-op */},
  span: () => {/* no-op */},
  event: () => {/* no-op */},
  log: () => {/* no-op */},
  metric: () => {/* no-op */},
  voiceTurn: () => {/* no-op */},
  toolCall: () => {/* no-op */},
  pending: 0,
  flush: () => Promise.resolve(),
};

/**
 * Injectable transport. Defaults to the ambient `fetch`; a consumer on the same
 * Cloudflare account passes a **service binding's** `fetch` instead, which
 * keeps the call inside Cloudflare (no DNS, no TLS handshake, no public
 * internet) while speaking the identical HTTP contract — so Pulsemon's bearer
 * auth, tenant scoping and validation all still run.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export interface PulsemonClientOptions {
  fetch?: FetchLike;
  /**
   * Called when a batch is rejected or the transport fails. Optional, and
   * deliberately not a throw: ingest stays best-effort, but a silent failure
   * makes an empty Pulsemon indistinguishable from a quiet system.
   */
  onError?: (detail: { status?: number; error?: string }) => void;
  /**
   * Overrides `PULSEMON_INGEST_URL`. Its only real use is the service-binding
   * path, where the origin is routed by the binding and therefore arbitrary —
   * but a URL is still needed because the PATH selects the ingest endpoint.
   */
  baseUrl?: string;
}

export function createPulsemonClient(
  config: PulsemonConfig,
  options: PulsemonClientOptions = {},
): PulsemonClient {
  const base = (options.baseUrl ?? config.PULSEMON_INGEST_URL)?.trim().replace(/\/+$/, '');
  const key = config.PULSEMON_INGEST_KEY?.trim();
  // Both, or nothing. A route without a key would 401 every flush forever, and
  // the key is what carries tenant scope — it is not optional just because the
  // transport happens to be a trusted in-account binding.
  if (!base || !key) return NOOP;

  const onError = options.onError;
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== 'function') return NOOP;

  // Exact-match on 'true', not truthiness: a copy-pasted "false" or a stray
  // "1" must not quietly start shipping conversation content.
  const captureContent = config.PULSEMON_CONTENT_CAPTURE?.trim() === 'true';

  type Wire = Record<string, unknown>;
  const buffer: {
    connections: Wire[]; connection_updates: Wire[]; spans: Wire[]; events: Wire[]; metrics: Wire[];
    logs: Wire[]; voice_turns: Wire[]; tool_calls: Wire[];
  } = {
    connections: [],
    connection_updates: [],
    spans: [],
    events: [],
    metrics: [],
    logs: [],
    voice_turns: [],
    tool_calls: [],
  };

  let flushing: Promise<void> | null = null;

  const count = (): number =>
    buffer.connections.length +
    buffer.connection_updates.length +
    buffer.spans.length +
    buffer.events.length +
    buffer.metrics.length +
    buffer.logs.length +
    buffer.voice_turns.length +
    buffer.tool_calls.length;

  const drain = (): Record<string, unknown> | null => {
    if (count() === 0) return null;
    const body: Record<string, unknown> = {};
    if (buffer.connections.length) body.connections = buffer.connections.splice(0);
    if (buffer.connection_updates.length) body.connection_updates = buffer.connection_updates.splice(0);
    if (buffer.spans.length) body.spans = buffer.spans.splice(0);
    if (buffer.events.length) body.events = buffer.events.splice(0);
    if (buffer.metrics.length) body.metrics = buffer.metrics.splice(0);
    if (buffer.logs.length) body.logs = buffer.logs.splice(0);
    if (buffer.voice_turns.length) body.voice_turns = buffer.voice_turns.splice(0);
    if (buffer.tool_calls.length) body.tool_calls = buffer.tool_calls.splice(0);
    return body;
  };

  async function runFlush(): Promise<void> {
    try {
      while (true) {
        const body = drain();
        if (!body) return;
        try {
          const res = await doFetch(`${base}/api/ingest/batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          });
          if (!res.ok) onError?.({ status: res.status });
        } catch (err) {
          onError?.({ error: err instanceof Error ? err.name : 'UnknownError' });
        }
      }
    } finally {
      flushing = null;
      // No `await` occurs between releasing ownership and this check, so a
      // record cannot slip into an already-resolved flush. If work arrived
      // while the previous owner was winding down, the same public promise
      // includes the follow-up drain.
      if (count() > 0) await flush();
    }
  }

  function flush(): Promise<void> {
    // Serialise flushes: every caller receives the owner's complete promise,
    // including any follow-up drain scheduled as that owner releases the lock.
    if (flushing) return flushing;
    // Avoid assigning an already-resolved async operation: it could complete
    // synchronously before ownership is stored and leave a stale promise that
    // blocks every later drain.
    if (count() === 0) return Promise.resolve();
    flushing = runFlush();
    return flushing;
  }

  /** Buffer a record, shedding old work if a caller never flushes. */
  const push = <T>(list: T[], record: T): void => {
    list.push(record);
    if (count() > MAX_BUFFERED) {
      // Over budget: shed rather than grow — telemetry is not worth an OOM in
      // a Durable Object that is also holding a live call. Shed from the
      // LONGEST kind, not the list just appended to: shifting the appended
      // list discards the brand-new record whenever it was that list's only
      // entry, while older records of other kinds survive it.
      const kinds: Record<string, unknown>[][] = [
        buffer.connections,
        buffer.connection_updates,
        buffer.spans,
        buffer.events,
        buffer.metrics,
        buffer.logs,
        buffer.voice_turns,
        buffer.tool_calls,
      ];
      let longest = kinds[0] as Record<string, unknown>[];
      for (const kind of kinds) if (kind.length > longest.length) longest = kind;
      longest.shift();
    }
  };

  return {
    enabled: true,
    get pending() {
      return count();
    },
    // Translated to the wire contract on the way IN, so a malformed record is
    // impossible to buffer and the flush is a pure send. `wire.ts` owns every
    // field-name and timestamp difference.
    connection: (input) => push(buffer.connections, toConnection(input)),
    connectionUpdate: (input) => push(buffer.connection_updates, toConnectionUpdate(input)),
    span: (input) => push(buffer.spans, toSpan(input)),
    event: (input) => push(buffer.events, toEvent(input)),
    log: (input) => push(buffer.logs, toLog(input)),
    metric: (input) => push(buffer.metrics, toMetric(input)),
    // The content gate lives HERE, not in the caller: stripping at buffer time
    // means a populated `transcript` cannot reach the wire on an uncaptured
    // environment even if every call site forgets to check.
    voiceTurn: (input) =>
      push(
        buffer.voice_turns,
        toVoiceTurn(captureContent ? input : { ...input, transcript: undefined }),
      ),
    toolCall: (input) => push(buffer.tool_calls, toToolCall(input)),
    flush,
  };
}
