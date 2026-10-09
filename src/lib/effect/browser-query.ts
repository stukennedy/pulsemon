import { Effect } from "effect";
import type { BrowserBatch, BrowserEvent, BrowserSession } from "@/db/schema";
import type { TenantScope } from "@/types";
import { DatabaseError, NotFoundError } from "./errors";
import type { BrowserDevice } from "./browser";

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: error instanceof Error ? error.message : String(error) }),
  });
}

export const BROWSER_DEVICES: readonly BrowserDevice[] = ["desktop", "tablet", "mobile"];

export function browserDevice(value: string | undefined): BrowserDevice | undefined {
  return BROWSER_DEVICES.find((device) => device === value);
}

export interface BrowserSessionFilters {
  readonly path?: string;
  readonly device?: BrowserDevice;
  readonly frustrated?: boolean;
  readonly userId?: string;
  readonly limit?: number;
}

export function listBrowserSessions(
  db: D1Database,
  tenant: TenantScope,
  filters: BrowserSessionFilters = {}
): Effect.Effect<BrowserSession[], DatabaseError> {
  const where = ["s.workspace_id = ?", "s.project_id = ?"];
  const binds: unknown[] = [tenant.workspace_id, tenant.project_id];
  if (filters.device) {
    where.push("s.device = ?");
    binds.push(filters.device);
  }
  if (filters.frustrated) where.push("(s.rage_clicks > 0 OR s.dead_clicks > 0 OR s.errors > 0)");
  if (filters.userId) {
    where.push("s.user_id = ?");
    binds.push(filters.userId);
  }
  if (filters.path) {
    where.push(`EXISTS (SELECT 1 FROM browser_events e WHERE e.workspace_id = s.workspace_id AND e.project_id = s.project_id
      AND e.session_id = s.id AND e.type = 'pageview' AND e.path = ?)`);
    binds.push(filters.path);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  return dbEffect(async () => (await db.prepare(
    `SELECT s.* FROM browser_sessions s WHERE ${where.join(" AND ")} ORDER BY s.last_seen_at DESC LIMIT ${limit}`
  ).bind(...binds).all<BrowserSession>()).results);
}

export interface BrowserSessionDetail {
  readonly session: BrowserSession;
  readonly events: readonly BrowserEvent[];
}

export function getBrowserSession(
  db: D1Database,
  tenant: TenantScope,
  id: string
): Effect.Effect<BrowserSessionDetail, DatabaseError | NotFoundError> {
  return Effect.gen(function* () {
    const session = yield* dbEffect(() => db.prepare(
      `SELECT * FROM browser_sessions WHERE workspace_id = ? AND project_id = ? AND id = ?`
    ).bind(tenant.workspace_id, tenant.project_id, id).first<BrowserSession>());
    if (!session) return yield* Effect.fail(new NotFoundError({ message: "Session not found" }));

    const events = yield* dbEffect(async () => (await db.prepare(
      `SELECT * FROM browser_events WHERE workspace_id = ? AND project_id = ? AND session_id = ?
       ORDER BY timestamp ASC, id ASC LIMIT 5000`
    ).bind(tenant.workspace_id, tenant.project_id, id).all<BrowserEvent>()).results);

    return { session, events };
  });
}

export function replayChunkKeys(
  db: D1Database,
  tenant: TenantScope,
  sessionId: string
): Effect.Effect<string[], DatabaseError> {
  return dbEffect(async () => (await db.prepare(
    `SELECT replay_key FROM browser_batches
     WHERE workspace_id = ? AND project_id = ? AND session_id = ? AND replay_key IS NOT NULL
     ORDER BY seq ASC`
  ).bind(tenant.workspace_id, tenant.project_id, sessionId).all<Pick<BrowserBatch, "replay_key">>()).results
    .map((row) => row.replay_key)
    .filter((key): key is string => typeof key === "string"));
}

/**
 * Concatenates stored chunks (each a JSON array) into one JSON array without
 * parsing them, so a long session never has to fit in Worker memory as objects.
 */
export function streamReplayEvents(bucket: R2Bucket, keys: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  let wroteAny = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("["));
    },
    async pull(controller) {
      while (index < keys.length) {
        const object = await bucket.get(keys[index++]!);
        if (!object) continue;
        const inner = (await object.text()).trim().replace(/^\[/, "").replace(/\]$/, "").trim();
        if (!inner) continue;
        controller.enqueue(encoder.encode(`${wroteAny ? "," : ""}${inner}`));
        wroteAny = true;
        return;
      }
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });
}

export type HeatmapType = "click" | "rage_click" | "dead_click";

export function heatmapType(value: string | undefined): HeatmapType {
  return value === "rage_click" || value === "dead_click" ? value : "click";
}

export interface HeatmapPoint {
  readonly x: number;
  readonly y: number;
  readonly vw: number;
}

export interface HeatmapQuery {
  readonly path: string;
  readonly device: BrowserDevice;
  readonly type: HeatmapType;
  readonly days: number;
  readonly now?: Date;
}

function since(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function queryHeatmapPoints(
  db: D1Database,
  tenant: TenantScope,
  query: HeatmapQuery
): Effect.Effect<HeatmapPoint[], DatabaseError> {
  const types = query.type === "click" ? ["click", "rage_click", "dead_click"] : [query.type];
  return dbEffect(async () => (await db.prepare(
    `SELECT x, y, viewport_w AS vw FROM browser_events
     WHERE workspace_id = ? AND project_id = ? AND path = ? AND type IN (${types.map(() => "?").join(", ")})
       AND device = ? AND timestamp >= ? AND x IS NOT NULL AND y IS NOT NULL AND viewport_w > 0
     ORDER BY timestamp DESC LIMIT 20000`
  ).bind(
    tenant.workspace_id, tenant.project_id, query.path, ...types, query.device, since(query.days, query.now)
  ).all<HeatmapPoint>()).results);
}

export interface ScrollReach {
  readonly depth: number;
  readonly percent: number;
}

export interface ScrollMap {
  readonly views: number;
  readonly reach: readonly ScrollReach[];
  readonly averageFold: number | null;
}

export function scrollReach(depths: readonly number[], step = 5): ScrollReach[] {
  const reach: ScrollReach[] = [];
  for (let depth = 0; depth <= 100; depth += step) {
    const reached = depths.filter((value) => value >= depth).length;
    reach.push({ depth, percent: depths.length ? (reached / depths.length) * 100 : 0 });
  }
  return reach;
}

export function queryScrollMap(
  db: D1Database,
  tenant: TenantScope,
  query: Omit<HeatmapQuery, "type">
): Effect.Effect<ScrollMap, DatabaseError> {
  return Effect.gen(function* () {
    const cutoff = since(query.days, query.now);
    const depths = yield* dbEffect(async () => (await db.prepare(
      `SELECT depth FROM browser_events
       WHERE workspace_id = ? AND project_id = ? AND path = ? AND type = 'scroll' AND device = ?
         AND timestamp >= ? AND depth IS NOT NULL
       ORDER BY timestamp DESC LIMIT 20000`
    ).bind(tenant.workspace_id, tenant.project_id, query.path, query.device, cutoff).all<{ depth: number }>()).results
      .map((row) => row.depth));

    const fold = yield* dbEffect(() => db.prepare(
      `SELECT avg(CAST(viewport_h AS REAL) * 100 / doc_h) AS fold FROM browser_events
       WHERE workspace_id = ? AND project_id = ? AND path = ? AND type = 'pageview' AND device = ?
         AND timestamp >= ? AND doc_h > 0 AND viewport_h > 0`
    ).bind(tenant.workspace_id, tenant.project_id, query.path, query.device, cutoff).first<number | null>("fold"));

    return {
      views: depths.length,
      reach: scrollReach(depths),
      averageFold: typeof fold === "number" ? Math.min(fold, 100) : null,
    };
  });
}

export interface BrowserPageSummary {
  readonly path: string;
  readonly views: number;
  readonly clicks: number;
  readonly rage_clicks: number;
  readonly dead_clicks: number;
  readonly errors: number;
}

export function queryBrowserPages(
  db: D1Database,
  tenant: TenantScope,
  days: number,
  now?: Date
): Effect.Effect<BrowserPageSummary[], DatabaseError> {
  return dbEffect(async () => (await db.prepare(
    `SELECT path,
       sum(type = 'pageview') AS views,
       sum(type IN ('click', 'rage_click', 'dead_click')) AS clicks,
       sum(type = 'rage_click') AS rage_clicks,
       sum(type = 'dead_click') AS dead_clicks,
       sum(type = 'error') AS errors
     FROM browser_events
     WHERE workspace_id = ? AND project_id = ? AND timestamp >= ?
     GROUP BY path ORDER BY views DESC LIMIT 200`
  ).bind(tenant.workspace_id, tenant.project_id, since(days, now)).all<BrowserPageSummary>()).results);
}

export interface HeatmapSnapshot {
  readonly sessionId: string;
  readonly at: number;
  readonly viewportWidth: number;
  readonly docHeight: number;
}

export function queryHeatmapSnapshot(
  db: D1Database,
  tenant: TenantScope,
  path: string,
  device: BrowserDevice
): Effect.Effect<HeatmapSnapshot | null, DatabaseError> {
  return dbEffect(async () => {
    const row = await db.prepare(
      `SELECT e.session_id, e.timestamp, e.viewport_w, e.doc_h FROM browser_events e
       JOIN browser_sessions s ON s.workspace_id = e.workspace_id AND s.project_id = e.project_id AND s.id = e.session_id
       WHERE e.workspace_id = ? AND e.project_id = ? AND e.path = ? AND e.type = 'pageview' AND e.device = ?
         AND s.replay_chunks > 0
       ORDER BY e.timestamp DESC LIMIT 1`
    ).bind(tenant.workspace_id, tenant.project_id, path, device)
      .first<{ session_id: string; timestamp: string; viewport_w: number | null; doc_h: number | null }>();
    if (!row) return null;
    return {
      sessionId: row.session_id,
      at: Date.parse(row.timestamp),
      viewportWidth: row.viewport_w ?? 1280,
      docHeight: row.doc_h ?? 0,
    };
  });
}
