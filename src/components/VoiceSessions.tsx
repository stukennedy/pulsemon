import type { FC } from "hono/jsx";
import type { AgentToolCall, Event, LogRecord, Span, VoiceTurn } from "@/db/schema";
import type { RealtimeSessionDetail, VoiceSessionSummary } from "@/lib/effect/sessions";
import { voiceSessionStatus } from "@/lib/effect/sessions";
import { durationColor, formatDuration, statusColor } from "./StatusBadge";

function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "-";
}

function formatMoney(value: number) {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function statusStyle(status: string) {
  if (status === "error") return "color:#fb7185;background:rgba(251,113,133,0.09);border-color:rgba(251,113,133,0.2)";
  if (status === "warn") return "color:#fbbf24;background:rgba(251,191,36,0.08);border-color:rgba(251,191,36,0.18)";
  return "color:#34d399;background:rgba(52,211,153,0.08);border-color:rgba(52,211,153,0.18)";
}

export const VoiceSessionTable: FC<{ sessions: VoiceSessionSummary[] }> = ({ sessions }) => (
  <div
    class="rounded-lg overflow-hidden"
    style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
  >
    <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
        Recent Voice Sessions
      </span>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          {["Session", "Status", "Turns", "Tools", "ASR", "LLM", "TTS", "Tokens", "Cost", "Last Seen"].map((h) => (
            <th
              class={`px-4 py-2 ${["Turns", "Tools", "ASR", "LLM", "TTS", "Tokens", "Cost", "Last Seen"].includes(h) ? "text-right" : "text-left"}`}
              style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sessions.length === 0 ? (
          <tr>
            <td colspan={10} class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">
              No voice sessions found
            </td>
          </tr>
        ) : sessions.map((session) => {
          const status = voiceSessionStatus(session);
          return (
            <tr
              class="log-row cursor-pointer"
              style="border-top:1px solid rgba(255,255,255,0.04)"
              onclick={`window.location.href='/sessions/${encodeURIComponent(session.session_id)}'`}
            >
              <td class="px-4 py-2">
                <div class="text-xs font-mono" style="color:#cbd5e1">{session.session_id}</div>
                <div class="text-[10px] font-mono" style="color:#475569">{session.connection_id ?? session.trace_id ?? "-"}</div>
              </td>
              <td class="px-4 py-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase" style={statusStyle(status)}>
                  {status}
                </span>
              </td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#e2e8f0">{session.turn_count}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style={session.tool_error_count > 0 ? "color:#fb7185" : "color:#94a3b8"}>
                {session.tool_call_count}{session.tool_error_count > 0 ? ` / ${session.tool_error_count} err` : ""}
              </td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_asr_latency_ms)}`}>{formatDuration(session.avg_asr_latency_ms)}</td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_llm_latency_ms)}`}>{formatDuration(session.avg_llm_latency_ms)}</td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_tts_latency_ms)}`}>{formatDuration(session.avg_tts_latency_ms)}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{session.total_tokens.toLocaleString()}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{formatMoney(session.cost_usd)}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">{formatTime(session.last_seen_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

function TimelineItem(props: { title: string; time?: string | null; tone?: string; children?: unknown }) {
  return (
    <div class="flex gap-3 py-3" style="border-top:1px solid rgba(255,255,255,0.04)">
      <div class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={`background:${props.tone ?? "#64748b"}`} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs font-mono truncate" style="color:#cbd5e1">{props.title}</div>
          <div class="text-[10px] font-mono shrink-0" style="color:#475569">{formatTime(props.time)}</div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function turnTone(turn: VoiceTurn) {
  if (turn.interruption) return "#f59e0b";
  if (turn.role === "assistant") return "#818cf8";
  return "#22d3ee";
}

function toolTone(call: AgentToolCall) {
  return call.status === "ok" ? "#34d399" : "#fb7185";
}

function spanTone(span: Span) {
  return span.status === "ok" ? "#64748b" : "#fb7185";
}

function timelineItems(detail: RealtimeSessionDetail) {
  return [
    ...detail.turns.map((turn) => ({ type: "turn" as const, at: turn.started_at, item: turn })),
    ...detail.toolCalls.map((call) => ({ type: "tool" as const, at: call.started_at, item: call })),
    ...detail.spans.map((span) => ({ type: "span" as const, at: span.started_at, item: span })),
    ...detail.logs.map((log) => ({ type: "log" as const, at: log.timestamp, item: log })),
    ...detail.events.map((event) => ({ type: "event" as const, at: event.timestamp, item: event })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

export const VoiceSessionDetailView: FC<{ detail: RealtimeSessionDetail; sessionId: string }> = ({ detail, sessionId }) => {
  const summary = detail.summary;
  const timeline = timelineItems(detail);

  return (
    <div class="space-y-4 fade-in">
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div class="stat-card">
          <div class="stat-label">Turns</div>
          <div class="stat-value">{summary?.turn_count ?? detail.turns.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tool Calls</div>
          <div class="stat-value">{summary?.tool_call_count ?? detail.toolCalls.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Interruptions</div>
          <div class="stat-value">{summary?.interruption_count ?? detail.turns.filter((turn) => turn.interruption).length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tokens</div>
          <div class="stat-value">{(summary?.total_tokens ?? 0).toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Cost</div>
          <div class="stat-value">{formatMoney(summary?.cost_usd ?? 0)}</div>
        </div>
      </div>

      <div
        class="rounded-lg overflow-hidden"
        style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
      >
        <div class="px-4 py-3" style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <div class="text-xs font-mono" style="color:#e2e8f0">{sessionId}</div>
          <div class="text-[10px] font-mono mt-1" style="color:#475569">
            {detail.connection?.id ?? "no connection"} / {summary?.trace_id ?? "no trace"}
          </div>
        </div>
        <div class="px-4">
          {timeline.length === 0 ? (
            <div class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">No session timeline records found</div>
          ) : timeline.map((entry) => {
            if (entry.type === "turn") {
              const turn = entry.item;
              return (
                <TimelineItem title={`${turn.role} turn${turn.turn_index != null ? ` #${turn.turn_index}` : ""}`} time={turn.started_at} tone={turnTone(turn)}>
                  <div class="text-xs mt-1" style="color:#94a3b8">{turn.transcript ?? "No transcript"}</div>
                  <div class="text-[10px] font-mono mt-1" style="color:#475569">
                    ASR {formatDuration(turn.asr_latency_ms)} / LLM {formatDuration(turn.llm_latency_ms)} / TTS {formatDuration(turn.tts_latency_ms)}
                    {turn.interruption ? " / interrupted" : ""}
                  </div>
                </TimelineItem>
              );
            }
            if (entry.type === "tool") {
              const call = entry.item;
              return (
                <TimelineItem title={`tool ${call.tool_name}`} time={call.started_at} tone={toolTone(call)}>
                  <div class={`text-[10px] font-mono mt-1 ${statusColor(call.status)}`}>
                    {call.status} / {formatDuration(call.duration_ms)} / retries {call.retry_count}
                  </div>
                  {call.error && <div class="text-xs mt-1 text-red-400">{call.error}</div>}
                </TimelineItem>
              );
            }
            if (entry.type === "span") {
              const span = entry.item;
              return (
                <TimelineItem title={`span ${span.operation}`} time={span.started_at} tone={spanTone(span)}>
                  <div class={`text-[10px] font-mono mt-1 ${statusColor(span.status)}`}>
                    {span.service} / {span.status} / {formatDuration(span.duration_ms)}
                  </div>
                </TimelineItem>
              );
            }
            if (entry.type === "log") {
              const log = entry.item as LogRecord;
              return (
                <TimelineItem title={`${log.level} log`} time={log.timestamp} tone={log.level === "error" ? "#fb7185" : "#64748b"}>
                  <div class="text-xs mt-1" style="color:#94a3b8">{log.message}</div>
                </TimelineItem>
              );
            }
            const event = entry.item as Event;
            return (
              <TimelineItem title={`event ${event.event_type}`} time={event.timestamp} tone="#64748b">
                <div class="text-[10px] font-mono mt-1" style="color:#475569">{event.direction ?? "-"} / {event.size_bytes ?? 0} bytes</div>
              </TimelineItem>
            );
          })}
        </div>
      </div>
    </div>
  );
};
