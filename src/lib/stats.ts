import { drizzle } from "drizzle-orm/d1";
import { count, sql, and, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";
import { connections, events, metrics } from "@/db/schema";
import { buildConnectionConditions } from "./facets";
import type { ActiveTag, TenantScope } from "@/types";
import { DEFAULT_TENANT_SCOPE } from "./tenant";

export interface DashboardStats {
  activeConnections: number;
  totalConnections: number;
  errorCount: number;
  errorRate: number;
  avgDuration: number;
  p50Latency: Record<string, number>;
  p95Latency: Record<string, number>;
  p99Latency: Record<string, number>;
  serviceBreakdown: { service: string; count: number; errors: number }[];
  typeBreakdown: { type: string; count: number }[];
  connectionsByDay: { day: string; count: number }[];
  messageRate: number;
}

export interface ConnectionStats {
  total: number;
  active: number;
  errorCount: number;
  errorRate: number;
  avgDuration: number;
  typeDistribution: { type: string; count: number }[];
  serviceDistribution: { service: string; count: number }[];
  connectionsByDay: { day: string; count: number }[];
}

interface LatencyPercentileRow {
  category: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

type TenantColumns = {
  workspace_id: AnyColumn;
  project_id: AnyColumn;
};

function tenantConditions(table: TenantColumns, tenant: TenantScope) {
  return [
    eq(table.workspace_id, tenant.workspace_id),
    eq(table.project_id, tenant.project_id),
  ];
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function queryDashboardStats(
  d1: D1Database,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<DashboardStats> {
  const db = drizzle(d1);
  const recentCutoff = daysAgoIso(14);
  const connectionWhere = and(...tenantConditions(connections, tenant));
  const eventWhere = and(...tenantConditions(events, tenant));
  const recentWhere = and(
    ...tenantConditions(connections, tenant),
    sql`${connections.started_at} > ${recentCutoff}`
  );

  // Voice stage percentiles from voice_turns — the canonical voice record.
  // The span-derived categories below only cover producers that name spans
  // `asr.*`/`llm.*`/`tts.*`; the documented voice ingest path reports TURNS,
  // and without this merge the dashboard's voice cards read "—" forever while
  // the data sits in voice_turns.
  const voicePercentiles = d1.prepare(
    `WITH stage_latency AS (
       SELECT category, ms FROM (
         SELECT 'asr' AS category, asr_latency_ms AS ms, started_at FROM voice_turns
           WHERE workspace_id = ?1 AND project_id = ?2 AND asr_latency_ms IS NOT NULL
           ORDER BY started_at DESC LIMIT 1000)
       UNION ALL
       SELECT category, ms FROM (
         SELECT 'llm' AS category, llm_latency_ms AS ms, started_at FROM voice_turns
           WHERE workspace_id = ?1 AND project_id = ?2 AND llm_latency_ms IS NOT NULL
           ORDER BY started_at DESC LIMIT 1000)
       UNION ALL
       SELECT category, ms FROM (
         SELECT 'tts' AS category, tts_latency_ms AS ms, started_at FROM voice_turns
           WHERE workspace_id = ?1 AND project_id = ?2 AND tts_latency_ms IS NOT NULL
           ORDER BY started_at DESC LIMIT 1000)
     ),
     ranked AS (
       SELECT category, ms,
         ROW_NUMBER() OVER (PARTITION BY category ORDER BY ms ASC) AS rn,
         COUNT(*) OVER (PARTITION BY category) AS total
       FROM stage_latency
     )
     SELECT category,
       MIN(CASE WHEN rn >= CAST(((total * 50) + 99) / 100 AS INTEGER) THEN ms END) AS p50,
       MIN(CASE WHEN rn >= CAST(((total * 95) + 99) / 100 AS INTEGER) THEN ms END) AS p95,
       MIN(CASE WHEN rn >= CAST(((total * 99) + 99) / 100 AS INTEGER) THEN ms END) AS p99
     FROM ranked
     GROUP BY category`
  ).bind(tenant.workspace_id, tenant.project_id).all<LatencyPercentileRow>();

  const latencyPercentiles = d1.prepare(
    `WITH span_latency AS (
       SELECT
         CASE
           WHEN instr(operation, '.') > 0 THEN substr(operation, 1, instr(operation, '.') - 1)
           ELSE operation
         END AS category,
         duration_ms
       FROM spans
       WHERE workspace_id = ?
         AND project_id = ?
         AND duration_ms IS NOT NULL
     ),
     ranked AS (
       SELECT
         category,
         duration_ms,
         ROW_NUMBER() OVER (PARTITION BY category ORDER BY duration_ms ASC) AS rn,
         COUNT(*) OVER (PARTITION BY category) AS total
       FROM span_latency
     )
     SELECT
       category,
       MIN(CASE WHEN rn >= CAST(((total * 50) + 99) / 100 AS INTEGER) THEN duration_ms END) AS p50,
       MIN(CASE WHEN rn >= CAST(((total * 95) + 99) / 100 AS INTEGER) THEN duration_ms END) AS p95,
       MIN(CASE WHEN rn >= CAST(((total * 99) + 99) / 100 AS INTEGER) THEN duration_ms END) AS p99
     FROM ranked
     GROUP BY category`
  ).bind(tenant.workspace_id, tenant.project_id).all<LatencyPercentileRow>();

  const [[connSummary], serviceRows, typeRows, volumeByDay, latencyRows, voiceLatencyRows, [eventCount]] = await Promise.all([
    db.select({
      total: count(),
      active: sql<number>`COUNT(CASE WHEN status = 'active' THEN 1 END)`,
      errors: sql<number>`COUNT(CASE WHEN status = 'error' THEN 1 END)`,
      avgDuration: sql<number>`CAST(COALESCE(AVG(duration_ms), 0) AS INTEGER)`,
    }).from(connections).where(connectionWhere),

    db.select({
      service: connections.service,
      count: count(),
      errors: sql<number>`COUNT(CASE WHEN status = 'error' THEN 1 END)`,
    }).from(connections).where(connectionWhere).groupBy(connections.service),

    db.select({
      type: connections.connection_type,
      count: count(),
    }).from(connections).where(connectionWhere).groupBy(connections.connection_type),

    db.select({
      day: sql<string>`strftime('%m/%d', started_at)`,
      count: count(),
    }).from(connections)
      .where(recentWhere)
      .groupBy(sql`strftime('%Y-%m-%d', started_at)`)
      .orderBy(sql`strftime('%Y-%m-%d', started_at)`),

    latencyPercentiles,

    voicePercentiles,

    db.select({ count: count() }).from(events).where(eventWhere),
  ]);

  const p50: Record<string, number> = {};
  const p95: Record<string, number> = {};
  const p99: Record<string, number> = {};
  for (const row of latencyRows.results) {
    p50[row.category] = Number(row.p50 ?? 0);
    p95[row.category] = Number(row.p95 ?? 0);
    p99[row.category] = Number(row.p99 ?? 0);
  }
  // voice_turns wins where both exist: it is per-turn truth, while a span
  // named `llm.generate` may be a coarser or duplicated view of the same call.
  for (const row of voiceLatencyRows.results) {
    if (row.p50 !== null) p50[row.category] = Number(row.p50);
    if (row.p95 !== null) p95[row.category] = Number(row.p95);
    if (row.p99 !== null) p99[row.category] = Number(row.p99);
  }

  const total = connSummary.total || 1;
  const errors = Number(connSummary.errors) || 0;

  return {
    activeConnections: Number(connSummary.active) || 0,
    totalConnections: connSummary.total,
    errorCount: errors,
    errorRate: (errors / total) * 100,
    avgDuration: Number(connSummary.avgDuration) || 0,
    p50Latency: p50,
    p95Latency: p95,
    p99Latency: p99,
    serviceBreakdown: serviceRows.map((r) => ({
      service: r.service,
      count: r.count,
      errors: Number(r.errors),
    })),
    typeBreakdown: typeRows.map((r) => ({ type: r.type, count: r.count })),
    connectionsByDay: volumeByDay,
    messageRate: eventCount.count,
  };
}

export async function queryConnectionStats(
  d1: D1Database,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<ConnectionStats> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(connections, tenant), ...buildConnectionConditions(activeTags)];
  const where = and(...conditions);

  const recentCutoff = daysAgoIso(14);
  const recentWhere = and(...conditions, sql`${connections.started_at} > ${recentCutoff}`);

  const [[summary], typeRows, serviceRows, volumeByDay] = await Promise.all([
    db.select({
      total: count(),
      active: sql<number>`COUNT(CASE WHEN status = 'active' THEN 1 END)`,
      errors: sql<number>`COUNT(CASE WHEN status = 'error' THEN 1 END)`,
      avgDuration: sql<number>`CAST(COALESCE(AVG(duration_ms), 0) AS INTEGER)`,
    }).from(connections).where(where),

    db.select({
      type: connections.connection_type,
      count: count(),
    }).from(connections).where(where).groupBy(connections.connection_type),

    db.select({
      service: connections.service,
      count: count(),
    }).from(connections).where(where).groupBy(connections.service),

    db.select({
      day: sql<string>`strftime('%m/%d', started_at)`,
      count: count(),
    }).from(connections)
      .where(recentWhere)
      .groupBy(sql`strftime('%Y-%m-%d', started_at)`)
      .orderBy(sql`strftime('%Y-%m-%d', started_at)`),
  ]);

  const total = summary.total || 1;
  const errors = Number(summary.errors) || 0;

  return {
    total: summary.total,
    active: Number(summary.active) || 0,
    errorCount: errors,
    errorRate: (errors / total) * 100,
    avgDuration: Number(summary.avgDuration) || 0,
    typeDistribution: typeRows,
    serviceDistribution: serviceRows,
    connectionsByDay: volumeByDay,
  };
}
