import type { FC } from "hono/jsx";
import type { ConnectionStats } from "@/lib/stats";

export const ConnectionStatsBar: FC<{ stats: ConnectionStats }> = ({ stats }) => {
  const errorRateColor = stats.errorRate > 10 ? "text-rose-400" : stats.errorRate > 3 ? "text-amber-400" : "text-emerald-400";

  return (
    <div id="stats-bar" class="mb-4 fade-in">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="stat-card">
          <div class="stat-label">Total</div>
          <div class="stat-value text-white">{stats.total.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active</div>
          <div class="stat-value text-emerald-400">{stats.active.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Errors</div>
          <div class={`stat-value ${stats.errorCount > 0 ? "text-rose-400" : "text-gray-500"}`}>
            {stats.errorCount.toLocaleString()}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Error Rate</div>
          <div class={`stat-value ${errorRateColor}`}>{stats.errorRate.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
};
