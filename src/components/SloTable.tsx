import type { FC } from "hono/jsx";
import type { SloDefinition, SloEvaluation } from "@/lib/effect/slos";

const FIELD_STYLE = "width:100%;background:rgba(15,23,42,0.92);border:1px solid rgba(148,163,184,0.18);border-radius:6px;color:#e2e8f0;padding:9px 10px;font-size:12px";

function pct(value: number | null) {
  return value === null ? "No data" : `${value.toFixed(2)}%`;
}

function statusColor(evaluation: SloEvaluation) {
  if (evaluation.attainment_percent === null) return "#64748b";
  if (evaluation.attainment_percent >= evaluation.objective_percent) return "#34d399";
  if (evaluation.error_budget_remaining_percent !== null && evaluation.error_budget_remaining_percent > 0) return "#fbbf24";
  return "#fb7185";
}

export const SloView: FC<{
  definitions: readonly SloDefinition[];
  evaluations: readonly SloEvaluation[];
  voiceMetricSuggestions: readonly { value: string; label: string }[];
}> = ({ definitions, evaluations, voiceMetricSuggestions }) => (
  <div class="space-y-4 fade-in">
    <section
      class="p-4"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px"
    >
      <div class="flex items-center justify-between gap-4 mb-3">
        <h2 class="text-sm font-mono" style="color:#cbd5e1">SLO Definitions</h2>
        <span class="text-[11px] font-mono" style="color:#64748b">{definitions.length} configured</span>
      </div>

      <form method="post" action="/slos" class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <input name="name" placeholder="SLO name" required style={FIELD_STYLE} />
        <select name="source" required style={FIELD_STYLE}>
          <option value="metrics" selected>Metrics</option>
          <option value="voice">Voice telemetry</option>
        </select>
        <input name="metric_name" placeholder="Metric name" list="slo-metric-suggestions" required style={FIELD_STYLE} />
        <datalist id="slo-metric-suggestions">
          {voiceMetricSuggestions.map((suggestion) => (
            <option value={suggestion.value}>{suggestion.label}</option>
          ))}
        </datalist>
        <input name="service" placeholder="Service filter" style={FIELD_STYLE} />
        <input name="objective_percent" type="number" step="0.001" min="0.001" max="99.999" value="99" required style={FIELD_STYLE} />
        <input name="threshold" type="number" step="0.001" min="0" placeholder="Good event threshold" required style={FIELD_STYLE} />
        <input name="window_minutes" type="number" min="1" max="43200" value="1440" required style={FIELD_STYLE} />
        <button
          type="submit"
          class="text-xs font-mono"
          style="background:#e2e8f0;color:#020617;border-radius:6px;padding:9px 12px"
        >
          Add SLO
        </button>
      </form>
      <p class="text-[11px] font-mono mt-2" style="color:#64748b">
        Choose Voice telemetry for the suggested voice.turns.* and voice.tools.* objectives (good event = value &lt;= threshold; use threshold 0 for interruption/error flags). Metrics always evaluates the named metric, even when its name overlaps a voice suggestion.
      </p>
    </section>

    <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      {evaluations.map((evaluation) => (
        <section
          class="p-4"
          style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-mono" style="color:#e2e8f0">{evaluation.name}</h3>
              <div class="text-[11px] font-mono mt-1" style="color:#64748b">
                {evaluation.total_events.toLocaleString()} events | {evaluation.window_minutes}m
              </div>
            </div>
            <div class="text-right">
              <div class="text-xl font-mono font-semibold" style={`color:${statusColor(evaluation)}`}>
                {pct(evaluation.attainment_percent)}
              </div>
              <div class="text-[10px] font-mono uppercase" style="color:#64748b">
                target {evaluation.objective_percent}%
              </div>
            </div>
          </div>

          <div class="mt-4">
            <div class="flex items-center justify-between text-[11px] font-mono mb-1" style="color:#64748b">
              <span>Error budget remaining</span>
              <span>{pct(evaluation.error_budget_remaining_percent)}</span>
            </div>
            <div class="h-2 rounded-full overflow-hidden" style="background:rgba(148,163,184,0.12)">
              <div
                class="h-full"
                style={`width:${Math.max(0, Math.min(100, evaluation.error_budget_remaining_percent ?? 0)).toFixed(1)}%;background:${statusColor(evaluation)}`}
              />
            </div>
          </div>
        </section>
      ))}
    </div>
  </div>
);
