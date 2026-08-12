import { Effect } from "effect";
import type { SloDefinitionRecord, SloEvaluationRecord } from "@/db/schema";
import type { TenantScope } from "@/types";
import { DatabaseError, ValidationError } from "./errors";
import { resolveVoiceSloSource, type VoiceSloSource } from "./voice-slo";

export type SloDefinition = Omit<SloDefinitionRecord, "enabled"> & {
  readonly enabled: boolean;
};

export interface SloDefinitionInput {
  readonly id?: string;
  readonly name: string;
  readonly metric_name: string;
  readonly service?: string;
  readonly objective_percent: number;
  readonly threshold: number;
  readonly window_minutes: number;
  readonly enabled?: boolean;
}

export type SloEvaluation = SloEvaluationRecord;

export interface SloSummary {
  readonly definitions: readonly SloDefinition[];
  readonly evaluations: readonly SloEvaluation[];
}

const DEFAULT_SLOS: readonly Omit<
  SloDefinition,
  "workspace_id" | "project_id" | "created_at" | "updated_at"
>[] = [
  {
    id: "slo.voice_latency",
    name: "Voice latency under 1.5s",
    metric_name: "voice.latency_ms",
    service: null,
    objective_percent: 99,
    threshold: 1500,
    window_minutes: 1440,
    enabled: true,
  },
  // Voice presets computed straight from voice_turns / agent_tool_calls via
  // the reserved metric-name namespace in voice-slo.ts — no instrumentation
  // has to emit a separate metric for these to work.
  {
    id: "slo.voice_reply_audible",
    // "95% of turns audible within 1.5s" is the ratio framing of
    // "p95 release→audible reply under 1.5s".
    name: "Voice reply audible within 1.5s",
    metric_name: "voice.turns.audio_latency_ms",
    service: null,
    objective_percent: 95,
    threshold: 1500,
    window_minutes: 1440,
    enabled: true,
  },
  {
    id: "slo.voice_uninterrupted_turns",
    // interruption is a 0/1 flag; threshold 0 means a good event is an
    // uninterrupted turn, so objective 95% caps the interruption rate at 5%.
    name: "Voice turns without interruption",
    metric_name: "voice.turns.interruption",
    service: null,
    objective_percent: 95,
    threshold: 0,
    window_minutes: 1440,
    enabled: true,
  },
  {
    id: "slo.agent_tool_success",
    // Same flag framing over agent_tool_calls: objective 99% caps the tool
    // error rate at 1%.
    name: "Agent tool calls succeed",
    metric_name: "voice.tools.error",
    service: null,
    objective_percent: 99,
    threshold: 0,
    window_minutes: 1440,
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

function cleanString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function windowCutoffIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function definitionFromRow(row: SloDefinitionRecord): SloDefinition {
  return { ...row, enabled: Boolean(row.enabled) };
}

function evaluationFromRow(row: SloEvaluationRecord): SloEvaluation {
  return {
    ...row,
    attainment_percent: row.attainment_percent === null ? null : Number(row.attainment_percent),
    error_budget_remaining_percent: row.error_budget_remaining_percent === null
      ? null
      : Number(row.error_budget_remaining_percent),
    good_events: Number(row.good_events),
    total_events: Number(row.total_events),
  };
}

function validateInput(input: SloDefinitionInput): Effect.Effect<SloDefinitionInput, ValidationError> {
  return Effect.gen(function* () {
    if (!cleanString(input.name)) {
      return yield* Effect.fail(new ValidationError({ message: "SLO name is required" }));
    }
    if (!cleanString(input.metric_name)) {
      return yield* Effect.fail(new ValidationError({ message: "metric_name is required" }));
    }
    if (!Number.isFinite(input.objective_percent) || input.objective_percent <= 0 || input.objective_percent >= 100) {
      return yield* Effect.fail(new ValidationError({ message: "objective_percent must be greater than 0 and less than 100" }));
    }
    if (!Number.isFinite(input.threshold)) {
      return yield* Effect.fail(new ValidationError({ message: "threshold must be a finite number" }));
    }
    if (!Number.isInteger(input.window_minutes) || input.window_minutes < 1 || input.window_minutes > 43_200) {
      return yield* Effect.fail(new ValidationError({ message: "window_minutes must be an integer between 1 and 43200" }));
    }
    const metricName = cleanString(input.metric_name);
    if (metricName && resolveVoiceSloSource(metricName) && cleanString(input.service)) {
      // voice_turns / agent_tool_calls carry no service column, so a service
      // filter would be silently ignored — reject it instead.
      return yield* Effect.fail(new ValidationError({
        message: "service filter is not supported for voice objectives",
      }));
    }
    return input;
  });
}

export function ensureDefaultSloDefinitions(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<void, DatabaseError> {
  const timestamp = nowIso();
  return dbEffect(() => db.batch(DEFAULT_SLOS.map((definition) => db.prepare(
    `INSERT INTO slo_definitions (
      id,
      workspace_id,
      project_id,
      name,
      metric_name,
      service,
      objective_percent,
      threshold,
      window_minutes,
      enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, project_id, id) DO NOTHING`
  ).bind(
    definition.id,
    tenant.workspace_id,
    tenant.project_id,
    definition.name,
    definition.metric_name,
    definition.service,
    definition.objective_percent,
    definition.threshold,
    definition.window_minutes,
    definition.enabled ? 1 : 0,
    timestamp,
    timestamp
  )))).pipe(Effect.asVoid);
}

export function listSloDefinitions(
  db: D1Database,
  tenant: TenantScope,
  options: { includeDisabled?: boolean } = {}
): Effect.Effect<readonly SloDefinition[], DatabaseError> {
  return Effect.gen(function* () {
    yield* ensureDefaultSloDefinitions(db, tenant);
    const rows = yield* dbEffect(() => db.prepare(
      `SELECT *
       FROM slo_definitions
       WHERE workspace_id = ?
         AND project_id = ?
         ${options.includeDisabled ? "" : "AND enabled = 1"}
       ORDER BY name ASC`
    ).bind(tenant.workspace_id, tenant.project_id).all<SloDefinitionRecord>());

    return rows.results.map(definitionFromRow);
  });
}

export function createSloDefinition(
  db: D1Database,
  tenant: TenantScope,
  input: SloDefinitionInput
): Effect.Effect<SloDefinition, DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const valid = yield* validateInput(input);
    const timestamp = nowIso();
    const definition: SloDefinition = {
      id: cleanString(valid.id) ?? `slo.${cleanString(valid.metric_name) ?? "metric"}.${uuid()}`,
      workspace_id: tenant.workspace_id,
      project_id: tenant.project_id,
      name: cleanString(valid.name)!,
      metric_name: cleanString(valid.metric_name)!,
      service: cleanString(valid.service) ?? null,
      objective_percent: valid.objective_percent,
      threshold: valid.threshold,
      window_minutes: valid.window_minutes,
      enabled: valid.enabled ?? true,
      created_at: timestamp,
      updated_at: timestamp,
    };

    yield* dbEffect(() => db.prepare(
      `INSERT INTO slo_definitions (
        id,
        workspace_id,
        project_id,
        name,
        metric_name,
        service,
        objective_percent,
        threshold,
        window_minutes,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      definition.id,
      definition.workspace_id,
      definition.project_id,
      definition.name,
      definition.metric_name,
      definition.service,
      definition.objective_percent,
      definition.threshold,
      definition.window_minutes,
      definition.enabled ? 1 : 0,
      definition.created_at,
      definition.updated_at
    ).run());

    return definition;
  });
}

function evaluationFromCounts(
  tenant: TenantScope,
  definition: SloDefinition,
  evaluatedAt: string,
  row: { total: number; good: number | null } | null
): SloEvaluation {
  const total = Number(row?.total ?? 0);
  const good = Number(row?.good ?? 0);
  const attainment = total === 0 ? null : (good / total) * 100;
  const errorBudget = attainment === null
    ? null
    : ((attainment - definition.objective_percent) / (100 - definition.objective_percent)) * 100;

  return {
    id: `${tenant.workspace_id}:${tenant.project_id}:${definition.id}:${evaluatedAt}`,
    workspace_id: tenant.workspace_id,
    project_id: tenant.project_id,
    slo_id: definition.id,
    name: definition.name,
    objective_percent: definition.objective_percent,
    attainment_percent: attainment,
    error_budget_remaining_percent: errorBudget === null ? null : Math.max(0, Math.min(100, errorBudget)),
    good_events: good,
    total_events: total,
    window_minutes: definition.window_minutes,
    evaluated_at: evaluatedAt,
  };
}

function evaluateVoiceDefinition(
  db: D1Database,
  tenant: TenantScope,
  definition: SloDefinition,
  source: VoiceSloSource,
  evaluatedAt: string
): Effect.Effect<SloEvaluation, DatabaseError> {
  return dbEffect(async () => {
    // Every SQL fragment here comes from the hard-coded source registry;
    // threshold, tenant and window cutoff are bound parameters. The window
    // cutoff bounds the scan to the recent window (compound tenant+started_at
    // indexes back both tables).
    const row = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ${source.valueSql} <= ? THEN 1 ELSE 0 END) AS good
       FROM ${source.table}
       WHERE workspace_id = ?
         AND project_id = ?
         AND started_at >= ?
         ${source.eligibleSql ? `AND ${source.eligibleSql}` : ""}`
    ).bind(
      definition.threshold,
      tenant.workspace_id,
      tenant.project_id,
      windowCutoffIso(definition.window_minutes)
    ).first<{ total: number; good: number | null }>();

    return evaluationFromCounts(tenant, definition, evaluatedAt, row);
  });
}

function evaluateDefinition(
  db: D1Database,
  tenant: TenantScope,
  definition: SloDefinition,
  evaluatedAt: string
): Effect.Effect<SloEvaluation, DatabaseError> {
  const voiceSource = resolveVoiceSloSource(definition.metric_name);
  if (voiceSource) {
    return evaluateVoiceDefinition(db, tenant, definition, voiceSource, evaluatedAt);
  }

  return dbEffect(async () => {
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
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN value <= ? THEN 1 ELSE 0 END) AS good
       FROM metrics
       WHERE ${conditions.join(" AND ")}`
    ).bind(definition.threshold, ...bindings).first<{ total: number; good: number | null }>();

    return evaluationFromCounts(tenant, definition, evaluatedAt, row);
  });
}

export function evaluateSloDefinitions(
  db: D1Database,
  tenant: TenantScope,
  evaluatedAt = nowIso()
): Effect.Effect<readonly SloEvaluation[], DatabaseError> {
  return Effect.gen(function* () {
    const definitions = yield* listSloDefinitions(db, tenant);
    return yield* Effect.forEach(
      definitions,
      (definition) => evaluateDefinition(db, tenant, definition, evaluatedAt),
      { concurrency: 1 }
    );
  });
}

export function persistSloEvaluations(
  db: D1Database,
  evaluations: readonly SloEvaluation[]
): Effect.Effect<void, DatabaseError> {
  if (evaluations.length === 0) return Effect.void;

  return dbEffect(() => db.batch(evaluations.map((evaluation) => db.prepare(
    `INSERT INTO slo_evaluations (
      id,
      workspace_id,
      project_id,
      slo_id,
      name,
      objective_percent,
      attainment_percent,
      error_budget_remaining_percent,
      good_events,
      total_events,
      window_minutes,
      evaluated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`
  ).bind(
    evaluation.id,
    evaluation.workspace_id,
    evaluation.project_id,
    evaluation.slo_id,
    evaluation.name,
    evaluation.objective_percent,
    evaluation.attainment_percent,
    evaluation.error_budget_remaining_percent,
    evaluation.good_events,
    evaluation.total_events,
    evaluation.window_minutes,
    evaluation.evaluated_at
  )))).pipe(Effect.asVoid);
}

export function evaluateAndPersistSlos(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<SloSummary, DatabaseError> {
  return Effect.gen(function* () {
    const definitions = yield* listSloDefinitions(db, tenant, { includeDisabled: true });
    const evaluations = yield* evaluateSloDefinitions(db, tenant);
    yield* persistSloEvaluations(db, evaluations);
    return { definitions, evaluations };
  });
}
