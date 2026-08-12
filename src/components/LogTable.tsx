import type { FC } from "hono/jsx";
import { LocalTime } from "./LocalTime";
import type { LogRecord } from "@/db/schema";

const LEVEL_COLORS: Record<string, string> = {
  trace: "#64748b",
  debug: "#38bdf8",
  info: "#10b981",
  warn: "#f59e0b",
  error: "#ef4444",
  fatal: "#f43f5e",
};

function levelColor(level: string) {
  return LEVEL_COLORS[level.toLowerCase()] || "#94a3b8";
}

export const LogTable: FC<{ logs: LogRecord[]; total: number }> = ({ logs, total }) => (
  <div
    id="log-table"
    class="rounded-lg overflow-hidden fade-in"
    style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
  >
    <table class="w-full text-sm table-fixed">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          {["Time", "Level", "Service", "Message", "Trace"].map((h) => (
            <th
              scope="col"
              class={`px-4 py-3 ${h === "Time" ? "text-right w-28" : h === "Level" ? "text-left w-24" : h === "Service" ? "text-left w-40" : h === "Trace" ? "text-left w-32" : "text-left"}`}
              style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {logs.length === 0 ? (
          <tr>
            <td colspan={5} class="px-4 py-16 text-center">
              <span class="text-xs font-mono" style="color:#334155">No logs match the current filters</span>
            </td>
          </tr>
        ) : (
          logs.map((log) => (
            <tr class="log-row" style="border-top:1px solid rgba(255,255,255,0.04)">
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569">
                {<LocalTime iso={log.timestamp} />}
              </td>
              <td class="px-4 py-2">
                <span
                  class="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase"
                  style={`background:${levelColor(log.level)}20;color:${levelColor(log.level)}`}
                >
                  {log.level}
                </span>
              </td>
              <td class="px-4 py-2 text-xs font-mono truncate" style="color:#94a3b8" title={log.service}>
                {log.service}
              </td>
              <td class="px-4 py-2 text-xs font-mono truncate" style="color:#cbd5e1" title={log.message}>
                {log.message}
              </td>
              <td class="px-4 py-2 text-xs font-mono truncate" style="color:#64748b" title={log.trace_id || ""}>
                {log.trace_id ? log.trace_id.slice(0, 12) : "-"}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
    <div class="px-4 py-2.5 text-xs font-mono" style="border-top:1px solid rgba(255,255,255,0.05);color:#374151">
      {total.toLocaleString()} {total === 1 ? "log" : "logs"}
    </div>
  </div>
);
