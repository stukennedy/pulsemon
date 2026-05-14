import { Effect } from "effect";
import type { TenantScope } from "@/types";
import { DatabaseError, ValidationError } from "./errors";

export interface MetricSeriesParams {
  readonly service?: string;
  readonly metric_name?: string;
  readonly metric_type?: string;
  readonly minutes?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface MetricSeriesPoint {
  readonly bucket_start: string;
  readonly count: number;
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly sum: number;
}

export interface MetricSeriesResult {
  readonly source: "raw" | "rollup";
  readonly from: string;
  readonly to: string;
  readonly points: MetricSeriesPoint[];
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

function parseDate(name: string, value: string | undefined): Effect.Effect<Date | null, ValidationError> {
  if (!value) return Effect.succeed(null);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Effect.fail(new ValidationError({ message: `${name} must be an ISO timestamp` }));
  }
  return Effect.succeed(date);
}

function normalizeMinutes(value: number | undefined): Effect.Effect<number, ValidationError> {
  const minutes = value ?? 60;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) {
    return Effect.fail(new ValidationError({ message: "minutes must be an integer between 1 and 43200" }));
  }
  return Effect.succeed(minutes);
}

function iso(date: Date) {
  return date.toISOString();
}

function filters(params: MetricSeriesParams) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.service) {
    conditions.push("service = ?");
    bindings.push(params.service);
  }
  if (params.metric_name) {
    conditions.push("metric_name = ?");
    bindings.push(params.metric_name);
  }
  if (params.metric_type) {
    conditions.push("metric_type = ?");
    bindings.push(params.metric_type);
  }

  return { conditions, bindings };
}

function shouldUseRollups(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / 60000 > 360;
}

export function queryMetricSeries(
  db: D1Database,
  tenant: TenantScope,
  params: MetricSeriesParams = {}
): Effect.Effect<MetricSeriesResult, DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const minutes = yield* normalizeMinutes(params.minutes);
    const explicitTo = yield* parseDate("to", params.to);
    const explicitFrom = yield* parseDate("from", params.from);
    const to = explicitTo ?? new Date();
    const from = explicitFrom ?? new Date(to.getTime() - minutes * 60_000);

    if (from.getTime() >= to.getTime()) {
      return yield* Effect.fail(new ValidationError({ message: "from must be before to" }));
    }

    const source = shouldUseRollups(from, to) ? "rollup" as const : "raw" as const;
    const extra = filters(params);
    const timeColumn = source === "rollup" ? "bucket_start" : "timestamp";
    const where = [
      "workspace_id = ?",
      "project_id = ?",
      `datetime(${timeColumn}) >= datetime(?)`,
      `datetime(${timeColumn}) <= datetime(?)`,
      ...extra.conditions,
    ].join(" AND ");

    const rows = yield* dbEffect(() => {
      if (source === "rollup") {
        return db.prepare(
          `SELECT
            bucket_start,
            SUM(count) AS count,
            COALESCE(SUM(avg * count) / NULLIF(SUM(count), 0), 0) AS avg,
            COALESCE(MIN(min), 0) AS min,
            COALESCE(MAX(max), 0) AS max,
            COALESCE(SUM(sum), 0) AS sum
           FROM metric_rollups_1m
           WHERE ${where}
           GROUP BY bucket_start
           ORDER BY bucket_start ASC`
        ).bind(tenant.workspace_id, tenant.project_id, iso(from), iso(to), ...extra.bindings).all<MetricSeriesPoint>();
      }

      return db.prepare(
        `SELECT
          strftime('%Y-%m-%dT%H:%M:00.000Z', datetime(timestamp)) AS bucket_start,
          COUNT(*) AS count,
          COALESCE(AVG(value), 0) AS avg,
          COALESCE(MIN(value), 0) AS min,
          COALESCE(MAX(value), 0) AS max,
          COALESCE(SUM(value), 0) AS sum
         FROM metrics
         WHERE ${where}
         GROUP BY bucket_start
         ORDER BY bucket_start ASC`
      ).bind(tenant.workspace_id, tenant.project_id, iso(from), iso(to), ...extra.bindings).all<MetricSeriesPoint>();
    });

    return {
      source,
      from: iso(from),
      to: iso(to),
      points: rows.results.map((row) => ({
        bucket_start: row.bucket_start,
        count: Number(row.count),
        avg: Number(row.avg),
        min: Number(row.min),
        max: Number(row.max),
        sum: Number(row.sum),
      })),
    };
  });
}
