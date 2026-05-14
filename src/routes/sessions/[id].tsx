import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoiceSessionDetailView } from "@/components/VoiceSessions";
import { errorStatus } from "@/lib/effect/errors";
import { getRealtimeSession } from "@/lib/effect/sessions";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const sessionId = c.req.param("id");
  const result = await Effect.runPromise(Effect.either(
    getRealtimeSession(c.env.DB, tenantScopeFromEnv(c.env), sessionId)
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/voice" />
      <div class="mb-4">
        <a href="/voice" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to voice</a>
      </div>
      <VoiceSessionDetailView detail={result.right} sessionId={sessionId} />
    </main>
  );
};
