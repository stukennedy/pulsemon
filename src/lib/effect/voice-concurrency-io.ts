/**
 * D1 queries feeding the voice concurrency panel (`/voice` + the live SSE
 * stream). Two concerns, deliberately separate:
 *
 *   - `queryVoiceConcurrencyWindow` — the HISTORICAL bucketed sweep (sessions
 *     / LLM generations / TTS syntheses) for a bounded window, rendered as
 *     three `MetricTimeseriesChart`-compatible series via
 *     `computeConcurrencySeries` (`./voice-concurrency.ts`).
 *   - `queryVoiceConcurrencyNow` — the "right now" stat tiles. NOT derived
 *     from the window sweep: sessions need a staleness guard the historical
 *     query has no reason to apply (see below), and LLM/TTS "now" only needs
 *     a few minutes of spans, not the whole window.
 *
 * `connections` rows are the sessions source of truth (PR-A). Pre-PR-A data
 * has none, so `queryVoiceConcurrencyWindow` falls back to session intervals
 * derived from `voice_turns` MIN/MAX (mirroring the aggregation
 * `queryVoiceSessionSummaries` in `sessions.ts` already does), only when the
 * primary query returns zero rows in the window — old and new data are never
 * mixed for the same window.
 */
import { Effect } from "effect";
import type { TenantScope } from "@/types";
import {
  computeConcurrencySeries,
  openIntervalCount,
  type ConcurrencyInterval,
  type ConcurrencySeriesResult,
  type ConcurrencyWindow,
} from "./voice-concurrency";
import { DatabaseError, ValidationError } from "./errors";

export interface VoiceConcurrencyWindowParams {
  readonly minutes?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface VoiceConcurrencyWindowResult {
  readonly from: string;
  readonly to: string;
  readonly bucketMs: number;
  readonly sessions: ConcurrencySeriesResult;
  readonly llm: ConcurrencySeriesResult;
  readonly tts: ConcurrencySeriesResult;
}

export interface VoiceConcurrencyNow {
  readonly sessionsNow: number;
  readonly llmInFlight: number;
  readonly ttsInFlight: number;
}

/** Window cap (plan: "cap 24h"). A window this wide is already expensive at
 *  the raw-row granularity these queries use; there is no rollup story for
 *  concurrency yet (deferred — see the plan's Phase B follow-up ticket). */
const MAX_WINDOW_MINUTES = 1440;
const DEFAULT_WINDOW_MINUTES = 60;
/** Cost guard on each interval-source query. A window this densely packed
 *  with sessions/generations is already an anomaly worth its own
 *  investigation, not a bigger LIMIT. */
const ROW_CAP = 5000;
/** A `connections` row stuck at `status='active'` this long without a close
 *  is a leaked row (crash, missed `connection_update`), not a real live
 *  session — counting it in "sessions now" would report a phantom call
 *  forever. */
const SESSION_STALENESS_MS = 2 * 60 * 60 * 1000;
/** How far back "in-flight" LLM/TTS spans are looked up for the live tiles.
 *  Generations complete in seconds; several minutes is generous headroom
 *  while keeping the query cheap and bounded. */
const NOW_LOOKBACK_MINUTES = 15;
/** Buckets aim for roughly this many points regardless of window length, so
 *  a 1h window gets ~1-minute buckets and a 24h window gets ~24-minute
 *  buckets — `MetricTimeseriesChart` renders its last 80 points either way. */
const TARGET_BUCKETS = 60;
const ONE_MINUTE_MS = 60_000;

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

function resolveWindow(
  params: VoiceConcurrencyWindowParams
): Effect.Effect<{ fromMs: number; toMs: number }, ValidationError> {
  return Effect.gen(function* () {
    const explicitTo = yield* parseDate("to", params.to);
    const explicitFrom = yield* parseDate("from", params.from);
    const minutes = params.minutes ?? DEFAULT_WINDOW_MINUTES;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
      return yield* Effect.fail(
        new ValidationError({ message: `minutes must be an integer between 1 and ${MAX_WINDOW_MINUTES}` })
      );
    }

    const to = explicitTo ?? new Date();
    const from = explicitFrom ?? new Date(to.getTime() - minutes * ONE_MINUTE_MS);

    if (from.getTime() >= to.getTime()) {
      return yield* Effect.fail(new ValidationError({ message: "from must be before to" }));
    }
    if (to.getTime() - from.getTime() > MAX_WINDOW_MINUTES * ONE_MINUTE_MS) {
      return yield* Effect.fail(
        new ValidationError({ message: `window must not exceed ${MAX_WINDOW_MINUTES} minutes` })
      );
    }

    return { fromMs: from.getTime(), toMs: to.getTime() };
  });
}

function bucketMsFor(windowMs: number): number {
  const raw = Math.ceil(windowMs / TARGET_BUCKETS);
  return Math.max(ONE_MINUTE_MS, Math.ceil(raw / ONE_MINUTE_MS) * ONE_MINUTE_MS);
}

interface IntervalRow {
  readonly started_at: string;
  readonly ended_at: string | null;
}

function toIntervals(rows: readonly IntervalRow[]): ConcurrencyInterval[] {
  const intervals: ConcurrencyInterval[] = [];
  for (const row of rows) {
    const startMs = Date.parse(row.started_at);
    if (Number.isNaN(startMs)) continue;
    const endMs = row.ended_at ? Date.parse(row.ended_at) : null;
    intervals.push({ startMs, endMs: endMs !== null && Number.isNaN(endMs) ? null : endMs });
  }
  return intervals;
}

/** Rows whose `[started_at, ended_at ?? now)` overlaps `[fromIso, toIso]`. */
function queryConnectionRows(
  db: D1Database,
  tenant: TenantScope,
  fromIso: string,
  toIso: string
): Effect.Effect<IntervalRow[], DatabaseError> {
  return dbEffect(async () => {
    const result = await db.prepare(
      `SELECT started_at, ended_at FROM connections
       WHERE workspace_id = ? AND project_id = ?
         AND started_at <= ?
         AND (ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at ASC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, toIso, fromIso, ROW_CAP).all<IntervalRow>();
    return result.results;
  });
}

/** Pre-PR-A fallback: one interval per session, `[MIN(turn.started_at),
 *  MAX(turn.ended_at ?? turn.started_at)]` — the same aggregation
 *  `queryVoiceSessionSummaries` (`sessions.ts`) uses for its session list,
 *  bounded to the window here instead of a row LIMIT. These sessions never
 *  read as "open" (the aggregate always has an end), which is honest: turn
 *  history alone can't say whether a session is still live. */
function queryVoiceTurnSessionIntervals(
  db: D1Database,
  tenant: TenantScope,
  fromIso: string,
  toIso: string
): Effect.Effect<IntervalRow[], DatabaseError> {
  return dbEffect(async () => {
    const result = await db.prepare(
      `SELECT MIN(started_at) AS started_at, MAX(COALESCE(ended_at, started_at)) AS ended_at
       FROM voice_turns
       WHERE workspace_id = ? AND project_id = ? AND session_id IS NOT NULL
         AND started_at <= ?
       GROUP BY session_id
       HAVING MAX(COALESCE(ended_at, started_at)) >= ?
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, toIso, fromIso, ROW_CAP).all<IntervalRow>();
    return result.results;
  });
}

/** Rows for one span `operation` whose `[started_at, ended_at ?? now)`
 *  overlaps `[fromIso, toIso]`. Shared by both the window sweep and the
 *  "now" in-flight tiles — only the window differs. */
function querySpanRows(
  db: D1Database,
  tenant: TenantScope,
  operation: string,
  fromIso: string,
  toIso: string
): Effect.Effect<IntervalRow[], DatabaseError> {
  return dbEffect(async () => {
    const result = await db.prepare(
      `SELECT started_at, ended_at FROM spans
       WHERE workspace_id = ? AND project_id = ? AND operation = ?
         AND started_at <= ?
         AND (ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at ASC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, operation, toIso, fromIso, ROW_CAP).all<IntervalRow>();
    return result.results;
  });
}

function querySessionIntervals(
  db: D1Database,
  tenant: TenantScope,
  fromIso: string,
  toIso: string
): Effect.Effect<ConcurrencyInterval[], DatabaseError> {
  return Effect.gen(function* () {
    const connectionRows = yield* queryConnectionRows(db, tenant, fromIso, toIso);
    if (connectionRows.length > 0) return toIntervals(connectionRows);

    const fallbackRows = yield* queryVoiceTurnSessionIntervals(db, tenant, fromIso, toIso);
    return toIntervals(fallbackRows);
  });
}

/**
 * Bucketed sessions/LLM/TTS concurrency across `[from, to]`, ready for
 * `MetricTimeseriesChart`. Window bounded to `MAX_WINDOW_MINUTES`; bucket
 * width auto-scales with the window (`bucketMsFor`).
 */
export function queryVoiceConcurrencyWindow(
  db: D1Database,
  tenant: TenantScope,
  params: VoiceConcurrencyWindowParams = {}
): Effect.Effect<VoiceConcurrencyWindowResult, DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const { fromMs, toMs } = yield* resolveWindow(params);
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const bucketMs = bucketMsFor(toMs - fromMs);
    const window: ConcurrencyWindow = { windowStartMs: fromMs, windowEndMs: toMs, bucketMs };

    const [sessionIntervals, llmRows, ttsRows] = yield* Effect.all(
      [
        querySessionIntervals(db, tenant, fromIso, toIso),
        querySpanRows(db, tenant, "voice.llm.generate", fromIso, toIso),
        querySpanRows(db, tenant, "voice.tts.synthesize", fromIso, toIso),
      ],
      { concurrency: 3 }
    );

    return {
      from: fromIso,
      to: toIso,
      bucketMs,
      sessions: computeConcurrencySeries(sessionIntervals, window),
      llm: computeConcurrencySeries(toIntervals(llmRows), window),
      tts: computeConcurrencySeries(toIntervals(ttsRows), window),
    };
  });
}

/**
 * The live stat tiles: sessions currently active, and LLM/TTS generations
 * currently in flight. Cheap and narrow on purpose — this runs every ~5s
 * from the SSE stream.
 */
export function queryVoiceConcurrencyNow(
  db: D1Database,
  tenant: TenantScope
): Effect.Effect<VoiceConcurrencyNow, DatabaseError> {
  return Effect.gen(function* () {
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const staleBoundaryIso = new Date(nowMs - SESSION_STALENESS_MS).toISOString();
    const lookbackIso = new Date(nowMs - NOW_LOOKBACK_MINUTES * ONE_MINUTE_MS).toISOString();

    const [sessionsNowRow, llmRows, ttsRows] = yield* Effect.all(
      [
        dbEffect(() =>
          db.prepare(
            `SELECT COUNT(*) AS n FROM connections
             WHERE workspace_id = ? AND project_id = ? AND status = 'active' AND started_at > ?`
          ).bind(tenant.workspace_id, tenant.project_id, staleBoundaryIso).first<{ n: number }>()
        ),
        querySpanRows(db, tenant, "voice.llm.generate", lookbackIso, nowIso),
        querySpanRows(db, tenant, "voice.tts.synthesize", lookbackIso, nowIso),
      ],
      { concurrency: 3 }
    );

    return {
      sessionsNow: Number(sessionsNowRow?.n ?? 0),
      llmInFlight: openIntervalCount(toIntervals(llmRows), nowMs),
      ttsInFlight: openIntervalCount(toIntervals(ttsRows), nowMs),
    };
  });
}
