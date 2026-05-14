import { Effect } from "effect";
import type { Env } from "@/types";
import type { ApiKeyContext } from "./auth";
import { DatabaseError, ValidationError } from "./errors";
import type { TelemetryBatchWrite } from "./repository";

export interface IngestCardinalityConfig {
  readonly maxValuesPerKey: number;
}

export interface IngestCardinalityController {
  readonly enforce: (
    context: ApiKeyContext,
    scope: string,
    batch: TelemetryBatchWrite
  ) => Effect.Effect<void, DatabaseError | ValidationError>;
}

type CardinalityEnv = Pick<Env, "INGEST_CARDINALITY_MAX_VALUES_PER_KEY">;

interface CardinalityValue {
  readonly signal: string;
  readonly attributeKey: string;
  readonly valueHash: string;
}

interface CardinalityGroup {
  readonly signal: string;
  readonly attributeKey: string;
  readonly valueHashes: readonly string[];
}

export const DEFAULT_CARDINALITY_CONFIG: IngestCardinalityConfig = {
  maxValuesPerKey: 0,
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

export function cardinalityConfigFromEnv(
  env: CardinalityEnv
): Effect.Effect<IngestCardinalityConfig, ValidationError> {
  return Effect.gen(function* () {
    const maxValuesPerKey = yield* integerConfig(
      "INGEST_CARDINALITY_MAX_VALUES_PER_KEY",
      env.INGEST_CARDINALITY_MAX_VALUES_PER_KEY,
      DEFAULT_CARDINALITY_CONFIG.maxValuesPerKey,
      0,
      1_000_000
    );

    return { maxValuesPerKey };
  });
}

function now() {
  return new Date().toISOString();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeAttributeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .slice(0, 256);
}

function leafValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function addLeaf(
  values: Map<string, CardinalityValue>,
  signal: string,
  key: string,
  value: unknown
) {
  const rawValue = leafValue(value);
  if (rawValue === undefined) return;

  const attributeKey = normalizeAttributeKey(key);
  if (!attributeKey) return;

  const valueHash = stableHash(rawValue);
  values.set(`${signal}\0${attributeKey}\0${valueHash}`, {
    signal,
    attributeKey,
    valueHash,
  });
}

function collectStructuredValue(
  values: Map<string, CardinalityValue>,
  signal: string,
  prefix: string,
  value: unknown
) {
  const leaf = leafValue(value);
  if (leaf !== undefined || value === null) {
    addLeaf(values, signal, prefix, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredValue(values, signal, prefix, item);
    }
    return;
  }

  if (typeof value !== "object" || value === undefined) return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectStructuredValue(values, signal, `${prefix}.${key}`, item);
  }
}

function collectBatchCardinality(batch: TelemetryBatchWrite): readonly CardinalityValue[] {
  const values = new Map<string, CardinalityValue>();

  for (const item of batch.connections) {
    collectStructuredValue(values, "connections", "metadata", item.metadata);
  }
  for (const item of batch.connectionUpdates) {
    collectStructuredValue(values, "connections", "metadata", item.metadata);
  }
  for (const item of batch.spans) {
    collectStructuredValue(values, "spans", "attributes", item.attributes);
  }
  for (const item of batch.spanUpdates) {
    collectStructuredValue(values, "spans", "attributes", item.attributes);
  }
  for (const item of batch.events) {
    collectStructuredValue(values, "events", "data", item.data);
  }
  for (const item of batch.metrics) {
    collectStructuredValue(values, "metrics", "tags", item.tags);
  }
  for (const item of batch.logs) {
    collectStructuredValue(values, "logs", "attributes", item.attributes);
  }
  for (const item of batch.voiceTurns) {
    collectStructuredValue(values, "voice_turns", "metadata", item.metadata);
  }
  for (const item of batch.toolCalls) {
    collectStructuredValue(values, "agent_tool_calls", "metadata", item.metadata);
    collectStructuredValue(values, "agent_tool_calls", "input", item.input);
    collectStructuredValue(values, "agent_tool_calls", "output", item.output);
  }

  return [...values.values()];
}

function groupValues(values: readonly CardinalityValue[]): readonly CardinalityGroup[] {
  const groups = new Map<string, {
    signal: string;
    attributeKey: string;
    valueHashes: Set<string>;
  }>();

  for (const value of values) {
    const groupKey = `${value.signal}\0${value.attributeKey}`;
    const group = groups.get(groupKey);
    if (group) {
      group.valueHashes.add(value.valueHash);
    } else {
      groups.set(groupKey, {
        signal: value.signal,
        attributeKey: value.attributeKey,
        valueHashes: new Set([value.valueHash]),
      });
    }
  }

  return [...groups.values()].map((group) => ({
    signal: group.signal,
    attributeKey: group.attributeKey,
    valueHashes: [...group.valueHashes],
  }));
}

function countExistingValues(
  db: D1Database,
  context: ApiKeyContext,
  scope: string,
  group: CardinalityGroup
) {
  return dbEffect(() => db.prepare(
    `SELECT COUNT(*) AS count
     FROM ingest_cardinality_values
     WHERE workspace_id = ?
       AND project_id = ?
       AND scope = ?
       AND signal = ?
       AND attribute_key = ?`
  ).bind(
    context.workspace_id,
    context.project_id,
    scope,
    group.signal,
    group.attributeKey
  ).first<number>("count"));
}

function valueExists(
  db: D1Database,
  context: ApiKeyContext,
  scope: string,
  group: CardinalityGroup,
  valueHash: string
) {
  return dbEffect(() => db.prepare(
    `SELECT value_hash
     FROM ingest_cardinality_values
     WHERE workspace_id = ?
       AND project_id = ?
       AND scope = ?
       AND signal = ?
       AND attribute_key = ?
       AND value_hash = ?`
  ).bind(
    context.workspace_id,
    context.project_id,
    scope,
    group.signal,
    group.attributeKey,
    valueHash
  ).first<string>("value_hash"));
}

function upsertValues(
  db: D1Database,
  context: ApiKeyContext,
  scope: string,
  values: readonly CardinalityValue[]
) {
  if (values.length === 0) return Effect.void;

  const seenAt = now();
  const statements = values.map((value) => db.prepare(
    `INSERT INTO ingest_cardinality_values (
       workspace_id,
       project_id,
       scope,
       signal,
       attribute_key,
       value_hash,
       first_seen_at,
       last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, project_id, scope, signal, attribute_key, value_hash)
     DO UPDATE SET last_seen_at = excluded.last_seen_at`
  ).bind(
    context.workspace_id,
    context.project_id,
    scope,
    value.signal,
    value.attributeKey,
    value.valueHash,
    seenAt,
    seenAt
  ));

  return dbEffect(() => db.batch(statements)).pipe(Effect.asVoid);
}

export function makeIngestCardinalityController(
  db: D1Database,
  env: CardinalityEnv
): IngestCardinalityController {
  return {
    enforce: (context, scope, batch) => Effect.gen(function* () {
      const config = yield* cardinalityConfigFromEnv(env);
      if (config.maxValuesPerKey <= 0) return;

      const values = collectBatchCardinality(batch);
      if (values.length === 0) return;

      const groups = groupValues(values);
      for (const group of groups) {
        const existingCount = yield* countExistingValues(db, context, scope, group);
        let newCount = 0;

        for (const valueHash of group.valueHashes) {
          const existing = yield* valueExists(db, context, scope, group, valueHash);
          if (!existing) newCount += 1;
        }

        if ((existingCount ?? 0) + newCount > config.maxValuesPerKey) {
          return yield* Effect.fail(new ValidationError({
            message: `Cardinality budget exceeded for ${group.signal}.${group.attributeKey}; max ${config.maxValuesPerKey} unique values`,
          }));
        }
      }

      yield* upsertValues(db, context, scope, values);
    }),
  };
}
