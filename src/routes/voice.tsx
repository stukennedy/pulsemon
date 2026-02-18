import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { VoicePipelineView } from "@/components/VoicePipeline";
import { querySpans } from "@/lib/facets";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  // Get all voice-related spans
  const { spans } = await querySpans(c.env.DB, [], 500);
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
