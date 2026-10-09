import type { FC } from "hono/jsx";
import type { BrowserEvent, BrowserSession } from "@/db/schema";
import type { BrowserDevice } from "@/lib/effect/browser";
import type {
  BrowserPageSummary,
  BrowserSessionFilters,
  HeatmapSnapshot,
  HeatmapType,
} from "@/lib/effect/browser-query";
import { BROWSER_DEVICES } from "@/lib/effect/browser-query";
import { formatDuration } from "@/components/StatusBadge";
import { LocalTime } from "@/components/LocalTime";

const HEADING =
  "font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace";
const PANEL = "background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)";
const INPUT =
  "bg-transparent text-xs font-mono px-2 py-1 rounded border border-white/10 text-gray-300 focus:outline-none focus:border-cyan-500/50";

const EVENT_COLOURS: Record<BrowserEvent["type"], string> = {
  pageview: "#38bdf8",
  click: "#94a3b8",
  rage_click: "#f43f5e",
  dead_click: "#f59e0b",
  scroll: "#64748b",
  error: "#ef4444",
  custom: "#a78bfa",
};

function Count({ value, colour }: { value: number; colour: string }) {
  return <span style={value > 0 ? `color:${colour}` : "color:#334155"}>{value}</span>;
}

export const BrowserSessionTable: FC<{ sessions: BrowserSession[]; filters: BrowserSessionFilters }> = ({ sessions, filters }) => (
  <div class="space-y-3">
    <form method="get" action="/replays" class="flex flex-wrap items-center gap-2">
      <input name="path" value={filters.path ?? ""} placeholder="/checkout" class={INPUT} aria-label="Page path" />
      <input name="user" value={filters.userId ?? ""} placeholder="user id" class={INPUT} aria-label="User id" />
      <select name="device" class={INPUT} aria-label="Device">
        <option value="">all devices</option>
        {BROWSER_DEVICES.map((device) => (
          <option value={device} selected={filters.device === device}>{device}</option>
        ))}
      </select>
      <label class="flex items-center gap-1 text-xs font-mono text-gray-400">
        <input type="checkbox" name="frustrated" value="1" checked={filters.frustrated} /> frustration or errors
      </label>
      <button type="submit" class="text-xs font-mono px-3 py-1 rounded text-cyan-300" style="background:rgba(34,211,238,0.08)">Filter</button>
    </form>
    <div class="rounded-lg overflow-hidden" style={PANEL}>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
              {["Session", "Entry", "Exit", "Device", "Duration", "Pages", "Clicks", "Rage", "Dead", "Errors", "Last Seen"].map((h) => (
                <th scope="col" class={`px-3 py-2 ${["Session", "Entry", "Exit", "Device"].includes(h) ? "text-left" : "text-right"}`} style={HEADING}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colspan={11} class="px-4 py-12 text-center text-xs font-mono" style="color:#334155">
                  No browser sessions recorded yet. Add pulsemon-browser to a site to start recording.
                </td>
              </tr>
            ) : sessions.map((session) => (
              <tr class="log-row" style="border-top:1px solid rgba(255,255,255,0.04)">
                <td class="px-3 py-2 text-xs font-mono">
                  <a href={`/replays/${encodeURIComponent(session.id)}`} class="text-cyan-400 hover:text-cyan-300">
                    {session.id.slice(0, 12)}
                  </a>
                  {session.user_id ? <div class="text-[10px]" style="color:#475569">{session.user_id}</div> : null}
                </td>
                <td class="px-3 py-2 text-xs font-mono truncate max-w-48" style="color:#94a3b8" title={session.entry_path}>{session.entry_path}</td>
                <td class="px-3 py-2 text-xs font-mono truncate max-w-48" style="color:#94a3b8" title={session.exit_path}>{session.exit_path}</td>
                <td class="px-3 py-2 text-xs font-mono" style="color:#64748b">{session.device}</td>
                <td class="px-3 py-2 text-xs font-mono text-right" style="color:#cbd5e1">{formatDuration(session.duration_ms)}</td>
                <td class="px-3 py-2 text-xs font-mono text-right" style="color:#94a3b8">{session.page_views}</td>
                <td class="px-3 py-2 text-xs font-mono text-right" style="color:#94a3b8">{session.clicks}</td>
                <td class="px-3 py-2 text-xs font-mono text-right"><Count value={session.rage_clicks} colour={EVENT_COLOURS.rage_click} /></td>
                <td class="px-3 py-2 text-xs font-mono text-right"><Count value={session.dead_clicks} colour={EVENT_COLOURS.dead_click} /></td>
                <td class="px-3 py-2 text-xs font-mono text-right"><Count value={session.errors} colour={EVENT_COLOURS.error} /></td>
                <td class="px-3 py-2 text-xs font-mono text-right" style="color:#475569"><LocalTime iso={session.last_seen_at} fmt="datetime" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

function eventLabel(event: BrowserEvent) {
  switch (event.type) {
    case "pageview": return event.path;
    case "scroll": return `${Math.round(event.depth ?? 0)}% of ${event.path}`;
    case "error": return event.message ?? "error";
    case "custom": return event.name ?? "custom";
    default: return event.selector ?? event.path;
  }
}

export const BrowserSessionDetailView: FC<{ session: BrowserSession; events: readonly BrowserEvent[] }> = ({ session, events }) => {
  const timeline = events.filter((event) => event.type !== "click");
  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs font-mono" style="color:#94a3b8">
        <span class="text-white">{session.id}</span>
        {session.user_id ? <span>user {session.user_id}</span> : null}
        <span>{session.device} {session.viewport_w}x{session.viewport_h}</span>
        <span>{formatDuration(session.duration_ms)}</span>
        <span>{session.page_views} pages</span>
        <span>{session.clicks} clicks</span>
        <span><Count value={session.rage_clicks} colour={EVENT_COLOURS.rage_click} /> rage</span>
        <span><Count value={session.dead_clicks} colour={EVENT_COLOURS.dead_click} /> dead</span>
        <span><Count value={session.errors} colour={EVENT_COLOURS.error} /> errors</span>
        {session.country ? <span>{session.country}</span> : null}
        <LocalTime iso={session.started_at} fmt="datetime" />
      </div>
      <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div class="rounded-lg p-2 min-h-64" style={PANEL}>
          {session.replay_chunks > 0 ? (
            <div id="replay-root" data-events-url={`/api/replays/${encodeURIComponent(session.id)}/events`} class="w-full">
              <span class="text-xs font-mono" style="color:#475569">Loading replay…</span>
            </div>
          ) : (
            <div class="px-4 py-16 text-center text-xs font-mono" style="color:#334155">
              No replay recorded for this session (replay sampled out or disabled).
            </div>
          )}
        </div>
        <div class="rounded-lg overflow-hidden" style={PANEL}>
          <div class="px-3 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)"><span style={HEADING}>Timeline</span></div>
          <ol class="max-h-[70vh] overflow-y-auto">
            {timeline.length === 0 ? (
              <li class="px-3 py-6 text-center text-xs font-mono" style="color:#334155">No events</li>
            ) : timeline.map((event) => (
              <li>
                <button
                  type="button"
                  class="w-full text-left px-3 py-1.5 log-row flex gap-2 items-baseline"
                  data-seek={String(Date.parse(event.timestamp))}
                  style="border-top:1px solid rgba(255,255,255,0.03)"
                >
                  <span class="text-[10px] font-mono shrink-0" style="color:#475569"><LocalTime iso={event.timestamp} /></span>
                  <span class="text-[10px] font-mono uppercase shrink-0" style={`color:${EVENT_COLOURS[event.type]}`}>{event.type.replace("_", " ")}</span>
                  <span class="text-xs font-mono truncate" style="color:#cbd5e1" title={eventLabel(event)}>{eventLabel(event)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {session.replay_chunks > 0 ? (
        <>
          <link rel="stylesheet" href="/vendor/rrweb-player-2.1.6.min.css" />
          <script src="/vendor/rrweb-player-2.1.6.min.js" defer></script>
          <script src="/js/replay.js" defer></script>
        </>
      ) : null}
    </div>
  );
};

export interface HeatmapViewProps {
  readonly pages: readonly BrowserPageSummary[];
  readonly path?: string;
  readonly device: BrowserDevice;
  readonly type: HeatmapType | "scroll";
  readonly days: number;
  readonly snapshot: HeatmapSnapshot | null;
}

export const HeatmapView: FC<HeatmapViewProps> = ({ pages, path, device, type, days, snapshot }) => (
  <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
    <div class="rounded-lg overflow-hidden self-start" style={PANEL}>
      <div class="px-3 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)"><span style={HEADING}>Pages · last {days}d</span></div>
      <ul class="max-h-[75vh] overflow-y-auto">
        {pages.length === 0 ? (
          <li class="px-3 py-6 text-center text-xs font-mono" style="color:#334155">No page views yet</li>
        ) : pages.map((page) => {
          const href = `/heatmaps?${new URLSearchParams({ path: page.path, device, type, days: String(days) })}`;
          return (
            <li>
              <a
                href={href}
                class="block px-3 py-1.5 log-row"
                style={`border-top:1px solid rgba(255,255,255,0.03);${page.path === path ? "background:rgba(34,211,238,0.06)" : ""}`}
              >
                <div class="text-xs font-mono truncate" style="color:#cbd5e1" title={page.path}>{page.path}</div>
                <div class="text-[10px] font-mono flex gap-3" style="color:#475569">
                  <span>{page.views} views</span>
                  <span>{page.clicks} clicks</span>
                  {page.rage_clicks > 0 ? <span style={`color:${EVENT_COLOURS.rage_click}`}>{page.rage_clicks} rage</span> : null}
                  {page.dead_clicks > 0 ? <span style={`color:${EVENT_COLOURS.dead_click}`}>{page.dead_clicks} dead</span> : null}
                  {page.errors > 0 ? <span style={`color:${EVENT_COLOURS.error}`}>{page.errors} err</span> : null}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
    <div class="space-y-3 min-w-0">
      {path ? (
        <>
          <form method="get" action="/heatmaps" class="flex flex-wrap items-center gap-2">
            <input type="hidden" name="path" value={path} />
            <span class="text-xs font-mono text-white mr-2">{path}</span>
            <select name="device" class={INPUT} aria-label="Device">
              {BROWSER_DEVICES.map((option) => <option value={option} selected={option === device}>{option}</option>)}
            </select>
            <select name="type" class={INPUT} aria-label="Heatmap type">
              {(["click", "rage_click", "dead_click"] as const).map((option) => (
                <option value={option} selected={option === type}>{option.replace("_", " ")}s</option>
              ))}
              <option value="scroll" selected={type === "scroll"}>scroll depth</option>
            </select>
            <select name="days" class={INPUT} aria-label="Window">
              {[1, 7, 30].map((option) => <option value={String(option)} selected={option === days}>{option}d</option>)}
            </select>
            <button type="submit" class="text-xs font-mono px-3 py-1 rounded text-cyan-300" style="background:rgba(34,211,238,0.08)">Apply</button>
          </form>
          <div
            id="heatmap-root"
            class="rounded-lg overflow-hidden relative"
            style={`${PANEL};min-height:24rem`}
            data-mode={type}
            data-data-url={`/api/heatmaps?${new URLSearchParams({ path, device, type, days: String(days) })}`}
            data-events-url={snapshot ? `/api/replays/${encodeURIComponent(snapshot.sessionId)}/events` : ""}
            data-snapshot-at={snapshot ? String(snapshot.at) : ""}
            data-snapshot-width={snapshot ? String(snapshot.viewportWidth) : ""}
            data-snapshot-height={snapshot ? String(snapshot.docHeight) : ""}
          >
            <span class="block px-4 py-3 text-xs font-mono" style="color:#475569">Loading heatmap…</span>
          </div>
          <link rel="stylesheet" href="/vendor/rrweb-player-2.1.6.min.css" />
          <script src="/vendor/rrweb-player-2.1.6.min.js" defer></script>
          <script src="/js/heatmap.js" defer></script>
        </>
      ) : (
        <div class="rounded-lg px-4 py-16 text-center text-xs font-mono" style={`${PANEL};color:#334155`}>
          Pick a page to see where people click and how far they scroll.
        </div>
      )}
    </div>
  </div>
);
