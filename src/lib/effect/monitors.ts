import { Effect } from "effect";
import type { TenantScope } from "@/types";
import { DatabaseError } from "./errors";

export type MonitorStatus = "ok" | "warn" | "alert" | "no_data";

export interface MonitorEvaluation {
  readonly monitor_id: string;
  readonly name: string;
  readonly status: MonitorStatus;
  readonly value: number | null;
  readonly threshold: number;
  readonly window_minutes: number;
  readonly description: string;
  readonly evaluated_at: string;
}

interface MonitorRule {
  readonly monitor_id: string;
  readonly name: string;
  readonly threshold: number;
  readonly window_minutes: number;
  readonly description: string;
  readonly evaluate: (db: D1Database, tenant: TenantScope, windowMinutes: number) => Effect.Effect<number | null, DatabaseError>;
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

function windowModifier(minutes: number) {
  return `-${minutes} minutes`;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function statusFor(value: number | null, threshold: number): MonitorStatus {
  if (value === null) return "no_data";
  if (value > threshold) return "alert";
  if (value >= threshold * 0.8) return "warn";
  return "ok";
}

function p95VoiceLatency(column: string) {
  return (db: D1Database, tenant: TenantScope, windowMinutes: number) => dbEffect(async () => {
    const result = await db.prepare(
      `SELECT ${column} AS value
       FROM voice_turns
       WHERE workspace_id = ?
         AND project_id = ?
         AND ${column} IS NOT NULL
         AND datetime(started_at) >= datetime('now', ?)`
    ).bind(tenant.workspace_id, tenant.project_id, windowModifier(windowMinutes)).all<{ value: number }>();

    return percentile(result.results.map((row) => Number(row.value)).filter(Number.isFinite), 95);
  });
}

function rate(
  table: "connections" | "voice_turns" | "agent_tool_calls",
  timestampColumn: "started_at",
  numeratorSql: string
) {
  return (db: D1Database, tenant: TenantScope, windowMinutes: number) => dbEffect(async () => {
    const row = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ${numeratorSql} THEN 1 ELSE 0 END) AS matching
       FROM ${table}
       WHERE workspace_id = ?
         AND project_id = ?
         AND datetime(${timestampColumn}) >= datetime('now', ?)`
    ).bind(tenant.workspace_id, tenant.project_id, windowModifier(windowMinutes)).first<{
      total: number;
      matching: number | null;
    }>();

    const total = Number(row?.total ?? 0);
    if (total === 0) return null;
    return ((Number(row?.matching ?? 0) / total) * 100);
  });
}

const REALTIME_MONITORS: readonly MonitorRule[] = [
  {
    monitor_id: "voice.asr_p95_latency_ms",
    name: "ASR p95 latency",
    threshold: 1200,
    window_minutes: 15,
    description: "Voice turns with ASR latency above 1.2s",
    evaluate: p95VoiceLatency("asr_latency_ms"),
  },
  {
    monitor_id: "voice.llm_p95_latency_ms",
    name: "LLM p95 latency",
    threshold: 3000,
    window_minutes: 15,
    description: "Voice turns with model response latency above 3s",
    evaluate: p95VoiceLatency("llm_latency_ms"),
  },
  {
    monitor_id: "voice.tts_p95_latency_ms",
    name: "TTS p95 latency",
    threshold: 1200,
    window_minutes: 15,
    description: "Voice turns with synthesis latency above 1.2s",
    evaluate: p95VoiceLatency("tts_latency_ms"),
  },
  {
    monitor_id: "voice.interruption_rate_pct",
    name: "Interruption rate",
    threshold: 10,
    window_minutes: 15,
    description: "Share of voice turns marked as interrupted",
    evaluate: rate("voice_turns", "started_at", "interruption = 1"),
  },
  {
    monitor_id: "agent.tool_error_rate_pct",
    name: "Agent tool error rate",
    threshold: 5,
    window_minutes: 15,
    description: "Share of agent tool calls ending outside ok status",
    evaluate: rate("agent_tool_calls", "started_at", "status != 'ok'"),
  },
  {
    monitor_id: "connection.error_rate_pct",
    name: "Connection error rate",
    threshold: 5,
    window_minutes: 15,
    description: "Share of realtime connections in error status",
    evaluate: rate("connections", "started_at", "status = 'error'"),
  },
];

export function evaluateRealtimeMonitors(
  db: D1Database,
  tenant: TenantScope,
  evaluatedAt = new Date().toISOString()
): Effect.Effect<MonitorEvaluation[], DatabaseError> {
  return Effect.forEach(REALTIME_MONITORS, (rule) => Effect.gen(function* () {
    const value = yield* rule.evaluate(db, tenant, rule.window_minutes);
    return {
      monitor_id: rule.monitor_id,
      name: rule.name,
      status: statusFor(value, rule.threshold),
      value,
      threshold: rule.threshold,
      window_minutes: rule.window_minutes,
      description: rule.description,
      evaluated_at: evaluatedAt,
    };
  }), { concurrency: 1 });
}

export function persistMonitorEvaluations(
  db: D1Database,
  tenant: TenantScope,
  evaluations: readonly MonitorEvaluation[]
): Effect.Effect<void, DatabaseError> {
  if (evaluations.length === 0) return Effect.void;

  return dbEffect(() => db.batch(evaluations.map((evaluation) => db.prepare(
    `INSERT INTO monitor_evaluations (
      id,
      workspace_id,
      project_id,
      monitor_id,
      name,
      status,
      value,
      threshold,
      window_minutes,
      description,
      evaluated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`
  ).bind(
    `${tenant.workspace_id}:${tenant.project_id}:${evaluation.monitor_id}:${evaluation.evaluated_at}`,
    tenant.workspace_id,
    tenant.project_id,
    evaluation.monitor_id,
    evaluation.name,
    evaluation.status,
    evaluation.value,
    evaluation.threshold,
    evaluation.window_minutes,
    evaluation.description,
    evaluation.evaluated_at
  )))).pipe(Effect.asVoid);
}

export function evaluateAndPersistRealtimeMonitors(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<MonitorEvaluation[], DatabaseError> {
  return Effect.gen(function* () {
    const evaluations = yield* evaluateRealtimeMonitors(db, tenant);
    yield* persistMonitorEvaluations(db, tenant, evaluations);
    return evaluations;
  });
}
