import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { BrowserSessionTable } from "@/components/BrowserAnalytics";
import { errorStatus } from "@/lib/effect/errors";
import { browserDevice, listBrowserSessions, type BrowserSessionFilters } from "@/lib/effect/browser-query";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const filters: BrowserSessionFilters = {
    path: c.req.query("path")?.trim() || undefined,
    userId: c.req.query("user")?.trim() || undefined,
    device: browserDevice(c.req.query("device")),
    frustrated: c.req.query("frustrated") === "1",
  };
  const result = await Effect.runPromise(Effect.either(
    listBrowserSessions(c.env.DB, tenantScopeFromEnv(c.env), filters)
  ));
  if (Either.isLeft(result)) {
    return c.text(result.left.message, errorStatus(result.left) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/replays" />
      <BrowserSessionTable sessions={result.right} filters={filters} />
    </main>
  );
};
