import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { ActiveTag, Env } from "@/types";
import { errorStatus } from "@/lib/effect/errors";
import {
  makeD1TelemetryQueryRepository,
  queryConnections,
} from "@/lib/effect/query";
import { tenantScopeFromEnv } from "@/lib/tenant";
import { ConnectionTable } from "@/components/ConnectionTable";

function parseTags(s: string): ActiveTag[] {
  if (!s) return [];
  return s.split("|").map((t) => {
    const i = t.indexOf(":");
    return i < 0 ? null : { facet: t.slice(0, i), value: t.slice(i + 1) };
  }).filter(Boolean) as ActiveTag[];
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tags = parseTags(c.req.query("tags") || "");
  const result = await Effect.runPromise(Effect.either(queryConnections(
    { repository: makeD1TelemetryQueryRepository(c.env.DB, tenantScopeFromEnv(c.env)) },
    tags
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const { connections, total } = result.right;
  return c.html(<ConnectionTable connections={connections} total={total} />);
};
