import type { FC } from "hono/jsx";
import type { MetricSeriesResult } from "@/lib/effect/metric-series";

function formatValue(value: number) {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const MetricTimeseriesChart: FC<{ series: MetricSeriesResult }> = ({ series }) => {
  const max = Math.max(...series.points.map((point) => point.avg), 0);
  const visiblePoints = series.points.slice(-80);

  return (
    <div
      class="rounded-lg p-4"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <div class="text-xs font-mono" style="color:#e2e8f0">Metric trend</div>
          <div class="text-[10px] font-mono mt-1" style="color:#475569">
            {series.source} / {series.points.length} buckets
          </div>
        </div>
        <div class="text-[10px] font-mono text-right" style="color:#64748b">
          {new Date(series.from).toLocaleString("en-GB")} {"->"} {new Date(series.to).toLocaleString("en-GB")}
        </div>
      </div>

      {visiblePoints.length === 0 ? (
        <div class="h-28 flex items-center justify-center text-xs font-mono" style="color:#334155">
          No metric samples in this window
        </div>
      ) : (
        <div class="h-28 flex items-end gap-1" aria-label="Metric trend chart">
          {visiblePoints.map((point) => {
            const pct = max > 0 ? Math.max(4, Math.round((point.avg / max) * 100)) : 4;
            return (
              <div class="flex-1 min-w-[3px] flex flex-col items-stretch justify-end group" title={`${point.bucket_start}: ${formatValue(point.avg)}`}>
                <div
                  class="rounded-t-sm"
                  style={`height:${pct}%;background:#22d3ee;opacity:0.74`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
