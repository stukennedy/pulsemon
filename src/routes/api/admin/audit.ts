import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { queryAuditEvents } from "@/lib/effect/audit";
import { errorStatus } from "@/lib/effect/errors";
import { tenantScopeFromEnv } from "@/lib/tenant";

function limitParam(c: Context<{ Bindings: Env }>) {
  const raw = c.req.query("limit");
  return raw === undefined || raw.trim() === "" ? undefined : Number(raw);
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const principal = requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const result = await Effect.runPromise(Effect.either(
    queryAuditEvents(c.env.DB, tenantScopeFromEnv(c.env), { limit: limitParam(c) })
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ events: result.right });
};
