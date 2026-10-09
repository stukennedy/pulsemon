import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { HeatmapView } from "@/components/BrowserAnalytics";
import { errorStatus } from "@/lib/effect/errors";
import { browserDevice, heatmapType, queryBrowserPages, queryHeatmapSnapshot } from "@/lib/effect/browser-query";
import { tenantScopeFromEnv } from "@/lib/tenant";
import { heatmapDays } from "@/routes/api/heatmaps";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const path = c.req.query("path") || undefined;
  const device = browserDevice(c.req.query("device")) ?? "desktop";
  const rawType = c.req.query("type");
  const type = rawType === "scroll" ? "scroll" : heatmapType(rawType);
  const days = heatmapDays(c.req.query("days"));

  const result = await Effect.runPromise(Effect.either(Effect.all([
    queryBrowserPages(c.env.DB, tenant, days),
    path ? queryHeatmapSnapshot(c.env.DB, tenant, path, device) : Effect.succeed(null),
  ])));
  if (Either.isLeft(result)) {
    return c.text(result.left.message, errorStatus(result.left) as ContentfulStatusCode);
  }
  const [pages, snapshot] = result.right;

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/heatmaps" />
      <HeatmapView pages={pages} path={path} device={device} type={type} days={days} snapshot={snapshot} />
    </main>
  );
};
