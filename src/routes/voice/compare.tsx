import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoiceCompareView } from "@/components/VoiceCompare";
import { errorStatus } from "@/lib/effect/errors";
import {
  BASELINE_KEY,
  compareVoiceSessions,
  DEFAULT_BASELINE_DAYS,
  type CompareReference,
  type VoiceSessionComparison,
} from "@/lib/effect/session-compare";
import { queryVoiceSessionSummaries } from "@/lib/effect/sessions";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const candidateId = c.req.query("a")?.trim() ?? "";
  const referenceId = c.req.query("b")?.trim() || BASELINE_KEY;
  // Range validation happens in the service; the route only parses.
  const days = Number(c.req.query("days") ?? DEFAULT_BASELINE_DAYS);

  const reference: CompareReference = referenceId === BASELINE_KEY
    ? { kind: "baseline", days }
    : { kind: "session", session_id: referenceId };

  const result = await Effect.runPromise(Effect.either(Effect.all({
    sessions: queryVoiceSessionSummaries(c.env.DB, tenant, 100),
    comparison: candidateId
      ? compareVoiceSessions(c.env.DB, tenant, candidateId, reference)
      : Effect.succeed<VoiceSessionComparison | null>(null),
  }, { concurrency: 2 })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/voice" />
      <VoiceCompareView
        sessions={result.right.sessions}
        candidateId={candidateId}
        referenceId={referenceId}
        baselineDays={Number.isFinite(days) ? days : DEFAULT_BASELINE_DAYS}
        comparison={result.right.comparison}
      />
    </main>
  );
};
