import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus, ValidationError } from "@/lib/effect/errors";
import { writeTelemetryQueueMessage, type TelemetryQueueMessage } from "@/lib/effect/telemetry-queue";

function bearerToken(c: Context<{ Bindings: Env }>) {
  const auth = c.req.header("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTelemetryQueueMessage(value: unknown): value is TelemetryQueueMessage {
  if (!record(value)) return false;
  const context = value.context;
  return (
    value.version === 1 &&
    typeof value.id === "string" &&
    typeof value.enqueued_at === "string" &&
    typeof value.signal === "string" &&
    typeof value.required_scope === "string" &&
    record(context) &&
    typeof context.workspace_id === "string" &&
    typeof context.project_id === "string" &&
    record(value.batch) &&
    record(value.counts)
  );
}

async function readJson(c: Context<{ Bindings: Env }>) {
  try {
    return await c.req.json();
  } catch {
    return new ValidationError({ message: "Invalid JSON" });
  }
}

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const expected = c.env.MAINTENANCE_API_KEY;
  if (!expected) return c.json({ error: "Maintenance API not configured" }, 503);
  if (bearerToken(c) !== expected) return c.json({ error: "Unauthorized" }, 401);

  const body = await readJson(c);
  if (body instanceof ValidationError) return c.json({ error: body.message }, 400);
  if (!isTelemetryQueueMessage(body)) {
    return c.json({ error: "Invalid telemetry queue message" }, 400);
  }

  const result = await Effect.runPromise(Effect.either(writeTelemetryQueueMessage(c.env, body)));
  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ replayed: true, id: body.id, counts: body.counts });
};
