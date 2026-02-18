import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { TraceWaterfall } from "@/components/TraceWaterfall";
import { getTraceSpans } from "@/lib/facets";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const traceId = c.req.param("id");
  const spans = await getTraceSpans(c.env.DB, traceId);

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/traces" />
      <div class="mb-4">
        <a href="/traces" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to traces</a>
      </div>
      <TraceWaterfall spans={spans} traceId={traceId} />
    </main>
  );
};
