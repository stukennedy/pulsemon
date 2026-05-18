import { Effect } from "effect";
import type { MonitorDefinitionRecord, MonitorEvaluationRecord } from "@/db/schema";
import type { TenantScope } from "@/types";
import { DatabaseError, NotFoundError, ValidationError } from "./errors";

export type MonitorStatus = "ok" | "warn" | "alert" | "no_data";

export type MonitorKind =
  | "voice_asr_p95_latency_ms"
  | "voice_llm_p95_latency_ms"
  | "voice_tts_p95_latency_ms"
  | "voice_interruption_rate_pct"
  | "agent_tool_error_rate_pct"
  | "connection_error_rate_pct"
  | "metric_avg";

export type MonitorDefinition = Omit<MonitorDefinitionRecord, "kind" | "enabled"> & {
  readonly kind: MonitorKind;
  readonly enabled: boolean;
};

export interface MonitorDefinitionInput {
  readonly id?: string;
  readonly name: string;
  readonly kind: MonitorKind;
  readonly metric_name?: string;
  readonly service?: string;
  readonly threshold: number;
  readonly window_minutes: number;
  readonly description?: string;
  readonly enabled?: boolean;
}

export interface MonitorDefinitionPatch {
  readonly name?: string;
  readonly kind?: MonitorKind;
  readonly metric_name?: string | null;
  readonly service?: string | null;
  readonly threshold?: number;
  readonly window_minutes?: number;
  readonly description?: string;
  readonly enabled?: boolean;
}

export type MonitorEvaluation = Omit<MonitorEvaluationRecord, "id" | "workspace_id" | "project_id" | "status"> & {
  readonly status: MonitorStatus;
};

const MONITOR_KINDS: readonly MonitorKind[] = [
  "voice_asr_p95_latency_ms",
  "voice_llm_p95_latency_ms",
  "voice_tts_p95_latency_ms",
  "voice_interruption_rate_pct",
  "agent_tool_error_rate_pct",
  "connection_error_rate_pct",
  "metric_avg",
];

const DEFAULT_MONITOR_DEFINITIONS: readonly Omit<
  MonitorDefinition,
  "workspace_id" | "project_id" | "created_at" | "updated_at"
>[] = [
  {
    id: "voice.asr_p95_latency_ms",
    name: "ASR p95 latency",
    kind: "voice_asr_p95_latency_ms",
    metric_name: null,
    service: null,
    threshold: 1200,
    window_minutes: 15,
    description: "Voice turns with ASR latency above 1.2s",
    enabled: true,
  },
  {
    id: "voice.llm_p95_latency_ms",
    name: "LLM p95 latency",
    kind: "voice_llm_p95_latency_ms",
    metric_name: null,
    service: null,
    threshold: 3000,
    window_minutes: 15,
    description: "Voice turns with model response latency above 3s",
    enabled: true,
  },
  {
    id: "voice.tts_p95_latency_ms",
    name: "TTS p95 latency",
    kind: "voice_tts_p95_latency_ms",
    metric_name: null,
    service: null,
    threshold: 1200,
    window_minutes: 15,
    description: "Voice turns with synthesis latency above 1.2s",
    enabled: true,
  },
  {
    id: "voice.interruption_rate_pct",
    name: "Interruption rate",
    kind: "voice_interruption_rate_pct",
    metric_name: null,
    service: null,
    threshold: 10,
    window_minutes: 15,
    description: "Share of voice turns marked as interrupted",
    enabled: true,
  },
  {
    id: "agent.tool_error_rate_pct",
    name: "Agent tool error rate",
    kind: "agent_tool_error_rate_pct",
    metric_name: null,
    service: null,
    threshold: 5,
    window_minutes: 15,
    description: "Share of agent tool calls ending outside ok status",
    enabled: true,
  },
  {
    id: "connection.error_rate_pct",
    name: "Connection error rate",
    kind: "connection_error_rate_pct",
    metric_name: null,
    service: null,
    threshold: 5,
    window_minutes: 15,
    description: "Share of realtime connections in error status",
    enabled: true,
  },
];

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function windowCutoffIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
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

function monitorFromRow(row: MonitorDefinitionRecord): MonitorDefinition {
  return {
    ...row,
    kind: parseMonitorKind(row.kind),
    enabled: Boolean(row.enabled),
  };
}

function parseMonitorKind(value: string): MonitorKind {
  return MONITOR_KINDS.includes(value as MonitorKind)
    ? value as MonitorKind
    : "metric_avg";
}

function cleanString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function validateMonitorInput(input: MonitorDefinitionInput): Effect.Effect<MonitorDefinitionInput, ValidationError> {
  return Effect.gen(function* () {
    if (!MONITOR_KINDS.includes(input.kind)) {
      return yield* Effect.fail(new ValidationError({ message: "Unsupported monitor kind" }));
    }
    if (!cleanString(input.name)) {
      return yield* Effect.fail(new ValidationError({ message: "Monitor name is required" }));
    }
    if (!Number.isFinite(input.threshold)) {
      return yield* Effect.fail(new ValidationError({ message: "threshold must be a finite number" }));
    }
    if (!Number.isInteger(input.window_minutes) || input.window_minutes < 1 || input.window_minutes > 1440) {
      return yield* Effect.fail(new ValidationError({ message: "window_minutes must be an integer between 1 and 1440" }));
    }
    if (input.kind === "metric_avg" && !cleanString(input.metric_name)) {
      return yield* Effect.fail(new ValidationError({ message: "metric_name is required for metric monitors" }));
    }
    return input;
  });
}

function p95VoiceLatency(column: string) {
  return (db: D1Database, tenant: TenantScope, windowMinutes: number) => dbEffect(async () => {
    const result = await db.prepare(
      `SELECT ${column} AS value
       FROM voice_turns
       WHERE workspace_id = ?
         AND project_id = ?
         AND ${column} IS NOT NULL
         AND started_at >= ?`
    ).bind(tenant.workspace_id, tenant.project_id, windowCutoffIso(windowMinutes)).all<{ value: number }>();

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
         AND ${timestampColumn} >= ?`
    ).bind(tenant.workspace_id, tenant.project_id, windowCutoffIso(windowMinutes)).first<{
      total: number;
      matching: number | null;
    }>();

    const total = Number(row?.total ?? 0);
    if (total === 0) return null;
    return ((Number(row?.matching ?? 0) / total) * 100);
  });
}

function metricAverage(definition: MonitorDefinition) {
  return (db: D1Database, tenant: TenantScope) => dbEffect(async () => {
    if (!definition.metric_name) return null;

    const conditions = [
      "workspace_id = ?",
      "project_id = ?",
      "metric_name = ?",
      "timestamp >= ?",
    ];
    const bindings: unknown[] = [
      tenant.workspace_id,
      tenant.project_id,
      definition.metric_name,
      windowCutoffIso(definition.window_minutes),
    ];
    if (definition.service) {
      conditions.push("service = ?");
      bindings.push(definition.service);
    }

    const row = await db.prepare(
      `SELECT AVG(value) AS value
       FROM metrics
       WHERE ${conditions.join(" AND ")}`
    ).bind(...bindings).first<{ value: number | null }>();

    const value = row?.value;
    return value === null || value === undefined ? null : Number(value);
  });
}

function evaluateDefinition(
  db: D1Database,
  tenant: TenantScope,
  definition: MonitorDefinition
): Effect.Effect<number | null, DatabaseError> {
  switch (definition.kind) {
    case "voice_asr_p95_latency_ms":
      return p95VoiceLatency("asr_latency_ms")(db, tenant, definition.window_minutes);
    case "voice_llm_p95_latency_ms":
      return p95VoiceLatency("llm_latency_ms")(db, tenant, definition.window_minutes);
    case "voice_tts_p95_latency_ms":
      return p95VoiceLatency("tts_latency_ms")(db, tenant, definition.window_minutes);
    case "voice_interruption_rate_pct":
      return rate("voice_turns", "started_at", "interruption = 1")(db, tenant, definition.window_minutes);
    case "agent_tool_error_rate_pct":
      return rate("agent_tool_calls", "started_at", "status != 'ok'")(db, tenant, definition.window_minutes);
    case "connection_error_rate_pct":
      return rate("connections", "started_at", "status = 'error'")(db, tenant, definition.window_minutes);
    case "metric_avg":
      return metricAverage(definition)(db, tenant);
  }
}

export function ensureDefaultMonitorDefinitions(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<void, DatabaseError> {
  const timestamp = nowIso();
  return dbEffect(() => db.batch(DEFAULT_MONITOR_DEFINITIONS.map((definition) => db.prepare(
    `INSERT INTO monitor_definitions (
      id,
      workspace_id,
      project_id,
      name,
      kind,
      metric_name,
      service,
      threshold,
      window_minutes,
      description,
      enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, project_id, id) DO NOTHING`
  ).bind(
    definition.id,
    tenant.workspace_id,
    tenant.project_id,
    definition.name,
    definition.kind,
    definition.metric_name,
    definition.service,
    definition.threshold,
    definition.window_minutes,
    definition.description,
    definition.enabled ? 1 : 0,
    timestamp,
    timestamp
  )))).pipe(Effect.asVoid);
}

export function listMonitorDefinitions(
  db: D1Database,
  tenant: TenantScope,
  options: { includeDisabled?: boolean } = {}
): Effect.Effect<MonitorDefinition[], DatabaseError> {
  return Effect.gen(function* () {
    yield* ensureDefaultMonitorDefinitions(db, tenant);
    const rows = yield* dbEffect(() => db.prepare(
      `SELECT *
       FROM monitor_definitions
       WHERE workspace_id = ?
         AND project_id = ?
         ${options.includeDisabled ? "" : "AND enabled = 1"}
       ORDER BY id ASC`
    ).bind(tenant.workspace_id, tenant.project_id).all<MonitorDefinitionRecord>());

    return rows.results.map(monitorFromRow);
  });
}

export function createMonitorDefinition(
  db: D1Database,
  tenant: TenantScope,
  input: MonitorDefinitionInput
): Effect.Effect<MonitorDefinition, DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const valid = yield* validateMonitorInput(input);
    const timestamp = nowIso();
    const id = cleanString(valid.id) ?? `metric.${cleanString(valid.metric_name) ?? uuid()}.${uuid()}`;
    const description = cleanString(valid.description) ?? (
      valid.kind === "metric_avg"
        ? `Average ${valid.metric_name} above ${valid.threshold}`
        : valid.name
    );

    const definition: MonitorDefinition = {
      id,
      workspace_id: tenant.workspace_id,
      project_id: tenant.project_id,
      name: cleanString(valid.name)!,
      kind: valid.kind,
      metric_name: cleanString(valid.metric_name) ?? null,
      service: cleanString(valid.service) ?? null,
      threshold: valid.threshold,
      window_minutes: valid.window_minutes,
      description,
      enabled: valid.enabled ?? true,
      created_at: timestamp,
      updated_at: timestamp,
    };

    yield* dbEffect(() => db.prepare(
      `INSERT INTO monitor_definitions (
        id,
        workspace_id,
        project_id,
        name,
        kind,
        metric_name,
        service,
        threshold,
        window_minutes,
        description,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      definition.id,
      definition.workspace_id,
      definition.project_id,
      definition.name,
      definition.kind,
      definition.metric_name,
      definition.service,
      definition.threshold,
      definition.window_minutes,
      definition.description,
      definition.enabled ? 1 : 0,
      definition.created_at,
      definition.updated_at
    ).run());

    return definition;
  });
}

export function updateMonitorDefinition(
  db: D1Database,
  tenant: TenantScope,
  id: string,
  patch: MonitorDefinitionPatch
): Effect.Effect<MonitorDefinition, DatabaseError | ValidationError | NotFoundError> {
  return Effect.gen(function* () {
    const current = yield* dbEffect(() => db.prepare(
      `SELECT *
       FROM monitor_definitions
       WHERE id = ?
         AND workspace_id = ?
         AND project_id = ?`
    ).bind(id, tenant.workspace_id, tenant.project_id).first<MonitorDefinitionRecord>());

    if (!current) {
      return yield* Effect.fail(new NotFoundError({ message: "Monitor definition not found" }));
    }

    const merged: MonitorDefinitionInput = {
      id,
      name: patch.name ?? current.name,
      kind: patch.kind ?? parseMonitorKind(current.kind),
      metric_name: patch.metric_name === undefined ? current.metric_name ?? undefined : patch.metric_name ?? undefined,
      service: patch.service === undefined ? current.service ?? undefined : patch.service ?? undefined,
      threshold: patch.threshold ?? current.threshold,
      window_minutes: patch.window_minutes ?? current.window_minutes,
      description: patch.description ?? current.description,
      enabled: patch.enabled ?? Boolean(current.enabled),
    };
    yield* validateMonitorInput(merged);

    const updatedAt = nowIso();
    yield* dbEffect(() => db.prepare(
      `UPDATE monitor_definitions
       SET name = ?,
           kind = ?,
           metric_name = ?,
           service = ?,
           threshold = ?,
           window_minutes = ?,
           description = ?,
           enabled = ?,
           updated_at = ?
       WHERE id = ?
         AND workspace_id = ?
         AND project_id = ?`
    ).bind(
      cleanString(merged.name)!,
      merged.kind,
      cleanString(merged.metric_name) ?? null,
      cleanString(merged.service) ?? null,
      merged.threshold,
      merged.window_minutes,
      cleanString(merged.description) ?? merged.name,
      merged.enabled ? 1 : 0,
      updatedAt,
      id,
      tenant.workspace_id,
      tenant.project_id
    ).run());

    const row = yield* dbEffect(() => db.prepare(
      `SELECT *
       FROM monitor_definitions
       WHERE id = ?
         AND workspace_id = ?
         AND project_id = ?`
    ).bind(id, tenant.workspace_id, tenant.project_id).first<MonitorDefinitionRecord>());

    if (!row) {
      return yield* Effect.fail(new NotFoundError({ message: "Monitor definition not found" }));
    }
    return monitorFromRow(row);
  });
}

export function deleteMonitorDefinition(
  db: D1Database,
  tenant: TenantScope,
  id: string
): Effect.Effect<{ id: string }, DatabaseError | NotFoundError> {
  return Effect.gen(function* () {
    const result = yield* dbEffect(() => db.prepare(
      `DELETE FROM monitor_definitions
       WHERE id = ?
         AND workspace_id = ?
         AND project_id = ?`
    ).bind(id, tenant.workspace_id, tenant.project_id).run());

    if ((result.meta as { changes?: number }).changes === 0) {
      return yield* Effect.fail(new NotFoundError({ message: "Monitor definition not found" }));
    }

    return { id };
  });
}

export function evaluateRealtimeMonitors(
  db: D1Database,
  tenant: TenantScope,
  evaluatedAt = new Date().toISOString()
): Effect.Effect<MonitorEvaluation[], DatabaseError> {
  return Effect.gen(function* () {
    const definitions = yield* listMonitorDefinitions(db, tenant);
    return yield* Effect.forEach(definitions, (definition) => Effect.gen(function* () {
      const value = yield* evaluateDefinition(db, tenant, definition);
      return {
        monitor_id: definition.id,
        name: definition.name,
        status: statusFor(value, definition.threshold),
        value,
        threshold: definition.threshold,
        window_minutes: definition.window_minutes,
        description: definition.description,
        evaluated_at: evaluatedAt,
      };
    }), { concurrency: 1 });
  });
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
