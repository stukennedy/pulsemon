import type { FC } from "hono/jsx";
import type { Connection, Event, Span } from "@/types";
import { TypeBadge, StatusDot, statusColor, durationColor, formatDuration } from "./StatusBadge";

const EVENT_ICONS: Record<string, string> = {
  message_sent: "→",
  message_received: "←",
  error: "✕",
  state_change: "◆",
  metric: "◇",
};

const EVENT_COLORS: Record<string, string> = {
  message_sent: "text-blue-400",
  message_received: "text-cyan-400",
  error: "text-red-400",
  state_change: "text-amber-400",
  metric: "text-gray-400",
};

export const ConnectionDetail: FC<{
  connection: Connection;
  events: Event[];
  spans: Span[];
}> = ({ connection, events, spans }) => (
  <div id="connection-detail" class="space-y-4 fade-in">
    {/* Header */}
    <div
      class="rounded-lg p-4"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <div class="flex items-center gap-3 mb-3">
        <StatusDot status={connection.status} />
        <span class="text-sm font-mono font-semibold text-white">{connection.service}</span>
        <TypeBadge type={connection.connection_type} />
        <span class={`text-xs font-mono ${statusColor(connection.status)}`}>{connection.status}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <div style="color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">ID</div>
          <div style="color:#94a3b8" class="truncate" title={connection.id}>{connection.id}</div>
        </div>
        <div>
          <div style="color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Client</div>
          <div style="color:#94a3b8">{connection.client_id || "—"}</div>
        </div>
        <div>
          <div style="color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Session</div>
          <div style="color:#94a3b8">{connection.session_id || "—"}</div>
        </div>
        <div>
          <div style="color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:0.05em">Duration</div>
          <div class={durationColor(connection.duration_ms)}>{formatDuration(connection.duration_ms)}</div>
        </div>
      </div>
      {connection.close_reason && (
        <div class="mt-2 text-xs font-mono" style="color:#f87171">
          Close reason: {connection.close_reason}
        </div>
      )}
    </div>

    {/* Spans */}
    {spans.length > 0 && (
      <div
        class="rounded-lg overflow-hidden"
        style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
      >
        <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
            Spans ({spans.length})
          </span>
        </div>
        {spans.map((span) => (
          <div class="px-4 py-2 flex items-center gap-3" style="border-top:1px solid rgba(255,255,255,0.04)">
            <StatusDot status={span.status} />
            <span class="text-xs font-mono" style="color:#94a3b8;min-width:160px">{span.operation}</span>
            <span class="text-xs font-mono" style="color:#64748b">{span.service}</span>
            <span class="flex-1" />
            <span class={`text-xs font-mono ${durationColor(span.duration_ms)}`}>
              {formatDuration(span.duration_ms)}
            </span>
          </div>
        ))}
      </div>
    )}

    {/* Event Timeline */}
    <div
      class="rounded-lg overflow-hidden"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
          Events ({events.length})
        </span>
      </div>
      {events.length === 0 ? (
        <div class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">
          No events recorded
        </div>
      ) : (
        events.map((event) => (
          <div class="px-4 py-2 flex items-center gap-3" style="border-top:1px solid rgba(255,255,255,0.04)">
            <span class={`text-xs font-mono w-4 text-center ${EVENT_COLORS[event.event_type] || "text-gray-400"}`}>
              {EVENT_ICONS[event.event_type] || "·"}
            </span>
            <span class="text-xs font-mono" style="color:#64748b;min-width:120px">{event.event_type}</span>
            {event.direction && (
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded" style="background:rgba(255,255,255,0.05);color:#64748b">
                {event.direction}
              </span>
            )}
            {event.size_bytes != null && (
              <span class="text-[10px] font-mono" style="color:#475569">
                {event.size_bytes > 1024 ? `${(event.size_bytes / 1024).toFixed(1)}KB` : `${event.size_bytes}B`}
              </span>
            )}
            <span class="flex-1" />
            <span class="text-xs font-mono" style="color:#475569">
              {event.timestamp
                ? new Date(event.timestamp).toLocaleTimeString("en-GB", {
                    hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
                  })
                : "—"}
            </span>
          </div>
        ))
      )}
    </div>
  </div>
);
