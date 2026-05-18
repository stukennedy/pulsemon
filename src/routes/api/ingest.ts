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
import {
  enqueueAgentToolCalls,
  enqueueBatch,
  enqueueConnection,
  enqueueConnectionPatch,
  enqueueEvents,
  enqueueLogs,
  enqueueMetrics,
  enqueueOtlpLogs,
  enqueueOtlpMetrics,
  enqueueOtlpTraces,
  enqueueSpan,
  enqueueSpanPatch,
  enqueueVoiceTurns,
  type QueuedIngestDeps,
  type TelemetryQueueMessage,
} from "@/lib/effect/telemetry-queue";
import {
  decodeOtlpLogsProtobuf,
  decodeOtlpMetricsProtobuf,
  decodeOtlpTracesProtobuf,
} from "@/lib/effect/otlp-protobuf";
import { makeD1TelemetryRepository } from "@/lib/effect/repository";
import { makeIngestPressureController } from "@/lib/effect/pressure";
import { tenantScopeFromEnv } from "@/lib/tenant";

function directD1BatchOperationLimit(env: Env) {
  const raw = env.INGEST_DIRECT_D1_MAX_BATCH_OPERATIONS;
  if (raw === undefined || raw.trim() === "") return undefined;
  return Number(raw);
}

function deps(c: Context<{ Bindings: Env }>, requiredScope: string): IngestDeps {
  const repository = makeD1TelemetryRepository(c.env.DB);
  return {
    repository,
    expectedApiKey: c.env.INGEST_API_KEY,
    apiKeys: c.env.INGEST_API_KEYS,
    authorization: c.req.header("Authorization") ?? "",
    requiredScope,
    defaultTenant: tenantScopeFromEnv(c.env),
    maxBatchOperations: directD1BatchOperationLimit(c.env),
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

function queuedDeps(c: Context<{ Bindings: Env }>, requiredScope: string): QueuedIngestDeps {
  return {
    expectedApiKey: c.env.INGEST_API_KEY,
    apiKeys: c.env.INGEST_API_KEYS,
    authorization: c.req.header("Authorization") ?? "",
    requiredScope,
    defaultTenant: tenantScopeFromEnv(c.env),
    queue: c.env.TELEMETRY_QUEUE as Queue<TelemetryQueueMessage> | undefined,
    governance: governanceConfigFromEnv(c.env),
    sampleRate: c.env.INGEST_SAMPLE_RATE,
    queueMaxBytes: c.env.INGEST_QUEUE_MAX_BYTES,
    queueMaxOperations: c.env.INGEST_QUEUE_MAX_OPERATIONS,
  };
}

function isQueuedMode(c: Context<{ Bindings: Env }>) {
  return (c.env.INGEST_MODE ?? "direct").toLowerCase() === "queued";
}

function ingestProgram(
  c: Context<{ Bindings: Env }>,
  queued: () => Effect.Effect<unknown, IngestError>,
  direct: () => Effect.Effect<unknown, IngestError>
): Effect.Effect<unknown, IngestError> {
  return isQueuedMode(c) ? queued() : direct();
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

function isProtobufContentType(contentType: string) {
  return contentType.includes("application/x-protobuf") ||
    contentType.includes("application/protobuf");
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

function decodeBinaryBody(
  c: Context<{ Bindings: Env }>,
  encoding: string
): Effect.Effect<Uint8Array, ValidationError | UnsupportedMediaTypeError> {
  if (!encoding || encoding === "identity") {
    return Effect.tryPromise({
      try: async () => new Uint8Array(await c.req.arrayBuffer()),
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
      if (!stream) return new Uint8Array();
      const response = new Response(stream.pipeThrough(new DecompressionStream("gzip")));
      return new Uint8Array(await response.arrayBuffer());
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
    if (isProtobufContentType(contentType)) {
      return yield* Effect.fail(new UnsupportedMediaTypeError({
        message: "Protobuf ingest is only supported on OTLP routes",
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

function readOtlp(
  c: Context<{ Bindings: Env }>,
  decodeProtobuf: (bytes: Uint8Array) => unknown
): Effect.Effect<unknown, ValidationError | PayloadTooLargeError | UnsupportedMediaTypeError> {
  return Effect.gen(function* () {
    const maxBytes = maxBodyBytes(c);
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Payload exceeds ${maxBytes} bytes` }));
    }

    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    if (!isProtobufContentType(contentType)) {
      return yield* readJson(c);
    }

    const encoding = (c.req.header("content-encoding") ?? "").toLowerCase();
    const bytes = yield* decodeBinaryBody(c, encoding);
    if (bytes.byteLength > maxBytes) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Payload exceeds ${maxBytes} bytes` }));
    }

    try {
      return decodeProtobuf(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid OTLP protobuf";
      return yield* Effect.fail(new ValidationError({ message: `Invalid OTLP protobuf: ${message}` }));
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
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueConnection(queuedDeps(c, "connections"), body),
      () => postConnectionEffect(deps(c, "connections"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const patchConnection = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueConnectionPatch(queuedDeps(c, "connections"), c.req.param("id"), body),
      () => patchConnectionEffect(deps(c, "connections"), c.req.param("id"), body)
    ))),
    isQueuedMode(c) ? 202 : 200
  );

export const postSpans = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueSpan(queuedDeps(c, "traces"), body),
      () => postSpanEffect(deps(c, "traces"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const patchSpan = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueSpanPatch(queuedDeps(c, "traces"), c.req.param("id"), body),
      () => patchSpanEffect(deps(c, "traces"), c.req.param("id"), body)
    ))),
    isQueuedMode(c) ? 202 : 200
  );

export const postEvents = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueEvents(queuedDeps(c, "events"), body),
      () => postEventsEffect(deps(c, "events"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postMetrics = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueMetrics(queuedDeps(c, "metrics"), body),
      () => postMetricsEffect(deps(c, "metrics"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postLogs = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueLogs(queuedDeps(c, "logs"), body),
      () => postLogsEffect(deps(c, "logs"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postVoiceTurns = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueVoiceTurns(queuedDeps(c, "voice"), body),
      () => postVoiceTurnsEffect(deps(c, "voice"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postAgentToolCalls = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueAgentToolCalls(queuedDeps(c, "agent"), body),
      () => postAgentToolCallsEffect(deps(c, "agent"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postBatch = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueBatch(queuedDeps(c, "*"), body),
      () => postBatchEffect(deps(c, "*"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postOtlpTraces = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readOtlp(c, decodeOtlpTracesProtobuf).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueOtlpTraces(queuedDeps(c, "traces"), body),
      () => postOtlpTracesEffect(otlpDeps(c, "traces"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postOtlpMetrics = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readOtlp(c, decodeOtlpMetricsProtobuf).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueOtlpMetrics(queuedDeps(c, "metrics"), body),
      () => postOtlpMetricsEffect(otlpDeps(c, "metrics"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );

export const postOtlpLogs = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readOtlp(c, decodeOtlpLogsProtobuf).pipe(Effect.flatMap((body) => ingestProgram(
      c,
      () => enqueueOtlpLogs(queuedDeps(c, "logs"), body),
      () => postOtlpLogsEffect(otlpDeps(c, "logs"), body)
    ))),
    isQueuedMode(c) ? 202 : 201
  );
