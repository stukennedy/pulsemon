import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { RecentVoiceTurnsTable, VoiceStageCards } from "@/components/VoicePipeline";
import { VoiceSessionTable } from "@/components/VoiceSessions";
import { VoiceConcurrencyPanel, concurrencyWindowKey, CONCURRENCY_WINDOW_MINUTES } from "@/components/VoiceConcurrencyPanel";
import { errorStatus } from "@/lib/effect/errors";
import {
  queryRecentVoiceTurns,
  queryVoiceSessionSummaries,
  queryVoiceStageStats,
} from "@/lib/effect/sessions";
import { queryVoiceConcurrencyNow, queryVoiceConcurrencyWindow } from "@/lib/effect/voice-concurrency-io";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const windowKey = concurrencyWindowKey(c.req.query("window"));
  const minutes = CONCURRENCY_WINDOW_MINUTES[windowKey];
  // All three legacy views read voice_turns - the canonical voice record. The
  // old page filtered SPANS by an asr./llm./tts. operation-name convention no
  // ingest enforces, so producers reporting turns saw empty cards forever.
  const result = await Effect.runPromise(
    Effect.either(
      Effect.all(
        [
          queryVoiceStageStats(c.env.DB, tenant),
          queryRecentVoiceTurns(c.env.DB, tenant, 25),
          queryVoiceSessionSummaries(c.env.DB, tenant, 100),
          queryVoiceConcurrencyNow(c.env.DB, tenant),
          queryVoiceConcurrencyWindow(c.env.DB, tenant, { minutes }),
        ],
        { concurrency: 3 }
      )
    )
  );

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const [stages, recentTurns, sessions, now, concurrencyWindow] = result.right;

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/voice" />
      <div class="space-y-4">
        {/* Datastar-driven — vendored client only loaded on this page (the
            HTMX pages are untouched, see plan Phase C1). */}
        <script type="module" src="/vendor/datastar-1.0.2.js"></script>
        <VoiceConcurrencyPanel now={now} window={concurrencyWindow} windowKey={windowKey} />
        <VoiceStageCards stages={stages} />
        <VoiceSessionTable sessions={sessions} />
        <RecentVoiceTurnsTable turns={recentTurns} />
      </div>
    </main>
  );
};
