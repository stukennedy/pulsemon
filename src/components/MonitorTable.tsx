import type { FC } from "hono/jsx";
import type { MonitorDefinition, MonitorEvaluation } from "@/lib/effect/monitors";

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

function kindLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

const FIELD_STYLE = "width:100%;background:rgba(15,23,42,0.92);border:1px solid rgba(148,163,184,0.18);border-radius:6px;color:#e2e8f0;padding:9px 10px;font-size:12px";

export const MonitorTable: FC<{
  evaluations: MonitorEvaluation[];
  definitions?: MonitorDefinition[];
}> = ({ evaluations, definitions = [] }) => (
  <div class="space-y-4 fade-in">
    <section
      class="p-4"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px"
    >
      <div class="flex items-center justify-between gap-4 mb-3">
        <h2 class="text-sm font-mono" style="color:#cbd5e1">Monitor Definitions</h2>
        <span class="text-[11px] font-mono" style="color:#64748b">{definitions.length} configured</span>
      </div>

      <form method="post" action="/monitors" class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <input name="name" placeholder="Monitor name" required style={FIELD_STYLE} />
        <input name="metric_name" placeholder="Metric name" required style={FIELD_STYLE} />
        <input name="service" placeholder="Service filter" style={FIELD_STYLE} />
        <input name="threshold" type="number" step="0.001" min="0" placeholder="Threshold" required style={FIELD_STYLE} />
        <input name="window_minutes" type="number" min="1" max="1440" value="15" required style={FIELD_STYLE} />
        <input name="description" placeholder="Description" style={FIELD_STYLE} />
        <input type="hidden" name="kind" value="metric_avg" />
        <button
          type="submit"
          class="text-xs font-mono"
          style="background:#e2e8f0;color:#020617;border-radius:6px;padding:9px 12px"
        >
          Add Metric Monitor
        </button>
      </form>

      <div class="mt-4 grid gap-2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
        {definitions.map((definition) => (
          <div
            class="px-3 py-2"
            style="background:rgba(15,23,42,0.54);border:1px solid rgba(148,163,184,0.12);border-radius:6px"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-mono" style="color:#e2e8f0">{definition.name}</span>
              <span class="text-[10px] uppercase font-bold" style={definition.enabled ? "color:#34d399" : "color:#64748b"}>
                {definition.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <div class="mt-1 text-[11px] font-mono" style="color:#64748b">
              {kindLabel(definition.kind)} · {formatValue(definition.threshold, definition.id)} · {definition.window_minutes}m
            </div>
          </div>
        ))}
      </div>
    </section>

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
