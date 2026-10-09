import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { BrowserSessionDetailView } from "@/components/BrowserAnalytics";
import { errorStatus } from "@/lib/effect/errors";
import { getBrowserSession } from "@/lib/effect/browser-query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param("id");
  if (id === undefined) return c.notFound();

  const result = await Effect.runPromise(Effect.either(
    getBrowserSession(c.env.DB, tenantScopeFromEnv(c.env), id)
  ));
  if (Either.isLeft(result)) {
    return c.text(result.left.message, errorStatus(result.left) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/replays" />
      <div class="mb-4">
        <a href="/replays" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to replays</a>
      </div>
      <BrowserSessionDetailView session={result.right.session} events={result.right.events} />
    </main>
  );
};
