import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import { browserDevice, heatmapType, queryHeatmapPoints, queryScrollMap } from "@/lib/effect/browser-query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export function heatmapDays(value: string | undefined) {
  const days = Number(value);
  return days === 1 || days === 7 || days === 30 ? days : 7;
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 422);
  const device = browserDevice(c.req.query("device")) ?? "desktop";
  const days = heatmapDays(c.req.query("days"));
  const tenant = tenantScopeFromEnv(c.env);

  const result = await Effect.runPromise(Effect.either(Effect.all([
    queryHeatmapPoints(c.env.DB, tenant, { path, device, days, type: heatmapType(c.req.query("type")) }),
    queryScrollMap(c.env.DB, tenant, { path, device, days }),
  ])));
  if (Either.isLeft(result)) {
    return c.json({ error: result.left.message }, errorStatus(result.left) as ContentfulStatusCode);
  }
  const [points, scroll] = result.right;
  return c.json({ points, scroll });
};
