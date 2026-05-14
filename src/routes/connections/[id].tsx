import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { ConnectionDetail } from "@/components/ConnectionDetail";
import { errorStatus } from "@/lib/effect/errors";
import {
  getConnectionDetail,
  makeD1TelemetryQueryRepository,
} from "@/lib/effect/query";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param("id");
  const result = await Effect.runPromise(Effect.either(getConnectionDetail(
    { repository: makeD1TelemetryQueryRepository(c.env.DB) },
    id
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const { connection, events, spans } = result.right;

  if (!connection) {
    return c.render(
      <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
        <Nav active="/connections" />
        <div class="rounded-lg p-12 text-center" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
          <span class="text-xs font-mono" style="color:#334155">Connection not found: {id}</span>
        </div>
      </main>
    );
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/connections" />
      <div class="mb-4">
        <a href="/connections" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to connections</a>
      </div>
      <ConnectionDetail connection={connection} events={events} spans={spans} />
    </main>
  );
};
