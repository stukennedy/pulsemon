import { Effect } from "effect";
import type { VoiceTurn } from "@/db/schema";
import type { TenantScope } from "@/types";
import {
  buildVoiceSessionProfile,
  compareVoiceSessionProfiles,
  countRegressions,
  type CompareRow,
  type TurnLatencySample,
  type VoiceSessionProfile,
} from "@/lib/effect/voice-session-profile";
import { DatabaseError, NotFoundError, ValidationError } from "./errors";

/**
 * Read-side queries for the voice session compare view. Profile math lives in
 * `voice-session-profile.ts`; this module only fetches bounded, tenant-scoped
 * turn samples and hands them over.
 */

// A single session's turns are naturally bounded, but a runaway session (or a
// synthetic load-test id) must not pull the whole table into memory.
const MAX_SESSION_TURNS = 2000;

// The baseline aggregates many sessions, so it gets a larger, but still
// hard, cap on top of its recency window.
const MAX_BASELINE_TURNS = 5000;

export const DEFAULT_BASELINE_DAYS = 7;
export const MAX_BASELINE_DAYS = 30;

export const BASELINE_KEY = "baseline";
export const BASELINE_REFERENCE_VALUE = "baseline";
export const SESSION_REFERENCE_PREFIX = "session:";

/** Columns handed to buildVoiceSessionProfile; keep in sync with TurnLatencySample. */
const SAMPLE_COLUMNS =
  "audio_latency_ms, asr_latency_ms, llm_latency_ms, tts_latency_ms, interruption, cost_usd";

type TurnSampleRow = Pick<VoiceTurn, keyof TurnLatencySample>;

/** Reference side of a comparison: a concrete session, or a rolling baseline. */
export type CompareReference =
  | { readonly kind: "session"; readonly session_id: string }
  | { readonly kind: "baseline"; readonly days: number };

export function parseCompareReference(
  value: string,
  days: number
): Effect.Effect<CompareReference, ValidationError> {
  if (value === BASELINE_REFERENCE_VALUE) {
    return Effect.succeed({ kind: "baseline", days });
  }
  if (value.startsWith(SESSION_REFERENCE_PREFIX)) {
    const sessionId = value.slice(SESSION_REFERENCE_PREFIX.length).trim();
    if (sessionId.length > 0) {
      return Effect.succeed({ kind: "session", session_id: sessionId });
    }
  }
  return Effect.fail(new ValidationError({ message: "reference must be baseline or session:<id>" }));
}

export interface VoiceSessionComparison {
  readonly candidate: VoiceSessionProfile;
  readonly reference: VoiceSessionProfile | null;
  readonly rows: CompareRow[];
  readonly regressionCount: number;
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

function daysCutoffIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

export function getVoiceSessionProfile(
  db: D1Database,
  tenant: TenantScope,
  sessionId: string
): Effect.Effect<VoiceSessionProfile | null, DatabaseError> {
  return dbEffect(async () => {
    const rows = await db.prepare(
      `SELECT ${SAMPLE_COLUMNS}
       FROM voice_turns
       WHERE workspace_id = ?
         AND project_id = ?
         AND session_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, sessionId, MAX_SESSION_TURNS).all<TurnSampleRow>();

    if (rows.results.length === 0) return null;
    return buildVoiceSessionProfile(sessionId, `session ${sessionId}`, rows.results);
  });
}

export interface BaselineOptions {
  readonly days: number;
  /** Sessions to leave out, normally the candidate, so it cannot dilute its own baseline. */
  readonly excludeSessionIds?: readonly string[];
}

export function getVoiceBaselineProfile(
  db: D1Database,
  tenant: TenantScope,
  options: BaselineOptions
): Effect.Effect<VoiceSessionProfile | null, DatabaseError> {
  return dbEffect(async () => {
    const exclusions = (options.excludeSessionIds ?? []).filter((id) => id.trim().length > 0);
    const exclusionSql = exclusions.length > 0
      ? `AND (session_id IS NULL OR session_id NOT IN (${placeholders(exclusions)}))`
      : "";

    const rows = await db.prepare(
      `SELECT ${SAMPLE_COLUMNS}
       FROM voice_turns
       WHERE workspace_id = ?
         AND project_id = ?
         AND started_at >= ?
         ${exclusionSql}
       ORDER BY started_at DESC
       LIMIT ?`
    ).bind(
      tenant.workspace_id,
      tenant.project_id,
      daysCutoffIso(options.days),
      ...exclusions,
      MAX_BASELINE_TURNS
    ).all<TurnSampleRow>();

    if (rows.results.length === 0) return null;
    return buildVoiceSessionProfile(
      BASELINE_KEY,
      `last ${options.days}d (${rows.results.length} turns)`,
      rows.results
    );
  });
}

function validateComparisonInput(
  candidateId: string,
  reference: CompareReference
): Effect.Effect<void, ValidationError> {
  return Effect.gen(function* () {
    if (candidateId.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({ message: "candidate session id is required" }));
    }
    if (reference.kind === "session" && reference.session_id.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({ message: "reference session id is required" }));
    }
    if (reference.kind === "baseline" && (
      !Number.isInteger(reference.days) || reference.days < 1 || reference.days > MAX_BASELINE_DAYS
    )) {
      return yield* Effect.fail(new ValidationError({
        message: `baseline days must be an integer between 1 and ${MAX_BASELINE_DAYS}`,
      }));
    }
  });
}

export function compareVoiceSessions(
  db: D1Database,
  tenant: TenantScope,
  candidateId: string,
  reference: CompareReference
): Effect.Effect<VoiceSessionComparison, DatabaseError | NotFoundError | ValidationError> {
  return Effect.gen(function* () {
    yield* validateComparisonInput(candidateId, reference);

    const candidate = yield* getVoiceSessionProfile(db, tenant, candidateId);
    if (!candidate) {
      return yield* Effect.fail(new NotFoundError({ message: `No voice turns found for session ${candidateId}` }));
    }

    let referenceProfile: VoiceSessionProfile | null;
    if (reference.kind === "session") {
      referenceProfile = yield* getVoiceSessionProfile(db, tenant, reference.session_id);
      // An explicitly chosen reference session that has no turns is operator
      // error worth surfacing; an empty rolling baseline is a legitimate
      // "no_data" comparison (fresh deployment), so only the former fails.
      if (!referenceProfile) {
        return yield* Effect.fail(new NotFoundError({
          message: `No voice turns found for session ${reference.session_id}`,
        }));
      }
    } else {
      referenceProfile = yield* getVoiceBaselineProfile(db, tenant, {
        days: reference.days,
        excludeSessionIds: [candidateId],
      });
    }

    const rows = compareVoiceSessionProfiles(candidate, referenceProfile);
    return {
      candidate,
      reference: referenceProfile,
      rows,
      regressionCount: countRegressions(rows),
    };
  });
}
