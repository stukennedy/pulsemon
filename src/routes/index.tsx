import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardWidgets";
import { errorStatus } from "@/lib/effect/errors";
import {
  makeD1TelemetryQueryRepository,
  queryDashboardStats,
} from "@/lib/effect/query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(queryDashboardStats({
    repository: makeD1TelemetryQueryRepository(c.env.DB, tenantScopeFromEnv(c.env)),
  })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const stats = result.right;
  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/" />
      <DashboardView stats={stats} />
    </main>
  );
};
