import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { MonitorTable } from "@/components/MonitorTable";
import { alertConfigFromEnv, processMonitorAlerts } from "@/lib/effect/alerts";
import { errorStatus } from "@/lib/effect/errors";
import { evaluateAndPersistRealtimeMonitors } from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const result = await Effect.runPromise(Effect.either(Effect.gen(function* () {
    const monitors = yield* evaluateAndPersistRealtimeMonitors(c.env.DB, tenant);
    yield* processMonitorAlerts(c.env.DB, tenant, monitors, alertConfigFromEnv(c.env));
    return monitors;
  })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/monitors" />
      <MonitorTable evaluations={result.right} />
    </main>
  );
};
