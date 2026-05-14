import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import {
  errorStatus,
  ValidationError,
  type IngestError,
} from "@/lib/effect/errors";
import {
  patchConnection as patchConnectionEffect,
  patchSpan as patchSpanEffect,
  postBatch as postBatchEffect,
  postConnection as postConnectionEffect,
  postEvents as postEventsEffect,
  postMetrics as postMetricsEffect,
  postSpan as postSpanEffect,
  type IngestDeps,
} from "@/lib/effect/ingest";
import { makeD1TelemetryRepository } from "@/lib/effect/repository";

function deps(c: Context<{ Bindings: Env }>): IngestDeps {
  return {
    repository: makeD1TelemetryRepository(c.env.DB),
    expectedApiKey: c.env.INGEST_API_KEY,
    authorization: c.req.header("Authorization") ?? "",
  };
}

function readJson(c: Context<{ Bindings: Env }>): Effect.Effect<unknown, ValidationError> {
  return Effect.tryPromise({
    try: () => c.req.json() as Promise<unknown>,
    catch: () => new ValidationError({ message: "Invalid JSON" }),
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
    readJson(c).pipe(Effect.flatMap((body) => postConnectionEffect(deps(c), body))),
    201
  );

export const patchConnection = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => patchConnectionEffect(deps(c), c.req.param("id"), body)))
  );

export const postSpans = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postSpanEffect(deps(c), body))),
    201
  );

export const patchSpan = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => patchSpanEffect(deps(c), c.req.param("id"), body)))
  );

export const postEvents = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postEventsEffect(deps(c), body))),
    201
  );

export const postMetrics = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postMetricsEffect(deps(c), body))),
    201
  );

export const postBatch = (c: Context<{ Bindings: Env }>) =>
  runJson(
    c,
    readJson(c).pipe(Effect.flatMap((body) => postBatchEffect(deps(c), body))),
    201
  );
