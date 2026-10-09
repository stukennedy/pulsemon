import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { BrowserEventInsert, BrowserSession } from "@/db/schema";
import type { TenantScope } from "@/types";
import type { ApiKeyContext } from "./auth";
import {
  ConfigurationError,
  DatabaseError,
  InternalError,
  MissingConfigError,
  UnauthorizedError,
  ValidationError,
  type IngestError,
} from "./errors";
import { governText, governValue, type IngestGovernanceConfig } from "./governance";
import type { IngestPressureController } from "./pressure";

export const BROWSER_MAX_EVENTS = 500;
export const BROWSER_MAX_RRWEB_EVENTS = 5000;
const MAX_PROPS = 20;

const Str = (max: number) => Schema.String.pipe(Schema.maxLength(max));
const NonEmpty = (max: number) => Schema.NonEmptyString.pipe(Schema.maxLength(max));
const Finite = Schema.Number.pipe(Schema.finite());
const Px = Schema.Number.pipe(Schema.finite(), Schema.between(0, 1_000_000));
const Timestamp = Schema.Number.pipe(Schema.int(), Schema.positive());

const PageviewEvent = Schema.Struct({
  t: Timestamp,
  type: Schema.Literal("pageview"),
  path: NonEmpty(1024),
  vw: Px,
  vh: Px,
  dh: Px,
});

const ClickEvent = Schema.Struct({
  t: Timestamp,
  type: Schema.Literal("click", "rage_click", "dead_click"),
  path: NonEmpty(1024),
  sel: Str(512),
  x: Finite,
  y: Finite,
  vw: Px,
  vh: Px,
  dh: Px,
});

const ScrollEvent = Schema.Struct({
  t: Timestamp,
  type: Schema.Literal("scroll"),
  path: NonEmpty(1024),
  depth: Schema.Number.pipe(Schema.between(0, 100)),
  vw: Px,
  dh: Px,
});

const ErrorEvent = Schema.Struct({
  t: Timestamp,
  type: Schema.Literal("error"),
  path: NonEmpty(1024),
  msg: Str(500),
  src: Schema.optional(Str(1024)),
});

const CustomEvent = Schema.Struct({
  t: Timestamp,
  type: Schema.Literal("custom"),
  path: NonEmpty(1024),
  name: NonEmpty(128),
  props: Schema.optional(Schema.Record({
    key: Str(128),
    value: Schema.Union(Str(256), Finite, Schema.Boolean),
  })),
});

const BrowserEventSchema = Schema.Union(PageviewEvent, ClickEvent, ScrollEvent, ErrorEvent, CustomEvent);
export type BrowserWireEvent = Schema.Schema.Type<typeof BrowserEventSchema>;

export const BrowserBatchSchema = Schema.Struct({
  v: Schema.Literal(1),
  sid: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{8,64}$/)),
  seq: Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000_000)),
  uid: Schema.optional(Str(128)),
  page: Schema.Struct({
    url: NonEmpty(2048),
    path: NonEmpty(1024),
    title: Schema.optional(Str(256)),
    referrer: Schema.optional(Str(2048)),
    vw: Px,
    vh: Px,
  }),
  rrweb: Schema.optional(Schema.Array(Schema.Unknown).pipe(Schema.maxItems(BROWSER_MAX_RRWEB_EVENTS))),
  events: Schema.Array(BrowserEventSchema).pipe(Schema.maxItems(BROWSER_MAX_EVENTS)),
});
export type BrowserWireBatch = Schema.Schema.Type<typeof BrowserBatchSchema>;

export type BrowserDevice = BrowserSession["device"];

export function deviceClass(viewportWidth: number): BrowserDevice {
  if (viewportWidth < 768) return "mobile";
  if (viewportWidth < 1024) return "tablet";
  return "desktop";
}

export interface BrowserKeyConfig {
  readonly origins: readonly string[];
  readonly workspace_id: string;
  readonly project_id: string;
}

export function parseBrowserKeys(raw: string | undefined): Effect.Effect<ReadonlyMap<string, BrowserKeyConfig>, MissingConfigError | ConfigurationError> {
  if (!raw || raw.trim() === "") {
    return Effect.fail(new MissingConfigError({ message: "Browser ingest not configured" }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Effect.fail(new ConfigurationError({ message: "BROWSER_INGEST_KEYS is not valid JSON" }));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Effect.fail(new ConfigurationError({ message: "BROWSER_INGEST_KEYS must be an object keyed by public key" }));
  }

  const keys = new Map<string, BrowserKeyConfig>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Record<string, unknown> | null;
    const origins = entry?.origins;
    if (!Array.isArray(origins) || !origins.every((origin) => typeof origin === "string")) {
      return Effect.fail(new ConfigurationError({ message: `BROWSER_INGEST_KEYS.${key}.origins must be a string array` }));
    }
    keys.set(key, {
      origins: origins.map((origin) => origin.replace(/\/+$/, "")),
      workspace_id: typeof entry?.workspace_id === "string" && entry.workspace_id ? entry.workspace_id : "default",
      project_id: typeof entry?.project_id === "string" && entry.project_id ? entry.project_id : "default",
    });
  }
  return Effect.succeed(keys);
}

export interface BrowserAuthorization {
  readonly tenant: TenantScope;
  readonly allowOrigin: string;
  readonly context: ApiKeyContext;
}

function keyHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function authorizeBrowserKey(
  keys: ReadonlyMap<string, BrowserKeyConfig>,
  key: string | undefined,
  origin: string | undefined
): Effect.Effect<BrowserAuthorization, UnauthorizedError> {
  const config = key ? keys.get(key) : undefined;
  if (!key || !config) return Effect.fail(new UnauthorizedError({ message: "Unknown browser key" }));

  const normalizedOrigin = origin?.replace(/\/+$/, "");
  const wildcard = config.origins.includes("*");
  if (!wildcard && (!normalizedOrigin || !config.origins.includes(normalizedOrigin))) {
    return Effect.fail(new UnauthorizedError({ message: "Origin not allowed for this key" }));
  }

  const tenant = { workspace_id: config.workspace_id, project_id: config.project_id };
  return Effect.succeed({
    tenant,
    allowOrigin: normalizedOrigin ?? "*",
    context: { ...tenant, scopes: ["browser"], token_hash: keyHash(key) },
  });
}

export function replayKey(tenant: TenantScope, sessionId: string, seq: number, prefix = "browser-replay") {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9._=-]/g, "_");
  return [
    prefix.replace(/^\/+|\/+$/g, "") || "browser-replay",
    `workspace=${clean(tenant.workspace_id)}`,
    `project=${clean(tenant.project_id)}`,
    `session=${clean(sessionId)}`,
    `${String(seq).padStart(6, "0")}.json`,
  ].join("/");
}

export interface BrowserIngestDeps {
  readonly db: D1Database;
  readonly bucket?: R2Bucket;
  readonly auth: BrowserAuthorization;
  readonly pressure: IngestPressureController;
  readonly governance: IngestGovernanceConfig;
  readonly userAgent?: string;
  readonly country?: string;
  readonly now?: () => Date;
}

export interface BrowserIngestResult {
  readonly accepted: number;
  readonly replayBytes: number;
  readonly duplicate: boolean;
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: error instanceof Error ? error.message : String(error) }),
  });
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

export function browserEventRows(
  batch: BrowserWireBatch,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): BrowserEventInsert[] {
  return batch.events.map((event, index) => {
    const base = {
      id: `${batch.sid}:${batch.seq}:${index}`,
      ...tenant,
      session_id: batch.sid,
      timestamp: iso(event.t),
      type: event.type,
      path: event.path,
      device: deviceClass("vw" in event ? event.vw : batch.page.vw),
    } satisfies BrowserEventInsert;

    switch (event.type) {
      case "pageview":
        return { ...base, viewport_w: Math.round(event.vw), viewport_h: Math.round(event.vh), doc_h: Math.round(event.dh) };
      case "click":
      case "rage_click":
      case "dead_click":
        return {
          ...base,
          selector: governText(event.sel, governance) ?? null,
          x: event.x,
          y: event.y,
          viewport_w: Math.round(event.vw),
          viewport_h: Math.round(event.vh),
          doc_h: Math.round(event.dh),
        };
      case "scroll":
        return { ...base, depth: event.depth, viewport_w: Math.round(event.vw), doc_h: Math.round(event.dh) };
      case "error":
        return {
          ...base,
          message: governText(event.msg, governance) ?? null,
          source: event.src ? governText(event.src, governance) ?? null : null,
        };
      case "custom": {
        const entries = Object.entries(event.props ?? {}).slice(0, MAX_PROPS);
        return {
          ...base,
          name: event.name,
          props: entries.length ? JSON.stringify(governValue(Object.fromEntries(entries), governance)) : null,
        };
      }
    }
  });
}

function rrwebTimeRange(events: readonly unknown[] | undefined): [number, number] | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const event of events ?? []) {
    const timestamp = (event as { timestamp?: unknown } | null)?.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    first = Math.min(first, timestamp);
    last = Math.max(last, timestamp);
  }
  return Number.isFinite(first) ? [first, last] : null;
}

const SESSION_REFRESH_SQL = `
UPDATE browser_sessions SET
  last_seen_at = CASE WHEN ? > last_seen_at THEN ? ELSE last_seen_at END,
  exit_path = CASE WHEN ? >= last_seen_at THEN ? ELSE exit_path END,
  started_at = CASE WHEN ? < started_at THEN ? ELSE started_at END,
  user_id = COALESCE(?, user_id),
  page_views = (SELECT count(*) FROM browser_events e WHERE e.workspace_id = browser_sessions.workspace_id AND e.project_id = browser_sessions.project_id AND e.session_id = browser_sessions.id AND e.type = 'pageview'),
  clicks = (SELECT count(*) FROM browser_events e WHERE e.workspace_id = browser_sessions.workspace_id AND e.project_id = browser_sessions.project_id AND e.session_id = browser_sessions.id AND e.type IN ('click', 'rage_click', 'dead_click')),
  rage_clicks = (SELECT count(*) FROM browser_events e WHERE e.workspace_id = browser_sessions.workspace_id AND e.project_id = browser_sessions.project_id AND e.session_id = browser_sessions.id AND e.type = 'rage_click'),
  dead_clicks = (SELECT count(*) FROM browser_events e WHERE e.workspace_id = browser_sessions.workspace_id AND e.project_id = browser_sessions.project_id AND e.session_id = browser_sessions.id AND e.type = 'dead_click'),
  errors = (SELECT count(*) FROM browser_events e WHERE e.workspace_id = browser_sessions.workspace_id AND e.project_id = browser_sessions.project_id AND e.session_id = browser_sessions.id AND e.type = 'error'),
  replay_chunks = (SELECT count(*) FROM browser_batches b WHERE b.workspace_id = browser_sessions.workspace_id AND b.project_id = browser_sessions.project_id AND b.session_id = browser_sessions.id AND b.replay_key IS NOT NULL),
  replay_bytes = (SELECT COALESCE(sum(replay_bytes), 0) FROM browser_batches b WHERE b.workspace_id = browser_sessions.workspace_id AND b.project_id = browser_sessions.project_id AND b.session_id = browser_sessions.id)
WHERE workspace_id = ? AND project_id = ? AND id = ?`;

const DURATION_SQL = `
UPDATE browser_sessions
SET duration_ms = CAST(round((julianday(last_seen_at) - julianday(started_at)) * 86400000) AS INTEGER)
WHERE workspace_id = ? AND project_id = ? AND id = ?`;

export function ingestBrowserBatch(
  deps: BrowserIngestDeps,
  raw: unknown
): Effect.Effect<BrowserIngestResult, IngestError> {
  return Effect.gen(function* () {
    const batch = yield* Schema.decodeUnknown(BrowserBatchSchema, { errors: "all" })(raw).pipe(
      Effect.mapError((error) => new ValidationError({ message: error.message }))
    );
    const { tenant } = deps.auth;
    yield* deps.pressure.prepare(deps.auth.context, "browser");

    const existing = yield* dbEffect(() => deps.db.prepare(
      `SELECT 1 AS hit FROM browser_batches WHERE workspace_id = ? AND project_id = ? AND session_id = ? AND seq = ?`
    ).bind(tenant.workspace_id, tenant.project_id, batch.sid, batch.seq).first<number>("hit"));
    if (existing) return { accepted: 0, replayBytes: 0, duplicate: true };

    const rrweb = batch.rrweb?.length ? batch.rrweb : undefined;
    let key: string | null = null;
    let replayBytes = 0;
    if (rrweb) {
      const bucket = deps.bucket;
      if (!bucket) {
        return yield* Effect.fail(new MissingConfigError({ message: "Session replay storage is not configured" }));
      }
      const body = JSON.stringify(rrweb);
      replayBytes = new TextEncoder().encode(body).byteLength;
      key = replayKey(tenant, batch.sid, batch.seq);
      const objectKey = key;
      yield* Effect.tryPromise({
        try: () => bucket.put(objectKey, body, { httpMetadata: { contentType: "application/json" } }),
        catch: (error) => new InternalError({ message: `Replay chunk write failed: ${error instanceof Error ? error.message : String(error)}` }),
      });
    }

    const now = (deps.now ?? (() => new Date()))();
    const range = rrwebTimeRange(rrweb);
    const eventTimes = batch.events.map((event) => event.t);
    const times = [...eventTimes, ...(range ?? [])];
    const firstMs = times.length ? Math.min(...times) : now.getTime();
    const lastMs = times.length ? Math.max(...times) : now.getTime();
    const firstAt = iso(firstMs);
    const lastAt = iso(lastMs);
    const latestPath = [...batch.events].sort((a, b) => b.t - a.t)[0]?.path ?? batch.page.path;
    const userId = batch.uid ? governText(batch.uid, deps.governance) ?? null : null;

    const statements: D1PreparedStatement[] = [
      deps.db.prepare(
        `INSERT OR IGNORE INTO browser_batches (workspace_id, project_id, session_id, seq, received_at, replay_key, replay_bytes, first_event_at, last_event_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tenant.workspace_id, tenant.project_id, batch.sid, batch.seq, now.toISOString(), key, replayBytes, range?.[0] ?? null, range?.[1] ?? null),
      deps.db.prepare(
        `INSERT OR IGNORE INTO browser_sessions (id, workspace_id, project_id, started_at, last_seen_at, user_id, entry_path, exit_path, device, viewport_w, viewport_h, user_agent, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        batch.sid, tenant.workspace_id, tenant.project_id, firstAt, lastAt, userId,
        batch.page.path, latestPath, deviceClass(batch.page.vw),
        Math.round(batch.page.vw), Math.round(batch.page.vh),
        deps.userAgent?.slice(0, 512) ?? null, deps.country ?? null
      ),
    ];

    for (const row of browserEventRows(batch, tenant, deps.governance)) {
      statements.push(deps.db.prepare(
        `INSERT OR IGNORE INTO browser_events (id, workspace_id, project_id, session_id, timestamp, type, path, device, selector, x, y, viewport_w, viewport_h, doc_h, depth, message, source, name, props)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        row.id, row.workspace_id, row.project_id, row.session_id, row.timestamp, row.type, row.path, row.device,
        row.selector ?? null, row.x ?? null, row.y ?? null, row.viewport_w ?? null, row.viewport_h ?? null,
        row.doc_h ?? null, row.depth ?? null, row.message ?? null, row.source ?? null, row.name ?? null, row.props ?? null
      ));
    }

    statements.push(
      deps.db.prepare(SESSION_REFRESH_SQL).bind(
        lastAt, lastAt, lastAt, latestPath, firstAt, firstAt, userId,
        tenant.workspace_id, tenant.project_id, batch.sid
      ),
      deps.db.prepare(DURATION_SQL).bind(tenant.workspace_id, tenant.project_id, batch.sid),
    );

    yield* dbEffect(() => deps.db.batch(statements));
    return { accepted: batch.events.length, replayBytes, duplicate: false };
  });
}
