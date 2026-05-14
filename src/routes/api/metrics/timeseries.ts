import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import { queryMetricSeries } from "@/lib/effect/metric-series";
import { tenantScopeFromEnv } from "@/lib/tenant";

function integerQuery(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(queryMetricSeries(
    c.env.DB,
    tenantScopeFromEnv(c.env),
    {
      service: c.req.query("service"),
      metric_name: c.req.query("name"),
      metric_type: c.req.query("type"),
      minutes: integerQuery(c.req.query("minutes")),
      from: c.req.query("from"),
      to: c.req.query("to"),
    }
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json(result.right);
};
