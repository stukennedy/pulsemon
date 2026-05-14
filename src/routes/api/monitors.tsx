import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import { evaluateAndPersistRealtimeMonitors } from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(
    evaluateAndPersistRealtimeMonitors(c.env.DB, tenantScopeFromEnv(c.env))
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ monitors: result.right });
};
