import type { FC } from "hono/jsx";
import type { Connection } from "@/types";
import { TypeBadge, StatusDot, statusColor, durationColor, formatDuration } from "./StatusBadge";

export const ConnectionTable: FC<{ connections: Connection[]; total: number }> = ({ connections, total }) => (
  <div
    id="connection-table"
    class="rounded-lg overflow-hidden fade-in"
    style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
  >
    <table class="w-full text-sm">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          {["Service", "Type", "Client", "Session", "Status", "Duration", "Started"].map((h) => (
            <th
              scope="col"
              class={`px-4 py-3 ${h === "Duration" || h === "Started" ? "text-right" : "text-left"}`}
              style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {connections.length === 0 ? (
          <tr>
            <td colspan={7} class="px-4 py-16 text-center">
              <div class="flex flex-col items-center gap-2">
                <svg class="w-7 h-7" style="color:#1e293b" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span class="text-xs" style="color:#334155;font-family:'IBM Plex Mono',monospace">
                  No connections match the current filters
                </span>
              </div>
            </td>
          </tr>
        ) : (
          connections.map((conn) => (
            <tr
              class="log-row cursor-pointer"
              style="border-top:1px solid rgba(255,255,255,0.04)"
              onclick={`window.location.href='/connections/${conn.id}'`}
            >
              <td class="px-4 py-2 text-xs font-mono" style="color:#94a3b8">{conn.service}</td>
              <td class="px-4 py-2"><TypeBadge type={conn.connection_type} /></td>
              <td class="px-4 py-2 text-xs font-mono truncate max-w-[120px]" style="color:#64748b" title={conn.client_id || ""}>
                {conn.client_id || "—"}
              </td>
              <td class="px-4 py-2 text-xs font-mono truncate max-w-[100px]" style="color:#64748b" title={conn.session_id || ""}>
                {conn.session_id ? conn.session_id.slice(0, 8) : "—"}
              </td>
              <td class="px-4 py-2">
                <span class={`flex items-center gap-1.5 text-xs font-mono ${statusColor(conn.status)}`}>
                  <StatusDot status={conn.status} />
                  {conn.status}
                </span>
              </td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(conn.duration_ms)}`}>
                {formatDuration(conn.duration_ms)}
              </td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">
                {conn.started_at
                  ? new Date(conn.started_at).toLocaleTimeString("en-GB", {
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
      {total.toLocaleString()} {total === 1 ? "connection" : "connections"}
    </div>
  </div>
);
