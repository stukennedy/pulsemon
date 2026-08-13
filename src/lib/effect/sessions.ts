import { Effect } from "effect";
import type { AgentToolCall, Connection, Event, LogRecord, Span, VoiceTurn } from "@/db/schema";
import type { TenantScope } from "@/types";
import { createTurnCorrelator } from "@/lib/effect/turn-correlation";
import { buildWaterfall, type WaterfallRow } from "@/lib/effect/voice-waterfall";
import { DatabaseError } from "./errors";
import { queryVoiceLatencyPercentiles } from "./voice-stats";

export interface VoiceSessionSummary {
  readonly session_id: string;
  readonly connection_id: string | null;
  readonly trace_id: string | null;
  readonly started_at: string;
  readonly last_seen_at: string;
  readonly turn_count: number;
  readonly interruption_count: number;
  readonly tool_call_count: number;
  readonly tool_error_count: number;
  readonly avg_asr_latency_ms: number | null;
  readonly avg_llm_latency_ms: number | null;
  readonly avg_tts_latency_ms: number | null;
  readonly total_tokens: number;
  readonly cost_usd: number;
}

export interface RealtimeSessionDetail {
  readonly summary: VoiceSessionSummary | null;
  readonly connection: Connection | null;
  readonly turns: VoiceTurn[];
  readonly toolCalls: AgentToolCall[];
  readonly spans: Span[];
  readonly logs: LogRecord[];
  readonly events: Event[];
  readonly turnsWithTelemetry: TurnWithTelemetry[];
  readonly waterfallRows: WaterfallRow[];
  readonly timeline: SessionTimelineEntry[];
}

export interface TurnWithTelemetry {
  readonly turn: VoiceTurn;
  readonly toolCalls: AgentToolCall[];
  readonly events: Event[];
}

export type SessionTimelineEntry =
  | { readonly type: "turn"; readonly at: string; readonly item: VoiceTurn }
  | { readonly type: "tool"; readonly at: string; readonly item: AgentToolCall }
  | { readonly type: "span"; readonly at: string; readonly item: Span }
  | { readonly type: "log"; readonly at: string; readonly item: LogRecord }
  | { readonly type: "event"; readonly at: string; readonly item: Event };

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

// D1 rejects any statement binding more than 100 parameters ("too many SQL
// variables"), so id lists built from session data must be chunked — a large
// session otherwise turns the whole detail page into a 500. 90 leaves
// headroom for the tenant scope and fixed binds that ride along.
const MAX_IDS_PER_QUERY = 90;

function chunk<T>(values: readonly T[], size = MAX_IDS_PER_QUERY): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function sessionKey(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : null;
}

export function voiceSessionStatus(summary: VoiceSessionSummary) {
  if (summary.tool_error_count > 0) return "error";
  if (summary.interruption_count > 0) return "warn";
  return "ok";
}

export interface VoiceStageStats {
  readonly stage: "asr" | "llm" | "tts" | "audio";
  readonly samples: number;
  readonly avg: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
}

/**
 * Per-stage latency stats computed from `voice_turns` - the voice pipeline's
 * canonical record - NOT from spans. The previous voice header filtered spans
 * whose operation starts with asr/llm/tts, a naming convention no ingest
 * enforces; a producer reporting turns (the documented voice path) rendered
 * "0 samples" forever while its data sat one table away.
 *
 * `audio` is release to first audible frame: the number the USER experiences
 * as reply latency, and the one worth alerting on.
 */
export function queryVoiceStageStats(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<VoiceStageStats[], DatabaseError> {
  return dbEffect(async () => {
    // Bounded to the most recent ROWS EXAMINED (one indexed window shared by
    // all four stages), with null stages filtered afterwards. Bounding on
    // non-null samples instead would let a sparse or never-reporting stage
    // walk the tenant's entire history hunting for matches - the LIMIT must
    // sit where the index can serve it. Percentiles therefore read as "over
    // the last 2000 turns", which is also the operationally honest window:
    // last week's incident should not colour today's p95.
    const result = await queryVoiceLatencyPercentiles(db, tenant);

    const byStage = new Map(result.map((row) => [row.stage, row]));
    // Always all four stages, in pipeline order - a stage with no data renders
    // as "0 samples" rather than disappearing, which is what tells an operator
    // their producer isn't reporting it.
    return (["asr", "llm", "tts", "audio"] as const).map((stage) => {
      const row = byStage.get(stage);
      return {
        stage,
        samples: Number(row?.samples ?? 0),
        avg: numberOrNull(row?.avg),
        p50: numberOrNull(row?.p50),
        p95: numberOrNull(row?.p95),
      };
    });
  });
}

/**
 * Derived from the schema row rather than redeclared: a hand-written mirror
 * already drifted once (started_at declared nullable against a NOT NULL
 * column), and Pick makes the next schema change a type error here instead of
 * a stale UI contract.
 */
export type RecentVoiceTurn = Pick<
  VoiceTurn,
  | "id"
  | "trace_id"
  | "session_id"
  | "role"
  | "started_at"
  | "asr_latency_ms"
  | "llm_latency_ms"
  | "tts_latency_ms"
  | "audio_latency_ms"
  | "duration_ms"
  | "interruption"
  | "state"
>;

/** Most recent turns across sessions - the "recent pipelines" feed, one row
 *  per turn, each linking back to its session. */
export function queryRecentVoiceTurns(
  db: D1Database,
  tenant: TenantScope,
  limit = 25
): Effect.Effect<RecentVoiceTurn[], DatabaseError> {
  return dbEffect(async () => {
    const result = await db.prepare(
      `SELECT id, trace_id, session_id, role, started_at,
              asr_latency_ms, llm_latency_ms, tts_latency_ms, audio_latency_ms,
              duration_ms, interruption, state
       FROM voice_turns
       WHERE workspace_id = ? AND project_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, limit).all<RecentVoiceTurn>();
    return result.results;
  });
}

export function queryVoiceSessionSummaries(
  db: D1Database,
  tenant: TenantScope,
  limit = 100
): Effect.Effect<VoiceSessionSummary[], DatabaseError> {
  return dbEffect(async () => {
    const voiceRows = await db.prepare(
      `SELECT
        session_id,
        MIN(connection_id) AS connection_id,
        MIN(trace_id) AS trace_id,
        MIN(started_at) AS started_at,
        MAX(COALESCE(ended_at, started_at)) AS last_seen_at,
        COUNT(*) AS turn_count,
        SUM(CASE WHEN interruption = 1 THEN 1 ELSE 0 END) AS interruption_count,
        AVG(CASE WHEN asr_latency_ms >= 0 THEN asr_latency_ms END) AS avg_asr_latency_ms,
        AVG(CASE WHEN llm_latency_ms >= 0 THEN llm_latency_ms END) AS avg_llm_latency_ms,
        AVG(CASE WHEN tts_latency_ms >= 0 THEN tts_latency_ms END) AS avg_tts_latency_ms,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS total_tokens,
        SUM(COALESCE(cost_usd, 0)) AS cost_usd
       FROM voice_turns
       WHERE workspace_id = ?
         AND project_id = ?
         AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY last_seen_at DESC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, limit).all<{
      session_id: string;
      connection_id: string | null;
      trace_id: string | null;
      started_at: string;
      last_seen_at: string;
      turn_count: number;
      interruption_count: number | null;
      avg_asr_latency_ms: number | null;
      avg_llm_latency_ms: number | null;
      avg_tts_latency_ms: number | null;
      total_tokens: number | null;
      cost_usd: number | null;
    }>();

    const sessions = voiceRows.results.map((row) => row.session_id);
    const toolRows: Array<{
      session_id: string;
      tool_call_count: number;
      tool_error_count: number | null;
    }> = [];
    for (const sessionChunk of chunk(sessions)) {
      toolRows.push(...(await db.prepare(
        `SELECT
          session_id,
          COUNT(*) AS tool_call_count,
          SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS tool_error_count
         FROM agent_tool_calls
         WHERE workspace_id = ?
           AND project_id = ?
           AND session_id IN (${placeholders(sessionChunk)})
         GROUP BY session_id`
      ).bind(tenant.workspace_id, tenant.project_id, ...sessionChunk).all<{
        session_id: string;
        tool_call_count: number;
        tool_error_count: number | null;
      }>()).results);
    }

    const toolBySession = new Map(toolRows.map((row) => [row.session_id, row]));

    return voiceRows.results.map((row) => {
      const tool = toolBySession.get(row.session_id);
      return {
        session_id: row.session_id,
        connection_id: row.connection_id,
        trace_id: row.trace_id,
        started_at: row.started_at,
        last_seen_at: row.last_seen_at,
        turn_count: Number(row.turn_count),
        interruption_count: Number(row.interruption_count ?? 0),
        tool_call_count: Number(tool?.tool_call_count ?? 0),
        tool_error_count: Number(tool?.tool_error_count ?? 0),
        avg_asr_latency_ms: numberOrNull(row.avg_asr_latency_ms),
        avg_llm_latency_ms: numberOrNull(row.avg_llm_latency_ms),
        avg_tts_latency_ms: numberOrNull(row.avg_tts_latency_ms),
        total_tokens: Number(row.total_tokens ?? 0),
        cost_usd: Number(row.cost_usd ?? 0),
      };
    });
  });
}

export function getRealtimeSession(
  db: D1Database,
  tenant: TenantScope,
  sessionId: string
): Effect.Effect<RealtimeSessionDetail, DatabaseError> {
  return dbEffect(async () => {
    const [summaries, turnsResult] = await Promise.all([
      Effect.runPromise(queryVoiceSessionSummaries(db, tenant, 500)),
      db.prepare(
        `SELECT * FROM voice_turns
         WHERE workspace_id = ?
           AND project_id = ?
           AND session_id = ?
         ORDER BY started_at ASC, COALESCE(turn_index, 0) ASC`
      ).bind(tenant.workspace_id, tenant.project_id, sessionId).all<VoiceTurn>(),
    ]);

    const summary = summaries.find((item) => item.session_id === sessionId) ?? null;
    const turns = turnsResult.results;
    const connectionId = sessionKey(summary?.connection_id) ?? sessionKey(turns[0]?.connection_id) ?? null;
    const turnIds = turns.map((turn) => turn.id);
    const turnTraceIds = Array.from(new Set(
      turns.map((turn) => sessionKey(turn.trace_id)).filter((value): value is string => Boolean(value))
    ));
    // Each lookup is its own bounded query; the union is deduped and re-sorted
    // below. Any row in the global top-500 by started_at is necessarily in its
    // own query's top-500, so the per-query LIMIT preserves the old semantics.
    const toolCallLookups: Array<{ condition: string; bindings: unknown[] }> = [
      connectionId
        ? { condition: "(session_id = ? OR connection_id = ?)", bindings: [sessionId, connectionId] }
        : { condition: "session_id = ?", bindings: [sessionId] },
    ];
    const turnKeys = Array.from(new Set([...turnIds, ...turnTraceIds]));
    for (const keys of chunk(turnKeys)) {
      toolCallLookups.push({ condition: `turn_id IN (${placeholders(keys)})`, bindings: keys });
    }
    for (const keys of chunk(turnTraceIds)) {
      toolCallLookups.push({ condition: `trace_id IN (${placeholders(keys)})`, bindings: keys });
    }
    const toolCallsById = new Map<string, AgentToolCall>();
    for (const lookup of toolCallLookups) {
      const rows = (await db.prepare(
        `SELECT * FROM agent_tool_calls
         WHERE workspace_id = ?
           AND project_id = ?
           AND ${lookup.condition}
         ORDER BY started_at ASC
         LIMIT 500`
      ).bind(tenant.workspace_id, tenant.project_id, ...lookup.bindings).all<AgentToolCall>()).results;
      for (const row of rows) toolCallsById.set(row.id, row);
    }
    const toolCalls = Array.from(toolCallsById.values())
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .slice(0, 500);
    const traceIds = Array.from(new Set([
      ...turns.map((turn) => sessionKey(turn.trace_id)),
      ...toolCalls.map((call) => sessionKey(call.trace_id)),
      sessionKey(summary?.trace_id),
    ].filter((value): value is string => Boolean(value))));

    const connection = connectionId
      ? await db.prepare(
        `SELECT * FROM connections
         WHERE workspace_id = ?
           AND project_id = ?
           AND id = ?
         LIMIT 1`
      ).bind(tenant.workspace_id, tenant.project_id, connectionId).first<Connection>()
      : null;

    const spans: Span[] = [];
    for (const keys of chunk(traceIds)) {
      spans.push(...(await db.prepare(
        `SELECT * FROM spans
         WHERE workspace_id = ?
           AND project_id = ?
           AND trace_id IN (${placeholders(keys)})
         ORDER BY started_at ASC`
      ).bind(tenant.workspace_id, tenant.project_id, ...keys).all<Span>()).results);
    }
    spans.sort((a, b) => a.started_at.localeCompare(b.started_at));

    // Logs and events share a shape: rows keyed by trace or connection, ordered
    // by timestamp, capped at 500. A row can match both a trace chunk and the
    // connection lookup, so the union is deduped by id before the final cap.
    const telemetryLookups: Array<{ condition: string; bindings: unknown[] }> = [
      ...chunk(traceIds).map((keys) => ({
        condition: `trace_id IN (${placeholders(keys)})`,
        bindings: keys as unknown[],
      })),
      ...(connectionId ? [{ condition: "connection_id = ?", bindings: [connectionId] as unknown[] }] : []),
    ];
    const queryTelemetry = async <T extends { id: string; timestamp: string }>(table: "logs" | "events") => {
      const byId = new Map<string, T>();
      for (const lookup of telemetryLookups) {
        const rows = (await db.prepare(
          `SELECT * FROM ${table}
           WHERE workspace_id = ?
             AND project_id = ?
             AND (${lookup.condition})
           ORDER BY timestamp ASC
           LIMIT 500`
        ).bind(tenant.workspace_id, tenant.project_id, ...lookup.bindings).all<T>()).results;
        for (const row of rows) byId.set(row.id, row);
      }
      return Array.from(byId.values())
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, 500);
    };

    const logs = telemetryLookups.length === 0 ? [] : await queryTelemetry<LogRecord>("logs");
    const events = telemetryLookups.length === 0 ? [] : await queryTelemetry<Event>("events");

    const assignments = createTurnCorrelator(turns).assign(toolCalls, events);
    const turnsWithTelemetry = turns.map((turn) => ({
      turn,
      toolCalls: assignments.toolsFor(turn.id),
      events: assignments.eventsFor(turn.id),
    }));
    const timeline: SessionTimelineEntry[] = [
      ...turns.map((turn) => ({ type: "turn" as const, at: turn.started_at, item: turn })),
      ...toolCalls.map((call) => ({ type: "tool" as const, at: call.started_at, item: call })),
      ...spans.map((span) => ({ type: "span" as const, at: span.started_at, item: span })),
      ...logs.map((log) => ({ type: "log" as const, at: log.timestamp, item: log })),
      ...events.map((event) => ({ type: "event" as const, at: event.timestamp, item: event })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    return {
      summary,
      connection: connection ?? null,
      turns,
      toolCalls,
      spans,
      logs,
      events,
      turnsWithTelemetry,
      waterfallRows: buildWaterfall(turns),
      timeline,
    };
  });
}
