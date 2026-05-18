import { Effect } from "effect";
import type { Env } from "@/types";
import { DatabaseError, ValidationError } from "./errors";

export interface MaintenanceConfig {
  readonly retentionDays: number;
  readonly metricRollupAfterMinutes: number;
  readonly metricRollupRetentionDays: number;
  readonly deleteChunkSize: number;
  readonly deleteMaxChunksPerTable: number;
}

export interface MaintenanceResult {
  readonly rollups: number;
  readonly deleted: {
    readonly connections: number;
    readonly spans: number;
    readonly events: number;
    readonly metrics: number;
    readonly logs: number;
    readonly voice_turns: number;
    readonly agent_tool_calls: number;
    readonly metric_rollups_1m: number;
    readonly ingest_rate_limits: number;
  };
}

type MaintenanceEnv = Pick<
  Env,
  "RETENTION_DAYS" | "METRIC_ROLLUP_AFTER_MINUTES" | "METRIC_ROLLUP_RETENTION_DAYS"
> & {
  readonly MAINTENANCE_DELETE_CHUNK_SIZE?: string;
  readonly MAINTENANCE_DELETE_MAX_CHUNKS_PER_TABLE?: string;
};

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function changes(result: D1Result<unknown>) {
  return Number(result.meta?.changes ?? 0);
}

function integerConfig(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): Effect.Effect<number, ValidationError> {
  if (value === undefined || value.trim() === "") return Effect.succeed(fallback);

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return Effect.fail(new ValidationError({
      message: `${name} must be an integer between ${min} and ${max}`,
    }));
  }

  return Effect.succeed(parsed);
}

export function maintenanceConfigFromEnv(env: MaintenanceEnv): Effect.Effect<MaintenanceConfig, ValidationError> {
  return Effect.gen(function* () {
    const retentionDays = yield* integerConfig("RETENTION_DAYS", env.RETENTION_DAYS, 30, 1, 3650);
    const metricRollupAfterMinutes = yield* integerConfig(
      "METRIC_ROLLUP_AFTER_MINUTES",
      env.METRIC_ROLLUP_AFTER_MINUTES,
      5,
      0,
      1440
    );
    const metricRollupRetentionDays = yield* integerConfig(
      "METRIC_ROLLUP_RETENTION_DAYS",
      env.METRIC_ROLLUP_RETENTION_DAYS,
      365,
      1,
      3650
    );
    const deleteChunkSize = yield* integerConfig(
      "MAINTENANCE_DELETE_CHUNK_SIZE",
      env.MAINTENANCE_DELETE_CHUNK_SIZE,
      500,
      1,
      5000
    );
    const deleteMaxChunksPerTable = yield* integerConfig(
      "MAINTENANCE_DELETE_MAX_CHUNKS_PER_TABLE",
      env.MAINTENANCE_DELETE_MAX_CHUNKS_PER_TABLE,
      20,
      1,
      100
    );

    return {
      retentionDays,
      metricRollupAfterMinutes,
      metricRollupRetentionDays,
      deleteChunkSize,
      deleteMaxChunksPerTable,
    };
  });
}

function runStatement(db: D1Database, sql: string, ...bindings: unknown[]): Effect.Effect<number, DatabaseError> {
  return dbEffect(async () => changes(await db.prepare(sql).bind(...bindings).run()));
}

function agoIso(amount: number, unitMs: number) {
  return new Date(Date.now() - amount * unitMs).toISOString();
}

function daysAgoIso(days: number) {
  return agoIso(days, 24 * 60 * 60 * 1000);
}

function minutesAgoIso(minutes: number) {
  return agoIso(minutes, 60 * 1000);
}

function deleteOlderThan(
  db: D1Database,
  table: string,
  timestampColumn: string,
  cutoff: string,
  config: Pick<MaintenanceConfig, "deleteChunkSize" | "deleteMaxChunksPerTable">
): Effect.Effect<number, DatabaseError> {
  return Effect.gen(function* () {
    let totalDeleted = 0;
    for (let chunk = 0; chunk < config.deleteMaxChunksPerTable; chunk++) {
      const deleted = yield* runStatement(
        db,
        `DELETE FROM ${table}
         WHERE rowid IN (
           SELECT rowid FROM ${table}
           WHERE ${timestampColumn} < ?
           ORDER BY ${timestampColumn} ASC
           LIMIT ?
         )`,
        cutoff,
        config.deleteChunkSize
      );
      totalDeleted += deleted;
      if (deleted < config.deleteChunkSize) break;
    }
    return totalDeleted;
  });
}

export function runMaintenance(
  db: D1Database,
  config: MaintenanceConfig
): Effect.Effect<MaintenanceResult, DatabaseError> {
  return Effect.gen(function* () {
    const rollupCutoff = minutesAgoIso(config.metricRollupAfterMinutes);
    const retentionCutoff = daysAgoIso(config.retentionDays);
    const rollupRetentionCutoff = daysAgoIso(config.metricRollupRetentionDays);
    const rateLimitCutoff = daysAgoIso(1);

    const rollups = yield* runStatement(
      db,
      `INSERT INTO metric_rollups_1m (
        id,
        workspace_id,
        project_id,
        service,
        metric_name,
        metric_type,
        bucket_start,
        count,
        avg,
        min,
        max,
        sum
      )
      SELECT
        workspace_id || ':' || project_id || ':' || service || ':' || metric_name || ':' || metric_type || ':' || strftime('%Y-%m-%dT%H:%M:00.000Z', datetime(timestamp)) AS id,
        workspace_id,
        project_id,
        service,
        metric_name,
        metric_type,
        strftime('%Y-%m-%dT%H:%M:00.000Z', datetime(timestamp)) AS bucket_start,
        COUNT(*) AS count,
        COALESCE(AVG(value), 0) AS avg,
        COALESCE(MIN(value), 0) AS min,
        COALESCE(MAX(value), 0) AS max,
        COALESCE(SUM(value), 0) AS sum
      FROM metrics
      WHERE timestamp < ?
      GROUP BY workspace_id, project_id, service, metric_name, metric_type, bucket_start
      ON CONFLICT(workspace_id, project_id, service, metric_name, metric_type, bucket_start) DO UPDATE SET
        count = excluded.count,
        avg = excluded.avg,
        min = excluded.min,
        max = excluded.max,
        sum = excluded.sum`,
      rollupCutoff
    );

    const [
      connections,
      spans,
      events,
      metrics,
      logs,
      voiceTurns,
      agentToolCalls,
      metricRollups,
      ingestRateLimits,
    ] = yield* Effect.all([
      deleteOlderThan(db, "connections", "started_at", retentionCutoff, config),
      deleteOlderThan(db, "spans", "started_at", retentionCutoff, config),
      deleteOlderThan(db, "events", "timestamp", retentionCutoff, config),
      deleteOlderThan(db, "metrics", "timestamp", retentionCutoff, config),
      deleteOlderThan(db, "logs", "timestamp", retentionCutoff, config),
      deleteOlderThan(db, "voice_turns", "started_at", retentionCutoff, config),
      deleteOlderThan(db, "agent_tool_calls", "started_at", retentionCutoff, config),
      deleteOlderThan(db, "metric_rollups_1m", "bucket_start", rollupRetentionCutoff, config),
      deleteOlderThan(db, "ingest_rate_limits", "window_start", rateLimitCutoff, config),
    ], { concurrency: 1 });

    return {
      rollups,
      deleted: {
        connections,
        spans,
        events,
        metrics,
        logs,
        voice_turns: voiceTurns,
        agent_tool_calls: agentToolCalls,
        metric_rollups_1m: metricRollups,
        ingest_rate_limits: ingestRateLimits,
      },
    };
  });
}

export function runMaintenanceFromEnv(
  env: Pick<Env, "DB"> & MaintenanceEnv
): Effect.Effect<MaintenanceResult, DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const config = yield* maintenanceConfigFromEnv(env);
    return yield* runMaintenance(env.DB, config);
  });
}
