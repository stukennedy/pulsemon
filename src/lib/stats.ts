import { drizzle } from "drizzle-orm/d1";
import { count, sql, and } from "drizzle-orm";
import { connections, spans, events, metrics } from "@/db/schema";
import { buildConnectionConditions } from "./facets";
import type { ActiveTag } from "@/types";

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

export async function queryDashboardStats(d1: D1Database): Promise<DashboardStats> {
  const db = drizzle(d1);

  const [[connSummary], serviceRows, typeRows, volumeByDay, latencyRows, [eventCount]] = await Promise.all([
    db.select({
      total: count(),
      active: sql<number>`COUNT(CASE WHEN status = 'active' THEN 1 END)`,
      errors: sql<number>`COUNT(CASE WHEN status = 'error' THEN 1 END)`,
      avgDuration: sql<number>`CAST(COALESCE(AVG(duration_ms), 0) AS INTEGER)`,
    }).from(connections),

    db.select({
      service: connections.service,
      count: count(),
      errors: sql<number>`COUNT(CASE WHEN status = 'error' THEN 1 END)`,
    }).from(connections).groupBy(connections.service),

    db.select({
      type: connections.connection_type,
      count: count(),
    }).from(connections).groupBy(connections.connection_type),

    db.select({
      day: sql<string>`strftime('%m/%d', started_at)`,
      count: count(),
    }).from(connections)
      .where(sql`started_at > datetime('now', '-14 days')`)
      .groupBy(sql`strftime('%Y-%m-%d', started_at)`)
      .orderBy(sql`strftime('%Y-%m-%d', started_at)`),

    // Latency percentiles per operation category
    db.select({
      operation: spans.operation,
      duration: spans.duration_ms,
    }).from(spans)
      .where(sql`${spans.duration_ms} IS NOT NULL`)
      .orderBy(spans.operation, spans.duration_ms),

    db.select({ count: count() }).from(events),
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
  activeTags: ActiveTag[]
): Promise<ConnectionStats> {
  const db = drizzle(d1);
  const conditions = buildConnectionConditions(activeTags);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const recentWhere = conditions.length > 0
    ? and(...conditions, sql`started_at > datetime('now', '-14 days')`)
    : sql`started_at > datetime('now', '-14 days')`;

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
