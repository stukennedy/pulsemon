import type { FC } from "hono/jsx";
import type { DashboardStats } from "@/lib/stats";

const Sparkline: FC<{ data: { day: string; count: number }[]; color?: string }> = ({ data, color = "#22d3ee" }) => {
  const W = 200, H = 36, PAD = 3;
  if (!data.length) return <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-9" />;

  const max = Math.max(...data.map((d) => d.count), 1);
  const pts = data.map((d, i) => ({
    x: PAD + (i / Math.max(data.length - 1, 1)) * (W - 2 * PAD),
    y: PAD + ((max - d.count) / max) * (H - 2 * PAD),
  }));

  const linePts = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fillD = [
    `M ${pts[0].x.toFixed(1)},${H}`,
    ...pts.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L ${pts[pts.length - 1].x.toFixed(1)},${H} Z`,
  ].join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-9" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.3" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#sg)" />
      <polyline points={linePts} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
};

export const DashboardView: FC<{ stats: DashboardStats }> = ({ stats }) => {
  const errorRateColor = stats.errorRate > 10 ? "text-rose-400" : stats.errorRate > 3 ? "text-amber-400" : "text-emerald-400";

  return (
    <div id="dashboard-content" class="space-y-4 fade-in">
      {/* Top metrics */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="stat-card">
          <div class="stat-label">Active Connections</div>
          <div class="stat-value text-emerald-400">{stats.activeConnections.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Connections</div>
          <div class="stat-value text-white">{stats.totalConnections.toLocaleString()}</div>
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

      {/* Latency metrics */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {["asr", "llm", "tts"].map((op) => {
          const labels: Record<string, string> = { asr: "ASR", llm: "LLM", tts: "TTS" };
          const colors: Record<string, string> = { asr: "#22d3ee", llm: "#818cf8", tts: "#f59e0b" };
          return (
            <div class="stat-card">
              <div class="stat-label mb-2">{labels[op]} Latency</div>
              <div class="grid grid-cols-3 gap-2">
                <div>
                  <div class="text-[10px] font-mono" style="color:#374151">P50</div>
                  <div class="text-sm font-mono font-semibold" style={`color:${colors[op]}`}>
                    {stats.p50Latency[op] != null ? `${stats.p50Latency[op]}ms` : "—"}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-mono" style="color:#374151">P95</div>
                  <div class="text-sm font-mono font-semibold" style="color:#f59e0b">
                    {stats.p95Latency[op] != null ? `${stats.p95Latency[op]}ms` : "—"}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-mono" style="color:#374151">P99</div>
                  <div class="text-sm font-mono font-semibold" style="color:#f97316">
                    {stats.p99Latency[op] != null ? `${stats.p99Latency[op]}ms` : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Service breakdown */}
        <div class="stat-card">
          <div class="stat-label mb-3">Services</div>
          <div class="flex flex-col gap-2">
            {stats.serviceBreakdown.map((s) => {
              const maxCount = Math.max(...stats.serviceBreakdown.map((x) => x.count), 1);
              const pct = (s.count / maxCount) * 100;
              return (
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-mono text-gray-400 w-24 text-right shrink-0 truncate">{s.service}</span>
                  <div class="flex-1 rounded-full h-1.5 overflow-hidden" style="background:rgba(255,255,255,0.05)">
                    <div class="h-full rounded-full" style={`width:${pct.toFixed(1)}%;background:#22d3ee`} />
                  </div>
                  <span class="text-[10px] font-mono text-gray-600 w-10 shrink-0">{s.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Connection volume */}
        <div class="stat-card">
          <div class="stat-label mb-2">Connections — last 14 days</div>
          <Sparkline data={stats.connectionsByDay} />
        </div>

        {/* Type distribution */}
        <div class="stat-card">
          <div class="stat-label mb-3">Connection Types</div>
          {(() => {
            const total = stats.typeBreakdown.reduce((s, t) => s + t.count, 0) || 1;
            const colors: Record<string, string> = { ws: "#8b5cf6", sse: "#22d3ee", grpc: "#f59e0b" };
            return (
              <>
                <div class="flex rounded-full overflow-hidden h-2 gap-px mb-3" style="background:#0a0c14">
                  {stats.typeBreakdown.map((t) => {
                    const pct = (t.count / total) * 100;
                    return pct > 0.5 ? (
                      <div style={`width:${pct.toFixed(1)}%;background:${colors[t.type] || "#64748b"}`} title={`${t.type}: ${t.count}`} />
                    ) : null;
                  })}
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  {stats.typeBreakdown.map((t) => {
                    const pct = ((t.count / total) * 100).toFixed(0);
                    return (
                      <div class="flex items-center gap-1.5">
                        <div class="w-1.5 h-1.5 rounded-full" style={`background:${colors[t.type] || "#64748b"}`} />
                        <span class="text-[11px] font-mono text-gray-400 uppercase">{t.type}</span>
                        <span class="text-[11px] font-mono text-gray-600">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
