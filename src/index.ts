import { Hono } from "hono";
import type { Env } from "./types";
import { loadLayouts } from "./layouts";
import { loadRoutes } from "./router";

export { SearchSession } from "./lib/search-session";

const app = new Hono<{ Bindings: Env }>();

loadLayouts(app);
loadRoutes(app);

export default app;
