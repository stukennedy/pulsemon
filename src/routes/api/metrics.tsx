import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { ActiveTag, Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import {
  makeD1TelemetryQueryRepository,
  queryMetricOverview,
} from "@/lib/effect/query";
import { MetricTable } from "@/components/MetricTable";

function parseTags(s: string): ActiveTag[] {
  if (!s) return [];
  return s.split("|").map((t) => {
    const i = t.indexOf(":");
    return i < 0 ? null : { facet: t.slice(0, i), value: t.slice(i + 1) };
  }).filter(Boolean) as ActiveTag[];
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tags = parseTags(c.req.query("tags") || "");
  const result = await Effect.runPromise(Effect.either(queryMetricOverview(
    { repository: makeD1TelemetryQueryRepository(c.env.DB) },
    tags
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const { metrics, summaries, total } = result.right;
  return c.html(<MetricTable metrics={metrics} summaries={summaries} total={total} />);
};
