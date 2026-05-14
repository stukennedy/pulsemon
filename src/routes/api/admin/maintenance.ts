import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import { runMaintenanceFromEnv } from "@/lib/effect/maintenance";

function maintenanceAuth(c: Context<{ Bindings: Env }>) {
  const expected = c.env.MAINTENANCE_API_KEY;
  if (!expected) return c.json({ error: "Maintenance API not configured" }, 503);

  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== expected) return c.json({ error: "Unauthorized" }, 401);

  return null;
}

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const authResponse = maintenanceAuth(c);
  if (authResponse) return authResponse;

  const result = await Effect.runPromise(Effect.either(runMaintenanceFromEnv(c.env)));
  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json(result.right);
};
