import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { alertConfigFromEnv, processMonitorAlerts } from "@/lib/effect/alerts";
import { errorStatus } from "@/lib/effect/errors";
import { evaluateAndPersistRealtimeMonitors } from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const result = await Effect.runPromise(Effect.either(Effect.gen(function* () {
    const monitors = yield* evaluateAndPersistRealtimeMonitors(c.env.DB, tenant);
    const alerts = yield* processMonitorAlerts(c.env.DB, tenant, monitors, alertConfigFromEnv(c.env));
    return { monitors, alerts };
  })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json(result.right);
};
