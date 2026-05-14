import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { SearchBar, WsForms } from "@/components/SearchBar";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/metrics" />

      <div id="ws-container" hx-ws-connect="/ws?view=metrics">
        <WsForms />
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
