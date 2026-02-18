import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { ConnectionDetail } from "@/components/ConnectionDetail";
import { getConnectionDetail } from "@/lib/facets";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param("id");
  const { connection, events, spans } = await getConnectionDetail(c.env.DB, id);

  if (!connection) {
    return c.render(
      <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
        <Nav active="/connections" />
        <div class="rounded-lg p-12 text-center" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
          <span class="text-xs font-mono" style="color:#334155">Connection not found: {id}</span>
        </div>
      </main>
    );
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/connections" />
      <div class="mb-4">
        <a href="/connections" class="text-xs font-mono text-cyan-400 hover:text-cyan-300">← Back to connections</a>
      </div>
      <ConnectionDetail connection={connection} events={events} spans={spans} />
    </main>
  );
};
