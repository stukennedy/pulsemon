import { Hono } from "hono";
import type { Env } from "./types";
import { loadLayouts } from "./layouts";
import { loadRoutes } from "./router";
import { checkUiAuth } from "./lib/auth";

export { SearchSession } from "./lib/search-session";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const authResponse = checkUiAuth(c);
  if (authResponse) return authResponse;
  await next();
});

loadLayouts(app);
loadRoutes(app);

export default app;
