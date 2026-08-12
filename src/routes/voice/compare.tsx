import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoiceCompareView } from "@/components/VoiceCompare";
import { errorStatus } from "@/lib/effect/errors";
import {
  BASELINE_REFERENCE_VALUE,
  compareVoiceSessions,
  DEFAULT_BASELINE_DAYS,
  parseCompareReference,
  type VoiceSessionComparison,
} from "@/lib/effect/session-compare";
import { queryVoiceSessionSummaries } from "@/lib/effect/sessions";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const candidateId = c.req.query("a")?.trim() ?? "";
  const referenceValue = c.req.query("reference")?.trim() || BASELINE_REFERENCE_VALUE;
  // Range validation happens in the service; the route only parses.
  const days = Number(c.req.query("days") ?? DEFAULT_BASELINE_DAYS);

  const result = await Effect.runPromise(Effect.either(Effect.gen(function* () {
    const reference = yield* parseCompareReference(referenceValue, days);
    return yield* Effect.all({
      sessions: queryVoiceSessionSummaries(c.env.DB, tenant, 100),
      comparison: candidateId
        ? compareVoiceSessions(c.env.DB, tenant, candidateId, reference)
        : Effect.succeed<VoiceSessionComparison | null>(null),
    }, { concurrency: 2 });
  })));

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
        referenceValue={referenceValue}
        baselineDays={Number.isFinite(days) ? days : DEFAULT_BASELINE_DAYS}
        comparison={result.right.comparison}
      />
    </main>
  );
};
