import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { SearchBar, WsForms } from "@/components/SearchBar";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/connections" />

      <div id="ws-container" hx-ws-connect="/ws?view=connections">
        <WsForms />

        {/* Stats bar placeholder */}
        <div id="stats-bar" class="mb-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map(() => (
              <div class="stat-card">
                <div class="h-2 rounded mb-3" style="background:rgba(255,255,255,0.05);width:60%" />
                <div class="h-6 rounded" style="background:rgba(255,255,255,0.04);width:80%" />
              </div>
            ))}
          </div>
        </div>

        <SearchBar />

        <div id="connection-table">
          <div class="rounded-lg p-12 text-center border" style="background:rgba(255,255,255,0.02);border-color:rgba(255,255,255,0.06)">
            <div class="flex flex-col items-center gap-2">
              <div class="w-1.5 h-1.5 rounded-full" style="background:#22d3ee;animation:pulse 1.5s ease-in-out infinite" />
              <span class="text-xs text-gray-600" style="font-family:'IBM Plex Mono',monospace">Connecting…</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
