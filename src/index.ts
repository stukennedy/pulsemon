import { Hono } from "hono";
import { Effect } from "effect";
import type { Env } from "./types";
import { loadLayouts } from "./layouts";
import { loadRoutes } from "./router";
import { checkUiAuth } from "./lib/auth";
import { runMaintenanceFromEnv } from "./lib/effect/maintenance";

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
    ctx.waitUntil(Effect.runPromise(runMaintenanceFromEnv(env)));
  },
};

export default handler;
