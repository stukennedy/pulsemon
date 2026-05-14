import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import {
  errorStatus,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  type IngestError,
} from "@/lib/effect/errors";
import { makeIngestCardinalityController } from "@/lib/effect/cardinality";
import {
  patchConnection as patchConnectionEffect,
  patchSpan as patchSpanEffect,
  postAgentToolCalls as postAgentToolCallsEffect,
  postBatch as postBatchEffect,
  postConnection as postConnectionEffect,
  postEvents as postEventsEffect,
  postLogs as postLogsEffect,
  postMetrics as postMetricsEffect,
  postSpan as postSpanEffect,
  postVoiceTurns as postVoiceTurnsEffect,
  type IngestDeps,
} from "@/lib/effect/ingest";
import { governanceConfigFromEnv } from "@/lib/effect/governance";
import {
  postOtlpLogs as postOtlpLogsEffect,
  postOtlpMetrics as postOtlpMetricsEffect,
  postOtlpTraces as postOtlpTracesEffect,
  type OtlpDeps,
} from "@/lib/effect/otlp";
import { makeD1TelemetryRepository } from "@/lib/effect/repository";
import { makeIngestPressureController } from "@/lib/effect/pressure";
import { tenantScopeFromEnv } from "@/lib/tenant";

function deps(c: Context<{ Bindings: Env }>, requiredScope: string): IngestDeps {
  const repository = makeD1TelemetryRepository(c.env.DB);
  return {
    repository,
    expectedApiKey: c.env.INGEST_API_KEY,
    apiKeys: c.env.INGEST_API_KEYS,
    authorization: c.req.header("Authorization") ?? "",
    requiredScope,
    defaultTenant: tenantScopeFromEnv(c.env),
    pressure: makeIngestPressureController(c.env.DB, c.env),
    governance: governanceConfigFromEnv(c.env),
    cardinality: makeIngestCardinalityController(c.env.DB, c.env),
  };
}

function otlpDeps(c: Context<{ Bindings: Env }>, requiredScope: string): OtlpDeps {
  const repository = makeD1TelemetryRepository(c.env.DB);
  return {
    repository,
    expectedApiKey: c.env.INGEST_API_KEY,
    apiKeys: c.env.INGEST_API_KEYS,
    authorization: c.req.header("Authorization") ?? "",
    requiredScope,
    defaultTenant: tenantScopeFromEnv(c.env),
    pressure: makeIngestPressureController(c.env.DB, c.env),
    governance: governanceConfigFromEnv(c.env),
    cardinality: makeIngestCardinalityController(c.env.DB, c.env),
  };
}

const DEFAULT_INGEST_MAX_BYTES = 1_000_000;

function maxBodyBytes(c: Context<{ Bindings: Env }>) {
  const configured = Number(c.env.INGEST_MAX_BYTES ?? DEFAULT_INGEST_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INGEST_MAX_BYTES;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isJsonContentType(contentType: string) {
  return !contentType ||
    contentType.includes("application/json") ||
    contentType.includes("+json") ||
    contentType.includes("text/json");
}

function decodeTextBody(
  c: Context<{ Bindings: Env }>,
  encoding: string
): Effect.Effect<string, ValidationError | UnsupportedMediaTypeError> {
  if (!encoding || encoding === "identity") {
    return Effect.tryPromise({
      try: () => c.req.text(),
      catch: () => new ValidationError({ message: "Invalid body" }),
    });
  }

  if (encoding !== "gzip") {
    return Effect.fail(new UnsupportedMediaTypeError({
      message: `Unsupported content encoding: ${encoding}`,
    }));
  }

  if (typeof DecompressionStream === "undefined") {
    return Effect.fail(new UnsupportedMediaTypeError({
      message: "gzip request bodies are not supported in this runtime",
    }));
  }

  return Effect.tryPromise({
    try: async () => {
      const stream = c.req.raw.body;
      if (!stream) return "";
      const response = new Response(stream.pipeThrough(new DecompressionStream("gzip")));
      return response.text();
    },
    catch: () => new ValidationError({ message: "Invalid gzip body" }),
  });
}

function readJson(c: Context<{ Bindings: Env }>): Effect.Effect<unknown, ValidationError | PayloadTooLargeError | UnsupportedMediaTypeError> {
  return Effect.gen(function* () {
    const maxBytes = maxBodyBytes(c);
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Payload exceeds ${maxBytes} bytes` }));
    }

    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/x-protobuf")) {
      return yield* Effect.fail(new UnsupportedMediaTypeError({
        message: "OTLP protobuf ingest is not enabled; send OTLP JSON to this endpoint",
      }));
    }
    if (!isJsonContentType(contentType)) {
      return yield* Effect.fail(new UnsupportedMediaTypeError({
        message: `Unsupported content type: ${contentType || "unknown"}`,
      }));
    }

    const encoding = (c.req.header("content-encoding") ?? "").toLowerCase();
    const text = yield* decodeTextBody(c, encoding);

    if (byteLength(text) > maxBytes) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Payload exceeds ${maxBytes} bytes` }));
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return yield* Effect.fail(new ValidationError({ message: "Invalid JSON" }));
    }
  });
}

async function runJson<A>(
  c: Context<{ Bindings: Env }>,
  program: Effect.Effect<A, IngestError>,
  status: ContentfulStatusCode = 200
) {
  const result = await Effect.runPromise(Effect.either(program));
  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }
  return c.json(result.right, status);
}

export const postConnections = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postConnectionEffect(deps(c, "connections"), body))),
    201
  );

export const patchConnection = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => patchConnectionEffect(deps(c, "connections"), c.req.param("id"), body)))
  );

export const postSpans = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postSpanEffect(deps(c, "traces"), body))),
    201
  );

export const patchSpan = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => patchSpanEffect(deps(c, "traces"), c.req.param("id"), body)))
  );

export const postEvents = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postEventsEffect(deps(c, "events"), body))),
    201
  );

export const postMetrics = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postMetricsEffect(deps(c, "metrics"), body))),
    201
  );

export const postLogs = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postLogsEffect(deps(c, "logs"), body))),
    201
  );

export const postVoiceTurns = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postVoiceTurnsEffect(deps(c, "voice"), body))),
    201
  );

export const postAgentToolCalls = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postAgentToolCallsEffect(deps(c, "agent"), body))),
    201
  );

export const postBatch = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postBatchEffect(deps(c, "*"), body))),
    201
  );

export const postOtlpTraces = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postOtlpTracesEffect(otlpDeps(c, "traces"), body))),
    201
  );

export const postOtlpMetrics = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postOtlpMetricsEffect(otlpDeps(c, "metrics"), body))),
    201
  );

export const postOtlpLogs = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postOtlpLogsEffect(otlpDeps(c, "logs"), body))),
    201
  );
