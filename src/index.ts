import { Hono } from "hono";
import { Effect } from "effect";
import type { Env } from "./types";
import { loadLayouts } from "./layouts";
import { loadRoutes } from "./router";
import { checkUiAuth } from "./lib/auth";
import { alertConfigFromEnv, processMonitorAlerts } from "./lib/effect/alerts";
import { runMaintenanceFromEnv } from "./lib/effect/maintenance";
import { evaluateAndPersistRealtimeMonitors } from "./lib/effect/monitors";
import { tenantScopeFromEnv } from "./lib/tenant";

export { SearchSession } from "./lib/search-session";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const authResponse = checkUiAuth(c);
  if (authResponse) return authResponse;
  await next();
});

loadLayouts(app);
loadRoutes(app);

const handler: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    const tenant = tenantScopeFromEnv(env);
    ctx.waitUntil(Effect.runPromise(Effect.all([
      runMaintenanceFromEnv(env),
      Effect.gen(function* () {
        const monitors = yield* evaluateAndPersistRealtimeMonitors(env.DB, tenant);
        return yield* processMonitorAlerts(env.DB, tenant, monitors, alertConfigFromEnv(env));
      }),
    ], { concurrency: 1 })));
  },
};

export default handler;
