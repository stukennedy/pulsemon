import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { MetricTimeseriesChart } from "@/components/MetricTimeseriesChart";
import { SearchBar, WsForms } from "@/components/SearchBar";
import { errorStatus } from "@/lib/effect/errors";
import { queryMetricSeries } from "@/lib/effect/metric-series";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(
    queryMetricSeries(c.env.DB, tenantScopeFromEnv(c.env), { minutes: 60 })
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/metrics" />

      <div id="ws-container" hx-ws-connect="/ws?view=metrics">
        <WsForms />
        <div class="mb-4">
          <MetricTimeseriesChart series={result.right} />
        </div>
        <SearchBar placeholder="Filter metrics... service:voice-gateway  name:voice.latency_ms  type:histogram" />

        <div id="metric-table">
          <div class="rounded-lg p-12 text-center border" style="background:rgba(255,255,255,0.02);border-color:rgba(255,255,255,0.06)">
            <div class="flex flex-col items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full" style="background:#22d3ee;animation:pulse 1.5s ease-in-out infinite" />
              <span class="text-xs text-gray-600" style="font-family:'IBM Plex Mono',monospace">Connecting...</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
