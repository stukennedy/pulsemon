import { Effect } from "effect";
import type { AgentToolCall, Connection, Event, LogRecord, Span, VoiceTurn } from "@/db/schema";
import type { TenantScope } from "@/types";
import { DatabaseError } from "./errors";

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
}

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

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function sessionKey(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : null;
}

function summaryStatus(summary: VoiceSessionSummary) {
  if (summary.tool_error_count > 0) return "error";
  if (summary.interruption_count > 0) return "warn";
  return "ok";
}

export function voiceSessionStatus(summary: VoiceSessionSummary) {
  return summaryStatus(summary);
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
        AVG(asr_latency_ms) AS avg_asr_latency_ms,
        AVG(llm_latency_ms) AS avg_llm_latency_ms,
        AVG(tts_latency_ms) AS avg_tts_latency_ms,
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
    const toolRows = sessions.length === 0 ? [] : (await db.prepare(
      `SELECT
        session_id,
        COUNT(*) AS tool_call_count,
        SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS tool_error_count
       FROM agent_tool_calls
       WHERE workspace_id = ?
         AND project_id = ?
         AND session_id IN (${placeholders(sessions)})
       GROUP BY session_id`
    ).bind(tenant.workspace_id, tenant.project_id, ...sessions).all<{
      session_id: string;
      tool_call_count: number;
      tool_error_count: number | null;
    }>()).results;

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
    const [summaries, turnsResult, toolsResult] = await Promise.all([
      Effect.runPromise(queryVoiceSessionSummaries(db, tenant, 500)),
      db.prepare(
        `SELECT * FROM voice_turns
         WHERE workspace_id = ?
           AND project_id = ?
           AND session_id = ?
         ORDER BY started_at ASC, COALESCE(turn_index, 0) ASC`
      ).bind(tenant.workspace_id, tenant.project_id, sessionId).all<VoiceTurn>(),
      db.prepare(
        `SELECT * FROM agent_tool_calls
         WHERE workspace_id = ?
           AND project_id = ?
           AND session_id = ?
         ORDER BY started_at ASC`
      ).bind(tenant.workspace_id, tenant.project_id, sessionId).all<AgentToolCall>(),
    ]);

    const summary = summaries.find((item) => item.session_id === sessionId) ?? null;
    const turns = turnsResult.results;
    const toolCalls = toolsResult.results;
    const connectionId = sessionKey(summary?.connection_id) ?? sessionKey(turns[0]?.connection_id) ?? null;
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

    const spans = traceIds.length === 0 ? [] : (await db.prepare(
      `SELECT * FROM spans
       WHERE workspace_id = ?
         AND project_id = ?
         AND trace_id IN (${placeholders(traceIds)})
       ORDER BY started_at ASC`
    ).bind(tenant.workspace_id, tenant.project_id, ...traceIds).all<Span>()).results;

    const logs = traceIds.length === 0 && !connectionId ? [] : (await db.prepare(
      `SELECT * FROM logs
       WHERE workspace_id = ?
         AND project_id = ?
         AND (
           ${traceIds.length > 0 ? `trace_id IN (${placeholders(traceIds)})` : "0"}
           ${connectionId ? " OR connection_id = ?" : ""}
         )
       ORDER BY timestamp ASC
       LIMIT 500`
    ).bind(
      tenant.workspace_id,
      tenant.project_id,
      ...traceIds,
      ...(connectionId ? [connectionId] : [])
    ).all<LogRecord>()).results;

    const events = traceIds.length === 0 && !connectionId ? [] : (await db.prepare(
      `SELECT * FROM events
       WHERE workspace_id = ?
         AND project_id = ?
         AND (
           ${traceIds.length > 0 ? `trace_id IN (${placeholders(traceIds)})` : "0"}
           ${connectionId ? " OR connection_id = ?" : ""}
         )
       ORDER BY timestamp ASC
       LIMIT 500`
    ).bind(
      tenant.workspace_id,
      tenant.project_id,
      ...traceIds,
      ...(connectionId ? [connectionId] : [])
    ).all<Event>()).results;

    return {
      summary,
      connection: connection ?? null,
      turns,
      toolCalls,
      spans,
      logs,
      events,
    };
  });
}
