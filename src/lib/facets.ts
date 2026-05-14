import { drizzle } from "drizzle-orm/d1";
import { asc, desc, count, sql, and, or, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";
import { connections, spans, events } from "@/db/schema";
import type { Connection, Span, Event } from "@/db/schema";
import type { ActiveTag } from "@/types";

type FacetDefinition = {
  name: string;
  field: string;
  col: AnyColumn;
};

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

export const CONNECTION_FACET_NAMES = CONNECTION_FACETS.map((f) => f.name);
export const SPAN_FACET_NAMES = SPAN_FACETS.map((f) => f.name);

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

export async function getConnectionFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[]
): Promise<string[]> {
  const f = CONNECTION_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = buildConnectionConditions(activeTags);

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
  offset = 0
): Promise<{ connections: Connection[]; total: number }> {
  const db = drizzle(d1);
  const conditions = buildConnectionConditions(activeTags);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
  connectionId: string
): Promise<{ connection: Connection | null; events: Event[]; spans: Span[] }> {
  const db = drizzle(d1);

  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);

  const connEvents = conn
    ? await db.select().from(events).where(eq(events.connection_id, connectionId)).orderBy(asc(events.timestamp))
    : [];

  const connSpans = conn
    ? await db.select().from(spans).where(eq(spans.connection_id, connectionId)).orderBy(asc(spans.started_at))
    : [];

  return { connection: conn || null, events: connEvents, spans: connSpans };
}

export async function querySpans(
  d1: D1Database,
  activeTags: ActiveTag[],
  limit = 100
): Promise<{ spans: Span[]; total: number }> {
  const db = drizzle(d1);
  const conditions = buildSpanConditions(activeTags);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(spans).where(where);

  const rows = await db
    .select()
    .from(spans)
    .where(where)
    .orderBy(desc(spans.started_at))
    .limit(limit);

  return { spans: rows, total };
}

export async function getTraceSpans(d1: D1Database, traceId: string): Promise<Span[]> {
  const db = drizzle(d1);
  return db.select().from(spans).where(eq(spans.trace_id, traceId)).orderBy(asc(spans.started_at));
}

export async function getSpanFacetValues(
  d1: D1Database,
  facet: string,
  prefix: string,
  activeTags: ActiveTag[]
): Promise<string[]> {
  const f = SPAN_FACETS.find((x) => x.name === facet);
  if (!f) return [];

  const db = drizzle(d1);
  const conditions = buildSpanConditions(activeTags);

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
