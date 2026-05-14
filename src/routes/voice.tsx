import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoicePipelineView } from "@/components/VoicePipeline";
import { errorStatus } from "@/lib/effect/errors";
import {
  makeD1TelemetryQueryRepository,
  querySpans,
} from "@/lib/effect/query";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(querySpans(
    { repository: makeD1TelemetryQueryRepository(c.env.DB) },
    [],
    { limit: 500 }
  )));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  const { spans } = result.right;
  const voiceSpans = spans.filter((s) =>
    ["asr", "llm", "tts"].some((prefix) => s.operation.startsWith(prefix))
  );

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/voice" />
      <VoicePipelineView spans={voiceSpans} />
    </main>
  );
};
