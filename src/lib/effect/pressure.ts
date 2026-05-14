import { Effect } from "effect";
import type { Env } from "@/types";
import type { ApiKeyContext } from "./auth";
import { DatabaseError, RateLimitError, ValidationError } from "./errors";

export interface IngestPressureConfig {
  readonly rateLimitPerMinute: number;
  readonly sampleRate: number;
}

export interface IngestPressureController {
  readonly prepare: (
    context: ApiKeyContext,
    scope: string
  ) => Effect.Effect<IngestPressureConfig, DatabaseError | RateLimitError | ValidationError>;
}

type PressureEnv = Pick<Env, "INGEST_RATE_LIMIT_PER_MINUTE" | "INGEST_SAMPLE_RATE">;

export const DEFAULT_INGEST_PRESSURE_CONFIG: IngestPressureConfig = {
  rateLimitPerMinute: 0,
  sampleRate: 1,
};

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function integerConfig(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): Effect.Effect<number, ValidationError> {
  if (value === undefined || value.trim() === "") return Effect.succeed(fallback);

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return Effect.fail(new ValidationError({
      message: `${name} must be an integer between ${min} and ${max}`,
    }));
  }

  return Effect.succeed(parsed);
}

function numberConfig(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): Effect.Effect<number, ValidationError> {
  if (value === undefined || value.trim() === "") return Effect.succeed(fallback);

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return Effect.fail(new ValidationError({
      message: `${name} must be a number between ${min} and ${max}`,
    }));
  }

  return Effect.succeed(parsed);
}

export function ingestPressureConfigFromEnv(env: PressureEnv): Effect.Effect<IngestPressureConfig, ValidationError> {
  return Effect.gen(function* () {
    const rateLimitPerMinute = yield* integerConfig(
      "INGEST_RATE_LIMIT_PER_MINUTE",
      env.INGEST_RATE_LIMIT_PER_MINUTE,
      DEFAULT_INGEST_PRESSURE_CONFIG.rateLimitPerMinute,
      0,
      1_000_000
    );
    const sampleRate = yield* numberConfig(
      "INGEST_SAMPLE_RATE",
      env.INGEST_SAMPLE_RATE,
      DEFAULT_INGEST_PRESSURE_CONFIG.sampleRate,
      0,
      1
    );

    return { rateLimitPerMinute, sampleRate };
  });
}

function currentMinuteWindow() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString();
}

function stableRatio(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function recordRateLimit(
  db: D1Database,
  config: IngestPressureConfig,
  context: ApiKeyContext,
  scope: string
): Effect.Effect<void, DatabaseError | RateLimitError> {
  if (config.rateLimitPerMinute <= 0) return Effect.void;

  const windowStart = currentMinuteWindow();
  return Effect.gen(function* () {
    yield* dbEffect(() => db.prepare(
      `INSERT INTO ingest_rate_limits (
        window_start,
        workspace_id,
        project_id,
        scope,
        token_hash,
        request_count
      )
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(window_start, workspace_id, project_id, scope, token_hash)
      DO UPDATE SET request_count = request_count + 1`
    ).bind(
      windowStart,
      context.workspace_id,
      context.project_id,
      scope,
      context.token_hash
    ).run());

    const count = yield* dbEffect(() => db.prepare(
      `SELECT request_count FROM ingest_rate_limits
       WHERE window_start = ?
         AND workspace_id = ?
         AND project_id = ?
         AND scope = ?
         AND token_hash = ?`
    ).bind(
      windowStart,
      context.workspace_id,
      context.project_id,
      scope,
      context.token_hash
    ).first<number>("request_count"));

    if ((count ?? 0) > config.rateLimitPerMinute) {
      return yield* Effect.fail(new RateLimitError({
        message: `Ingest rate limit exceeded for scope ${scope}`,
      }));
    }
  });
}

export function makeIngestPressureController(db: D1Database, env: PressureEnv): IngestPressureController {
  return {
    prepare: (context, scope) => Effect.gen(function* () {
      const config = yield* ingestPressureConfigFromEnv(env);
      yield* recordRateLimit(db, config, context, scope);
      return config;
    }),
  };
}

export function sampleItems<A>(
  items: readonly A[],
  config: IngestPressureConfig,
  keyOf: (item: A, index: number) => string
): { kept: readonly A[]; sampledOut: number } {
  if (config.sampleRate >= 1) return { kept: items, sampledOut: 0 };
  if (config.sampleRate <= 0) return { kept: [], sampledOut: items.length };

  const kept = items.filter((item, index) => stableRatio(keyOf(item, index)) < config.sampleRate);
  return { kept, sampledOut: items.length - kept.length };
}
