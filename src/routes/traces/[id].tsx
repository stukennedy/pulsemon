import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { TraceWaterfall } from "@/components/TraceWaterfall";
import { errorStatus } from "@/lib/effect/errors";
import {
  getTraceSpans,
  makeD1TelemetryQueryRepository,
} from "@/lib/effect/query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const traceId = c.req.param("id");
  const result = await Effect.runPromise(Effect.either(getTraceSpans(
    { repository: makeD1TelemetryQueryRepository(c.env.DB, tenantScopeFromEnv(c.env)) },
    traceId
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const spans = result.right;

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/traces" />
      <div class="mb-4">
        <a href="/traces" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to traces</a>
      </div>
      <TraceWaterfall spans={spans} traceId={traceId} />
    </main>
  );
};
