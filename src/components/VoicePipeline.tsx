import type { FC } from "hono/jsx";
import type { Span } from "@/types";
import { durationColor, formatDuration } from "./StatusBadge";

interface PipelineStage {
  name: string;
  operation: string;
  color: string;
  spans: Span[];
}

const STAGES: Omit<PipelineStage, "spans">[] = [
  { name: "ASR", operation: "asr", color: "#22d3ee" },
  { name: "LLM", operation: "llm", color: "#818cf8" },
  { name: "TTS", operation: "tts", color: "#f59e0b" },
];

export const VoicePipelineView: FC<{ spans: Span[] }> = ({ spans }) => {
  // Group spans by pipeline stage
  const stages: PipelineStage[] = STAGES.map((s) => ({
    ...s,
    spans: spans.filter((sp) => sp.operation.startsWith(s.operation)),
  }));

  // Calculate average latencies per stage
  const stageStats = stages.map((stage) => {
    const durations = stage.spans.filter((s) => s.duration_ms != null).map((s) => s.duration_ms!);
    durations.sort((a, b) => a - b);
    const avg = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const p50 = durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : null;
    const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : null;
    const errors = stage.spans.filter((s) => s.status === "error").length;
    return { ...stage, avg, p50, p95, count: durations.length, errors };
  });

  // Group by trace_id to show pipeline flows
  const traceMap = new Map<string, Span[]>();
  for (const span of spans) {
    const arr = traceMap.get(span.trace_id) ?? [];
    arr.push(span);
    traceMap.set(span.trace_id, arr);
  }

  // Get recent pipeline traces (traces that have at least ASR + LLM)
  const pipelines = Array.from(traceMap.entries())
    .filter(([, traceSpans]) => {
      const ops = traceSpans.map((s) => s.operation.split(".")[0]);
      return ops.includes("asr") && ops.includes("llm");
    })
    .slice(0, 20)
    .map(([traceId, traceSpans]) => {
      const totalDuration = traceSpans.reduce((sum, s) => sum + (s.duration_ms || 0), 0);
      const hasError = traceSpans.some((s) => s.status === "error");
      const stageBreakdown = STAGES.map((stage) => {
        const stageSpan = traceSpans.find((s) => s.operation.startsWith(stage.operation));
        return { name: stage.name, duration: stageSpan?.duration_ms || null, status: stageSpan?.status || "ok" };
      });
      return { traceId, totalDuration, hasError, stages: stageBreakdown, startedAt: traceSpans[0]?.started_at };
    });

  return (
    <div id="voice-pipeline" class="space-y-4 fade-in">
      {/* Stage overview cards */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stageStats.map((stage) => (
          <div class="stat-card">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-2 h-2 rounded-full" style={`background:${stage.color}`} />
              <div class="stat-label">{stage.name}</div>
              {stage.errors > 0 && (
                <span class="text-[10px] font-mono text-red-400 ml-auto">{stage.errors} errors</span>
              )}
            </div>
            <div class="grid grid-cols-3 gap-2">
              <div>
                <div class="text-[10px] font-mono" style="color:#374151">Avg</div>
                <div class="text-sm font-mono font-semibold" style={`color:${stage.color}`}>
                  {stage.avg != null ? `${stage.avg}ms` : "—"}
                </div>
              </div>
              <div>
                <div class="text-[10px] font-mono" style="color:#374151">P50</div>
                <div class="text-sm font-mono font-semibold" style="color:#94a3b8">
                  {stage.p50 != null ? `${stage.p50}ms` : "—"}
                </div>
              </div>
              <div>
                <div class="text-[10px] font-mono" style="color:#374151">P95</div>
                <div class="text-sm font-mono font-semibold" style="color:#f59e0b">
                  {stage.p95 != null ? `${stage.p95}ms` : "—"}
                </div>
              </div>
            </div>
            <div class="text-[10px] font-mono mt-2" style="color:#475569">{stage.count} samples</div>
          </div>
        ))}
      </div>

      {/* Pipeline flow table */}
      <div
        class="rounded-lg overflow-hidden"
        style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
      >
        <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
            Recent Voice Pipelines
          </span>
        </div>
        <table class="w-full text-sm">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
              {["Trace", "ASR", "LLM", "TTS", "Total", "Time"].map((h) => (
                <th class="px-4 py-2 text-right" style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pipelines.length === 0 ? (
              <tr>
                <td colspan={6} class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">
                  No voice pipeline traces found
                </td>
              </tr>
            ) : (
              pipelines.map((p) => (
                <tr
                  class="log-row cursor-pointer"
                  style="border-top:1px solid rgba(255,255,255,0.04)"
                  onclick={`window.location.href='/traces/${p.traceId}'`}
                >
                  <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{p.traceId.slice(0, 8)}…</td>
                  {p.stages.map((stage) => (
                    <td class={`px-4 py-2 text-xs font-mono text-right ${stage.status === "error" ? "text-red-400" : durationColor(stage.duration)}`}>
                      {formatDuration(stage.duration)}
                    </td>
                  ))}
                  <td class={`px-4 py-2 text-xs font-mono text-right font-semibold ${durationColor(p.totalDuration)}`}>
                    {formatDuration(p.totalDuration)}
                  </td>
                  <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">
                    {p.startedAt ? new Date(p.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
