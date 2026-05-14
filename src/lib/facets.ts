import { drizzle } from "drizzle-orm/d1";
import { asc, desc, count, sql, and, or, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";
import { connections, spans, events, logs, metrics } from "@/db/schema";
import type { Connection, Span, Event, LogRecord, Metric } from "@/db/schema";
import type { ActiveTag, TenantScope } from "@/types";
import { DEFAULT_TENANT_SCOPE } from "./tenant";

type FacetDefinition = {
  name: string;
  field: string;
  col: AnyColumn;
};

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

// Connection facets
export const CONNECTION_FACETS = [
  { name: "service", field: "service", col: connections.service },
  { name: "type", field: "connection_type", col: connections.connection_type },
  { name: "status", field: "status", col: connections.status },
  { name: "client", field: "client_id", col: connections.client_id },
  { name: "session", field: "session_id", col: connections.session_id },
];

// Span facets
export const SPAN_FACETS = [
  { name: "service", field: "service", col: spans.service },
  { name: "operation", field: "operation", col: spans.operation },
  { name: "status", field: "status", col: spans.status },
  { name: "trace", field: "trace_id", col: spans.trace_id },
];

export const LOG_FACETS = [
  { name: "service", field: "service", col: logs.service },
  { name: "level", field: "level", col: logs.level },
  { name: "trace", field: "trace_id", col: logs.trace_id },
  { name: "span", field: "span_id", col: logs.span_id },
  { name: "connection", field: "connection_id", col: logs.connection_id },
];

export const METRIC_FACETS = [
  { name: "service", field: "service", col: metrics.service },
  { name: "name", field: "metric_name", col: metrics.metric_name },
  { name: "type", field: "metric_type", col: metrics.metric_type },
];

export const CONNECTION_FACET_NAMES = CONNECTION_FACETS.map((f) => f.name);
export const SPAN_FACET_NAMES = SPAN_FACETS.map((f) => f.name);
export const LOG_FACET_NAMES = LOG_FACETS.map((f) => f.name);
export const METRIC_FACET_NAMES = METRIC_FACETS.map((f) => f.name);

function buildConditions(activeTags: ActiveTag[], facets: readonly FacetDefinition[]) {
  const byFacet = new Map<string, ActiveTag[]>();
  for (const tag of activeTags) {
    const group = byFacet.get(tag.facet) ?? [];
    byFacet.set(tag.facet, [...group, tag]);
  }

  return Array.from(byFacet.values()).flatMap((tags) => {
    const conds = tags
      .map((tag) => {
        const f = facets.find((x) => x.name === tag.facet);
        if (!f) return null;

        // Duration ranges
        if (tag.facet === "duration") {
          if (tag.value === "fast") return sql`duration_ms < 500`;
          if (tag.value === "normal") return sql`duration_ms >= 500 AND duration_ms < 2000`;
          if (tag.value === "slow") return sql`duration_ms >= 2000`;
          return null;
        }

        return sql`CAST(${f.col} AS TEXT) = ${tag.value}`;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (conds.length === 0) return [];
    if (conds.length === 1) return [conds[0]];
    return [or(...conds)!];
  });
}

export function buildConnectionConditions(tags: ActiveTag[]) {
  return buildConditions(tags, CONNECTION_FACETS);
}

export function buildSpanConditions(tags: ActiveTag[]) {
  return buildConditions(tags, SPAN_FACETS);
}

export function buildLogConditions(tags: ActiveTag[]) {
  return buildConditions(tags, LOG_FACETS);
}

export function buildMetricConditions(tags: ActiveTag[]) {
  return buildConditions(tags, METRIC_FACETS);
}

export async function getConnectionFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<string[]> {
  const f = CONNECTION_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = [...tenantConditions(connections, tenant), ...buildConnectionConditions(activeTags)];

  if (prefix) {
    conditions.push(sql`CAST(${f.col} AS TEXT) LIKE ${"%" + prefix + "%"}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .selectDistinct({ val: sql<string>`CAST(${f.col} AS TEXT)` })
    .from(connections)
    .where(where)
    .orderBy(asc(sql`CAST(${f.col} AS TEXT)`))
    .limit(50);

  return result.map((r) => r.val).filter(Boolean);
}

export async function queryConnections(
  d1: D1Database,
  activeTags: ActiveTag[],
  limit = 100,
  offset = 0,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<{ connections: Connection[]; total: number }> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(connections, tenant), ...buildConnectionConditions(activeTags)];
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: count() })
    .from(connections)
    .where(where);

  const rows = await db
    .select()
    .from(connections)
    .where(where)
    .orderBy(desc(connections.started_at))
    .limit(limit)
    .offset(offset);

  return { connections: rows, total };
}

export async function getConnectionDetail(
  d1: D1Database,
  connectionId: string,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<{ connection: Connection | null; events: Event[]; spans: Span[] }> {
  const db = drizzle(d1);

  const connectionWhere = and(
    eq(connections.id, connectionId),
    ...tenantConditions(connections, tenant)
  );
  const [conn] = await db.select().from(connections).where(connectionWhere).limit(1);

  const connEvents = conn
    ? await db.select().from(events).where(and(
      eq(events.connection_id, connectionId),
      ...tenantConditions(events, tenant)
    )).orderBy(asc(events.timestamp))
    : [];

  const connSpans = conn
    ? await db.select().from(spans).where(and(
      eq(spans.connection_id, connectionId),
      ...tenantConditions(spans, tenant)
    )).orderBy(asc(spans.started_at))
    : [];

  return { connection: conn || null, events: connEvents, spans: connSpans };
}

export async function querySpans(
  d1: D1Database,
  activeTags: ActiveTag[],
  limit = 100,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<{ spans: Span[]; total: number }> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(spans, tenant), ...buildSpanConditions(activeTags)];
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(spans).where(where);

  const rows = await db
    .select()
    .from(spans)
    .where(where)
    .orderBy(desc(spans.started_at))
    .limit(limit);

  return { spans: rows, total };
}

export async function queryLogs(
  d1: D1Database,
  activeTags: ActiveTag[],
  limit = 100,
  offset = 0,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<{ logs: LogRecord[]; total: number }> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(logs, tenant), ...buildLogConditions(activeTags)];
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(logs).where(where);

  const rows = await db
    .select()
    .from(logs)
    .where(where)
    .orderBy(desc(logs.timestamp))
    .limit(limit)
    .offset(offset);

  return { logs: rows, total };
}

export async function queryMetrics(
  d1: D1Database,
  activeTags: ActiveTag[],
  limit = 100,
  offset = 0,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<{ metrics: Metric[]; total: number }> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(metrics, tenant), ...buildMetricConditions(activeTags)];
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(metrics).where(where);

  const rows = await db
    .select()
    .from(metrics)
    .where(where)
    .orderBy(desc(metrics.timestamp))
    .limit(limit)
    .offset(offset);

  return { metrics: rows, total };
}

export interface MetricSummary {
  service: string;
  metric_name: string;
  metric_type: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  latest: number;
  latest_timestamp: string;
}

export async function queryMetricSummaries(
  d1: D1Database,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<MetricSummary[]> {
  const db = drizzle(d1);
  const conditions = [...tenantConditions(metrics, tenant), ...buildMetricConditions(activeTags)];
  const where = and(...conditions);

  return db
    .select({
      service: metrics.service,
      metric_name: metrics.metric_name,
      metric_type: metrics.metric_type,
      count: count(),
      avg: sql<number>`COALESCE(AVG(${metrics.value}), 0)`,
      min: sql<number>`COALESCE(MIN(${metrics.value}), 0)`,
      max: sql<number>`COALESCE(MAX(${metrics.value}), 0)`,
      latest: sql<number>`COALESCE((
        SELECT m2.value FROM metrics m2
        WHERE m2.workspace_id = ${tenant.workspace_id}
          AND m2.project_id = ${tenant.project_id}
          AND m2.service = ${metrics.service}
          AND m2.metric_name = ${metrics.metric_name}
          AND m2.metric_type = ${metrics.metric_type}
        ORDER BY m2.timestamp DESC
        LIMIT 1
      ), 0)`,
      latest_timestamp: sql<string>`COALESCE(MAX(${metrics.timestamp}), '')`,
    })
    .from(metrics)
    .where(where)
    .groupBy(metrics.service, metrics.metric_name, metrics.metric_type)
    .orderBy(desc(sql`MAX(${metrics.timestamp})`))
    .limit(50);
}

export async function getTraceSpans(
  d1: D1Database,
  traceId: string,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<Span[]> {
  const db = drizzle(d1);
  return db.select().from(spans).where(and(
    eq(spans.trace_id, traceId),
    ...tenantConditions(spans, tenant)
  )).orderBy(asc(spans.started_at));
}

export async function getLogFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<string[]> {
  const f = LOG_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = [...tenantConditions(logs, tenant), ...buildLogConditions(activeTags)];

  if (prefix) {
    conditions.push(sql`CAST(${f.col} AS TEXT) LIKE ${"%" + prefix + "%"}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .selectDistinct({ val: sql<string>`CAST(${f.col} AS TEXT)` })
    .from(logs)
    .where(where)
    .orderBy(asc(sql`CAST(${f.col} AS TEXT)`))
    .limit(50);

  return result.map((r) => r.val).filter(Boolean);
}

export async function getMetricFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<string[]> {
  const f = METRIC_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = [...tenantConditions(metrics, tenant), ...buildMetricConditions(activeTags)];

  if (prefix) {
    conditions.push(sql`CAST(${f.col} AS TEXT) LIKE ${"%" + prefix + "%"}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .selectDistinct({ val: sql<string>`CAST(${f.col} AS TEXT)` })
    .from(metrics)
    .where(where)
    .orderBy(asc(sql`CAST(${f.col} AS TEXT)`))
    .limit(50);

  return result.map((r) => r.val).filter(Boolean);
}

export async function getSpanFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[],
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): Promise<string[]> {
  const f = SPAN_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = [...tenantConditions(spans, tenant), ...buildSpanConditions(activeTags)];

  if (prefix) {
    conditions.push(sql`CAST(${f.col} AS TEXT) LIKE ${"%" + prefix + "%"}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .selectDistinct({ val: sql<string>`CAST(${f.col} AS TEXT)` })
    .from(spans)
    .where(where)
    .orderBy(asc(sql`CAST(${f.col} AS TEXT)`))
    .limit(50);

  return result.map((r) => r.val).filter(Boolean);
}
