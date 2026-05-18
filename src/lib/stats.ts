import { drizzle } from "drizzle-orm/d1";
import { count, sql, and, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";
import { connections, spans, events, metrics } from "@/db/schema";
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
  const spanWhere = and(
    ...tenantConditions(spans, tenant),
    sql`${spans.duration_ms} IS NOT NULL`
  );
  const eventWhere = and(...tenantConditions(events, tenant));
  const recentWhere = and(
    ...tenantConditions(connections, tenant),
    sql`${connections.started_at} > ${recentCutoff}`
  );

  const [[connSummary], serviceRows, typeRows, volumeByDay, latencyRows, [eventCount]] = await Promise.all([
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

    // Latency percentiles per operation category
    db.select({
      operation: spans.operation,
      duration: spans.duration_ms,
    }).from(spans)
      .where(spanWhere)
      .orderBy(spans.operation, spans.duration_ms),

    db.select({ count: count() }).from(events).where(eventWhere),
  ]);

  // Calculate percentiles from latency rows
  const byOp = new Map<string, number[]>();
  for (const row of latencyRows) {
    const cat = row.operation.split(".")[0]; // asr, tts, llm
    const arr = byOp.get(cat) ?? [];
    arr.push(row.duration!);
    byOp.set(cat, arr);
  }

  const p50: Record<string, number> = {};
  const p95: Record<string, number> = {};
  const p99: Record<string, number> = {};
  for (const [op, durations] of byOp) {
    durations.sort((a, b) => a - b);
    p50[op] = durations[Math.floor(durations.length * 0.5)] ?? 0;
    p95[op] = durations[Math.floor(durations.length * 0.95)] ?? 0;
    p99[op] = durations[Math.floor(durations.length * 0.99)] ?? 0;
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
