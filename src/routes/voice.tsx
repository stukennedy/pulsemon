import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoicePipelineView } from "@/components/VoicePipeline";
import { VoiceSessionTable } from "@/components/VoiceSessions";
import { errorStatus } from "@/lib/effect/errors";
import {
  makeD1TelemetryQueryRepository,
  querySpans,
} from "@/lib/effect/query";
import { queryVoiceSessionSummaries } from "@/lib/effect/sessions";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const result = await Effect.runPromise(Effect.either(Effect.all([
    querySpans(
    { repository: makeD1TelemetryQueryRepository(c.env.DB, tenantScopeFromEnv(c.env)) },
    [],
    { limit: 500 }
    ),
    queryVoiceSessionSummaries(c.env.DB, tenant, 100),
  ], { concurrency: 2 })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const [{ spans }, sessions] = result.right;
  const voiceSpans = spans.filter((s) =>
    ["asr", "llm", "tts"].some((prefix) => s.operation.startsWith(prefix))
  );

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/voice" />
      <div class="space-y-4">
        <VoicePipelineView spans={voiceSpans} />
        <VoiceSessionTable sessions={sessions} />
      </div>
    </main>
  );
};
