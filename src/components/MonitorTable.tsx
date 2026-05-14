import type { FC } from "hono/jsx";
import type { MonitorEvaluation } from "@/lib/effect/monitors";

const STATUS_STYLE: Record<string, string> = {
  ok: "color:#34d399;background:rgba(52,211,153,0.08);border-color:rgba(52,211,153,0.18)",
  warn: "color:#fbbf24;background:rgba(251,191,36,0.08);border-color:rgba(251,191,36,0.18)",
  alert: "color:#fb7185;background:rgba(251,113,133,0.09);border-color:rgba(251,113,133,0.2)",
  no_data: "color:#64748b;background:rgba(100,116,139,0.08);border-color:rgba(100,116,139,0.18)",
};

function formatValue(value: number | null, monitorId: string) {
  if (value === null) return "No data";
  if (monitorId.endsWith("_pct")) return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString()}ms`;
}

export const MonitorTable: FC<{ evaluations: MonitorEvaluation[] }> = ({ evaluations }) => (
  <div class="space-y-4 fade-in">
    <div
      class="rounded-lg overflow-hidden"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <table class="w-full text-sm">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            {["Monitor", "Status", "Value", "Threshold", "Window"].map((h) => (
              <th
                scope="col"
                class={`px-4 py-3 ${["Value", "Threshold", "Window"].includes(h) ? "text-right" : "text-left"}`}
                style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evaluations.map((evaluation) => (
            <tr class="log-row" style="border-top:1px solid rgba(255,255,255,0.04)">
              <td class="px-4 py-3">
                <div class="text-xs font-mono" style="color:#cbd5e1">{evaluation.name}</div>
                <div class="text-[11px] mt-1" style="color:#475569">{evaluation.description}</div>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase"
                  style={STATUS_STYLE[evaluation.status] ?? STATUS_STYLE.no_data}
                >
                  {evaluation.status.replace("_", " ")}
                </span>
              </td>
              <td class="px-4 py-3 text-xs font-mono text-right" style="color:#e2e8f0">
                {formatValue(evaluation.value, evaluation.monitor_id)}
              </td>
              <td class="px-4 py-3 text-xs font-mono text-right" style="color:#64748b">
                {formatValue(evaluation.threshold, evaluation.monitor_id)}
              </td>
              <td class="px-4 py-3 text-xs font-mono text-right" style="color:#475569">
                {evaluation.window_minutes}m
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
