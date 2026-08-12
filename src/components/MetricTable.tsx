import type { FC } from "hono/jsx";
import { LocalTime } from "@/components/LocalTime";
import type { Metric } from "@/db/schema";
import type { MetricSummary } from "@/lib/facets";

function formatValue(value: number) {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const MetricTable: FC<{
  metrics: Metric[];
  summaries: MetricSummary[];
  total: number;
}> = ({ metrics, summaries, total }) => (
  <div id="metric-table" class="space-y-4 fade-in">
    <div
      class="rounded-lg overflow-hidden"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <table class="w-full text-sm">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            {["Metric", "Service", "Type", "Latest", "Avg", "Min", "Max", "Samples"].map((h) => (
              <th
                scope="col"
                class={`px-4 py-3 ${["Latest", "Avg", "Min", "Max", "Samples"].includes(h) ? "text-right" : "text-left"}`}
                style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaries.length === 0 ? (
            <tr>
              <td colspan={8} class="px-4 py-16 text-center">
                <span class="text-xs font-mono" style="color:#334155">No metrics match the current filters</span>
              </td>
            </tr>
          ) : (
            summaries.map((metric) => (
              <tr class="log-row" style="border-top:1px solid rgba(255,255,255,0.04)">
                <td class="px-4 py-2 text-xs font-mono" style="color:#cbd5e1">{metric.metric_name}</td>
                <td class="px-4 py-2 text-xs font-mono" style="color:#94a3b8">{metric.service}</td>
                <td class="px-4 py-2 text-xs font-mono" style="color:#64748b">{metric.metric_type}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#e2e8f0">{formatValue(metric.latest)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{formatValue(metric.avg)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{formatValue(metric.min)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{formatValue(metric.max)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">{metric.count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    <div
      class="rounded-lg overflow-hidden"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <div class="px-4 py-2.5 text-xs font-mono" style="border-bottom:1px solid rgba(255,255,255,0.05);color:#374151">
        Recent samples
      </div>
      <table class="w-full text-sm">
        <tbody>
          {metrics.length === 0 ? (
            <tr>
              <td class="px-4 py-8 text-center">
                <span class="text-xs font-mono" style="color:#334155">No recent metric samples</span>
              </td>
            </tr>
          ) : (
            metrics.map((metric) => (
              <tr class="log-row" style="border-top:1px solid rgba(255,255,255,0.04)">
                <td class="px-4 py-2 text-xs font-mono" style="color:#cbd5e1">{metric.metric_name}</td>
                <td class="px-4 py-2 text-xs font-mono" style="color:#94a3b8">{metric.service}</td>
                <td class="px-4 py-2 text-xs font-mono" style="color:#64748b">{metric.metric_type}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#e2e8f0">{formatValue(metric.value)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">
                  {<LocalTime iso={metric.timestamp} />}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div class="px-4 py-2.5 text-xs font-mono" style="border-top:1px solid rgba(255,255,255,0.05);color:#374151">
        {total.toLocaleString()} {total === 1 ? "sample" : "samples"}
      </div>
    </div>
  </div>
);
