import type { Context } from "hono";
import type { Env } from "@/types";
import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardWidgets";
import { queryDashboardStats } from "@/lib/stats";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const stats = await queryDashboardStats(c.env.DB);
  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/" />
      <DashboardView stats={stats} />
    </main>
  );
};
