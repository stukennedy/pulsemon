import type { FC } from "hono/jsx";
import type { Span } from "@/types";
import { StatusDot, durationColor, formatDuration } from "./StatusBadge";

const SERVICE_COLORS: Record<string, string> = {
  "asr-service": "#22d3ee",
  "llm-service": "#818cf8",
  "tts-service": "#f59e0b",
  "voice-gateway": "#10b981",
  "session-manager": "#f97316",
};

export const TraceWaterfall: FC<{ spans: Span[]; traceId: string }> = ({ spans, traceId }) => {
  if (spans.length === 0) {
    return (
      <div class="rounded-lg p-8 text-center" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
        <span class="text-xs font-mono" style="color:#334155">No spans found for trace {traceId}</span>
      </div>
    );
  }

  // Calculate time range
  const times = spans.map((s) => new Date(s.started_at).getTime());
  const endTimes = spans
    .filter((s) => s.ended_at)
    .map((s) => new Date(s.ended_at!).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times, ...endTimes);
  const totalRange = maxTime - minTime || 1;

  // Build tree structure
  const rootSpans = spans.filter((s) => !s.parent_span_id);
  const childMap = new Map<string, Span[]>();
  for (const span of spans) {
    if (span.parent_span_id) {
      const children = childMap.get(span.parent_span_id) ?? [];
      children.push(span);
      childMap.set(span.parent_span_id, children);
    }
  }

  function renderSpan(span: Span, depth: number): any {
    const start = new Date(span.started_at).getTime();
    const duration = span.duration_ms || 0;
    const leftPct = ((start - minTime) / totalRange) * 100;
    const widthPct = Math.max((duration / totalRange) * 100, 0.5);
    const color = SERVICE_COLORS[span.service] || "#64748b";
    const children = childMap.get(span.id) || [];

    return (
      <>
        <div
          class="flex items-center gap-2 py-1.5 px-3"
          style={`border-top:1px solid rgba(255,255,255,0.04);padding-left:${12 + depth * 16}px`}
        >
          {/* Label */}
          <div class="flex items-center gap-2 shrink-0" style="min-width:220px">
            <StatusDot status={span.status} />
            <span class="text-xs font-mono truncate" style={`color:${color}`} title={span.operation}>
              {span.operation}
            </span>
            <span class="text-[10px] font-mono" style="color:#374151">{span.service}</span>
          </div>

          {/* Waterfall bar */}
          <div class="flex-1 relative h-5">
            <div
              class="absolute h-full rounded-sm"
              style={`left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${color};opacity:0.3;min-width:2px`}
            />
            <div
              class="absolute h-full rounded-sm"
              style={`left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${color};opacity:0.8;min-width:2px;max-height:8px;top:6px`}
            />
          </div>

          {/* Duration */}
          <span class={`text-xs font-mono shrink-0 w-16 text-right ${durationColor(span.duration_ms)}`}>
            {formatDuration(span.duration_ms)}
          </span>
        </div>
        {children.map((child) => renderSpan(child, depth + 1))}
      </>
    );
  }

  return (
    <div
      id="trace-waterfall"
      class="rounded-lg overflow-hidden fade-in"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      {/* Header */}
      <div class="px-4 py-2 flex items-center justify-between" style="border-bottom:1px solid rgba(255,255,255,0.05)">
        <div class="flex items-center gap-2">
          <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
            Trace
          </span>
          <span class="text-xs font-mono" style="color:#64748b">{traceId.slice(0, 16)}…</span>
        </div>
        <span class="text-xs font-mono" style="color:#475569">
          {spans.length} span{spans.length !== 1 ? "s" : ""} · {formatDuration(maxTime - minTime)}
        </span>
      </div>

      {/* Spans */}
      {rootSpans.map((span) => renderSpan(span, 0))}
    </div>
  );
};

export const TraceList: FC<{ spans: Span[]; total: number }> = ({ spans, total }) => {
  // Group by trace_id
  const traceMap = new Map<string, Span[]>();
  for (const span of spans) {
    const arr = traceMap.get(span.trace_id) ?? [];
    arr.push(span);
    traceMap.set(span.trace_id, arr);
  }

  const traces = Array.from(traceMap.entries()).map(([traceId, traceSpans]) => {
    const rootSpan = traceSpans.find((s) => !s.parent_span_id) || traceSpans[0];
    const totalDuration = traceSpans.reduce((max, s) => Math.max(max, s.duration_ms || 0), 0);
    const hasError = traceSpans.some((s) => s.status === "error");
    const services = [...new Set(traceSpans.map((s) => s.service))];
    return { traceId, spans: traceSpans, rootSpan, totalDuration, hasError, services };
  });

  return (
    <div
      id="trace-table"
      class="rounded-lg overflow-hidden fade-in"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <table class="w-full text-sm">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            {["Trace ID", "Root Operation", "Services", "Spans", "Duration", "Status", "Time"].map((h) => (
              <th
                scope="col"
                class={`px-4 py-3 ${["Duration", "Time", "Spans"].includes(h) ? "text-right" : "text-left"}`}
                style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {traces.length === 0 ? (
            <tr>
              <td colspan={7} class="px-4 py-16 text-center">
                <span class="text-xs font-mono" style="color:#334155">No traces match the current filters</span>
              </td>
            </tr>
          ) : (
            traces.map((t) => (
              <tr
                class="log-row cursor-pointer"
                style="border-top:1px solid rgba(255,255,255,0.04)"
                onclick={`window.location.href='/traces/${t.traceId}'`}
              >
                <td class="px-4 py-2 text-xs font-mono" style="color:#64748b">{t.traceId.slice(0, 12)}…</td>
                <td class="px-4 py-2 text-xs font-mono" style="color:#94a3b8">{t.rootSpan.operation}</td>
                <td class="px-4 py-2">
                  <div class="flex gap-1 flex-wrap">
                    {t.services.map((s) => (
                      <span class="text-[10px] font-mono px-1.5 py-0.5 rounded" style={`background:${SERVICE_COLORS[s] || "#64748b"}20;color:${SERVICE_COLORS[s] || "#64748b"}`}>
                        {s.replace("-service", "")}
                      </span>
                    ))}
                  </div>
                </td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{t.spans.length}</td>
                <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(t.totalDuration)}`}>
                  {formatDuration(t.totalDuration)}
                </td>
                <td class="px-4 py-2">
                  <StatusDot status={t.hasError ? "error" : "ok"} />
                </td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">
                  {t.rootSpan.started_at
                    ? new Date(t.rootSpan.started_at).toLocaleTimeString("en-GB", {
                        hour: "2-digit", minute: "2-digit", second: "2-digit",
                      })
                    : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div class="px-4 py-2.5 text-xs font-mono" style="border-top:1px solid rgba(255,255,255,0.05);color:#374151">
        {traces.length} trace{traces.length !== 1 ? "s" : ""} · {total} span{total !== 1 ? "s" : ""}
      </div>
    </div>
  );
};
