import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import { replayChunkKeys, streamReplayEvents } from "@/lib/effect/browser-query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param("id");
  if (id === undefined) return c.notFound();
  const bucket = c.env.RAW_TELEMETRY;
  if (!bucket) return c.json({ error: "Session replay storage is not configured" }, 503);

  const keys = await Effect.runPromise(Effect.either(replayChunkKeys(c.env.DB, tenantScopeFromEnv(c.env), id)));
  if (Either.isLeft(keys)) {
    return c.json({ error: keys.left.message }, errorStatus(keys.left) as ContentfulStatusCode);
  }

  return new Response(streamReplayEvents(bucket, keys.right), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
  });
};
