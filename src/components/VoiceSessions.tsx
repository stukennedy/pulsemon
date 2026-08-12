import type { FC } from "hono/jsx";
import type { AgentToolCall, Event, VoiceTurn } from "@/db/schema";
import type { RealtimeSessionDetail, VoiceSessionSummary } from "@/lib/effect/sessions";
import { voiceSessionStatus } from "@/lib/effect/sessions";
import { STAGE_COLOURS, STAGE_LABELS, type WaterfallRow } from "@/lib/effect/voice-waterfall";
import { sharedTraceIds } from "@/lib/effect/turn-correlation";
import { durationColor, formatDuration, statusColor } from "@/components/StatusBadge";
import { LocalTime } from "@/components/LocalTime";

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

const HEADING =
  "font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace";

export const VoiceSessionTable: FC<{ sessions: VoiceSessionSummary[] }> = ({ sessions }) => (
  <div class="rounded-lg overflow-hidden" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
    <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style={HEADING}>Recent Voice Sessions</span>
    </div>
    <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          {["Session", "Status", "Turns", "Tools", "ASR", "LLM", "TTS", "Tokens", "Cost", "Last Seen"].map((h) => (
            <th class={`px-4 py-2 ${h === "Session" || h === "Status" ? "text-left" : "text-right"}`} style={HEADING}>
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
        ) : (
          sessions.map((session) => {
            const status = voiceSessionStatus(session);
            return (
              <tr
                class="log-row cursor-pointer"
                style="border-top:1px solid rgba(255,255,255,0.04)"
                onclick={`window.location.href=${JSON.stringify(`/sessions/${encodeURIComponent(session.session_id)}`)}`}
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
                  {session.tool_call_count}
                  {session.tool_error_count > 0 ? ` / ${session.tool_error_count} err` : ""}
                </td>
                <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_asr_latency_ms)}`}>{formatDuration(session.avg_asr_latency_ms)}</td>
                <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_llm_latency_ms)}`}>{formatDuration(session.avg_llm_latency_ms)}</td>
                <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(session.avg_tts_latency_ms)}`}>{formatDuration(session.avg_tts_latency_ms)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{session.total_tokens.toLocaleString()}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#64748b">{formatMoney(session.cost_usd)}</td>
                <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569"><LocalTime iso={session.last_seen_at} /></td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
    </div>
  </div>
);

/* ------------------------------------------------------------------------ */
/* Session detail                                                            */
/* ------------------------------------------------------------------------ */

/** DOM id for a turn's card — the waterfall links here, and deep links from
 *  other tools (or the recent-turns feed) land here. Keyed on the row's
 *  PRIMARY KEY: trace_id may legitimately be shared by every turn of a
 *  session, which made every anchor resolve to the first card. */
function turnAnchor(turn: VoiceTurn) {
  return `turn-${turn.id}`;
}


/** Pretty-print a JSON payload column; fall back to the raw string. */
function pretty(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const Legend: FC = () => (
  <div data-turn-waterfall-legend="true" class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 py-1">
    {(Object.keys(STAGE_COLOURS) as Array<keyof typeof STAGE_COLOURS>).map((stage) => (
      <span class="inline-flex items-center gap-1.5 text-[10px] font-mono" style="color:#64748b">
        <span class="w-2 h-2 rounded-sm" style={`background:${STAGE_COLOURS[stage]}`} />
        {STAGE_LABELS[stage]}
      </span>
    ))}
  </div>
);

const WaterfallBar: FC<{ row: WaterfallRow }> = ({ row }) => (
  <div class="flex h-4 rounded-sm overflow-hidden" style={`width:${row.widthPct}%;min-width:24px`}>
    {row.segments.map((segment) => (
      <div
        style={`width:${segment.pct}%;background:${STAGE_COLOURS[segment.stage]}`}
        title={`${STAGE_LABELS[segment.stage]}: ${formatDuration(segment.ms)}`}
      />
    ))}
  </div>
);

/**
 * The session at a glance: one row per turn on a shared time scale, each row a
 * stacked bar of where that turn's time went. Rows link to the turn's card.
 */
const TurnWaterfall: FC<{ rows: WaterfallRow[] }> = ({ rows }) => {
  return (
    <div class="rounded-lg overflow-hidden" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
      <div class="px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1" style="border-bottom:1px solid rgba(255,255,255,0.05)">
        <span class="shrink-0" style={HEADING}>Turn Waterfall</span>
        <Legend />
      </div>
      <div class="px-4 py-3 space-y-1.5">
        {rows.map((row) => (
          <a
            href={`#turn-${encodeURIComponent(row.turn.id)}`}
            class="flex items-center gap-3 group no-underline"
            title={`turn ${row.turn.turn_index ?? "?"}: ${
              row.reportedMs !== null && row.totalMs !== null && row.totalMs > row.reportedMs
                ? `${formatDuration(row.reportedMs)} reported — stages sum to ${formatDuration(row.totalMs)}`
                : row.reportedMs === null && row.totalMs === null
                  ? "duration unknown"
                  : formatDuration(row.reportedMs ?? row.totalMs)
            }`}
          >
            <span class="w-8 text-right text-[10px] font-mono shrink-0" style="color:#475569">
              #{row.turn.turn_index ?? "·"}
            </span>
            <div class="flex-1 min-w-0">
              <WaterfallBar row={row} />
            </div>
            <span class={`w-16 text-right text-[10px] font-mono shrink-0 ${durationColor(row.reportedMs ?? row.totalMs)}`}>
              {formatDuration(row.reportedMs ?? row.totalMs)}
            </span>
            <span class="w-4 text-[10px] shrink-0" style="color:#f59e0b">{row.turn.interruption ? "⚡" : ""}</span>
          </a>
        ))}
      </div>
    </div>
  );
};

const ToolCallRow: FC<{ call: AgentToolCall }> = ({ call }) => {
  const input = pretty(call.input);
  const output = pretty(call.output);
  return (
    <div data-tool-call-row="true" class="py-2 mt-2" style="border-top:1px solid rgba(255,255,255,0.05)">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-mono" style="color:#cbd5e1">🔧 {call.tool_name}</span>
        <span class={`text-[10px] font-mono ${statusColor(call.status)}`}>
          {call.status}{call.error ? ` — ${call.error}` : ""} / {formatDuration(call.duration_ms)}
          {call.retry_count > 0 ? ` / ${call.retry_count} retries` : ""}
        </span>
      </div>
      {input || output ? (
        <div class="grid md:grid-cols-2 gap-2 mt-2">
          {input ? (
            <div>
              <div style={HEADING}>Input</div>
              <pre class="text-[11px] font-mono mt-1 p-2 rounded overflow-x-auto" style="background:rgba(0,0,0,0.3);color:#94a3b8;max-height:16rem">{input}</pre>
            </div>
          ) : null}
          {output ? (
            <div>
              <div style={HEADING}>Output</div>
              <pre class="text-[11px] font-mono mt-1 p-2 rounded overflow-x-auto" style="background:rgba(0,0,0,0.3);color:#94a3b8;max-height:16rem">{output}</pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div class="text-[10px] font-mono mt-1" style="color:#475569">
          no payloads — producer reports names only (content-free telemetry)
        </div>
      )}
    </div>
  );
};

const TurnCard: FC<{ turn: VoiceTurn; index: number; toolCalls: AgentToolCall[]; events: Event[] }> = ({
  turn,
  index,
  toolCalls,
  events,
}) => {
  const tone = turn.interruption ? "#f59e0b" : turn.role === "user" ? "#22d3ee" : "#818cf8";
  return (
    <details
      id={turnAnchor(turn)}
      class="rounded-lg overflow-hidden"
      style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    >
      <summary class="px-4 py-3 cursor-pointer list-none flex items-center gap-3" style="user-select:none">
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style={`background:${tone}`} />
        <span class="text-xs font-mono" style="color:#cbd5e1">
          {turn.role} turn #{turn.turn_index ?? index + 1}
          {turn.interruption ? <span class="ml-2" style="color:#f59e0b">⚡ interrupted</span> : null}
          {turn.state && ["failed", "error"].includes(turn.state) ? (
            // Only KNOWN-bad states read as errors; "the producer used a word
            // we don't recognise" is not a failure and must not be dressed as
            // one.
            <span class="ml-2" style="color:#fb7185">{turn.state}</span>
          ) : null}
        </span>
        <span class="flex-1" />
        <span class="text-[10px] font-mono" style="color:#475569">
          ASR <span class={durationColor(turn.asr_latency_ms)}>{formatDuration(turn.asr_latency_ms)}</span>
          {" · "}LLM <span class={durationColor(turn.llm_latency_ms)}>{formatDuration(turn.llm_latency_ms)}</span>
          {" · "}TTS <span class={durationColor(turn.tts_latency_ms)}>{formatDuration(turn.tts_latency_ms)}</span>
          {" · "}heard <span class={durationColor(turn.audio_latency_ms)}>{formatDuration(turn.audio_latency_ms)}</span>
        </span>
        <span class="text-[10px] font-mono shrink-0" style="color:#475569"><LocalTime iso={turn.started_at} /></span>
      </summary>
      <div class="px-4 pb-3" style="border-top:1px solid rgba(255,255,255,0.04)">
        <div class="text-xs mt-3" style={turn.transcript ? "color:#e2e8f0" : "color:#475569"}>
          {turn.transcript ?? "No transcript — producer is content-free (enable transcript reporting to see it here)"}
        </div>
        {toolCalls.map((call) => (
          <ToolCallRow call={call} />
        ))}
        {events.length > 0 ? (
          <details class="mt-2">
            <summary class="text-[10px] font-mono cursor-pointer" style="color:#475569">
              {events.length} pipeline event{events.length === 1 ? "" : "s"}
            </summary>
            <div class="mt-1 space-y-0.5">
              {events.map((event) => (
                <div class="flex items-center justify-between text-[10px] font-mono px-2 py-1 rounded" style="background:rgba(0,0,0,0.2)">
                  <span style="color:#94a3b8">{event.event_type}</span>
                  <span style="color:#475569"><LocalTime iso={event.timestamp} /></span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
};

const TimelineItem: FC<{ title: string; time?: string | null; tone?: string; children?: unknown }> = (props) => (
  <div class="flex gap-3 py-3" style="border-top:1px solid rgba(255,255,255,0.04)">
    <div class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={`background:${props.tone ?? "#64748b"}`} />
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs font-mono truncate" style="color:#cbd5e1">{props.title}</div>
        <div class="text-[10px] font-mono shrink-0" style="color:#475569"><LocalTime iso={props.time} /></div>
      </div>
      {props.children}
    </div>
  </div>
);

/** The legacy interleaved feed, kept behind the "All activity" tab: everything
 *  the session produced, flat, for when the shaped view hides too much. */
const ActivityTimeline: FC<{ detail: RealtimeSessionDetail }> = ({ detail }) => {
  const timeline = detail.timeline;
  return (
    <div class="rounded-lg overflow-hidden px-4" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
      {timeline.length === 0 ? (
        <div class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">No session timeline records found</div>
      ) : (
        timeline.map((entry) => {
          if (entry.type === "turn") {
            const turn = entry.item;
            return (
              <TimelineItem
                title={`${turn.role} turn${turn.turn_index != null ? ` #${turn.turn_index}` : ""}`}
                time={turn.started_at}
                tone={turn.interruption ? "#f59e0b" : "#818cf8"}
              >
                {turn.transcript ? <div class="text-xs mt-1" style="color:#94a3b8">{turn.transcript}</div> : null}
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
              <TimelineItem title={`tool ${call.tool_name}`} time={call.started_at} tone={call.status === "ok" ? "#34d399" : "#fb7185"}>
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
              <TimelineItem title={`span ${span.operation}`} time={span.started_at} tone={span.status === "ok" ? "#64748b" : "#fb7185"}>
                <div class={`text-[10px] font-mono mt-1 ${statusColor(span.status)}`}>
                  {span.service} / {span.status} / {formatDuration(span.duration_ms)}
                </div>
              </TimelineItem>
            );
          }
          if (entry.type === "log") {
            const log = entry.item;
            return (
              <TimelineItem title={`${log.level} log`} time={log.timestamp} tone={log.level === "error" ? "#fb7185" : "#64748b"}>
                <div class="text-xs mt-1" style="color:#94a3b8">{log.message}</div>
              </TimelineItem>
            );
          }
          const event = entry.item;
          return (
            <TimelineItem title={`event ${event.event_type}`} time={event.timestamp} tone="#64748b">
              <div class="text-[10px] font-mono mt-1" style="color:#475569">{event.direction ?? "-"} / {event.size_bytes ?? 0} bytes</div>
            </TimelineItem>
          );
        })
      )}
    </div>
  );
};

export type SessionDetailTab = "turns" | "activity";

/**
 * Session detail, shaped around TURNS rather than a flat event feed.
 *
 * "Turns" (default): the waterfall — one bar per turn showing where its time
 * went — above one collapsible card per turn carrying the transcript, its tool
 * calls (payloads when the producer reports them) and its pipeline events. The
 * raw interleave that used to be the whole page lives behind "All activity".
 */
export const VoiceSessionDetailView: FC<{ detail: RealtimeSessionDetail; sessionId: string; tab?: SessionDetailTab }> = ({
  detail,
  sessionId,
  tab = "turns",
}) => {
  const summary = detail.summary;
  const base = `/sessions/${encodeURIComponent(sessionId)}`;
  const tabs: Array<{ key: SessionDetailTab; label: string; href: string }> = [
    { key: "turns", label: "Turns", href: base },
    { key: "activity", label: "All activity", href: `${base}?view=activity` },
  ];

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

      <div class="flex items-center justify-between">
        <div class="text-xs font-mono" style="color:#e2e8f0">
          {sessionId}
          <span class="text-[10px] ml-2" style="color:#475569">
            {detail.connection?.id ?? "no connection"} · started <LocalTime iso={summary?.started_at} fmt="datetime" />
          </span>
        </div>
        <div class="flex gap-1">
          {tabs.map((t) => (
            <a
              href={t.href}
              class="px-3 py-1 rounded text-[11px] font-mono no-underline"
              style={
                t.key === tab
                  ? "background:rgba(255,255,255,0.08);color:#e2e8f0"
                  : "color:#64748b"
              }
            >
              {t.label}
            </a>
          ))}
        </div>
      </div>

      {tab === "activity" ? (
        <ActivityTimeline detail={detail} />
      ) : (
        <>
          {detail.waterfallRows.length > 0 ? <TurnWaterfall rows={detail.waterfallRows} /> : null}
          <div class="space-y-2">
            {detail.turns.length === 0 ? (
              <div class="px-4 py-8 text-center text-xs font-mono rounded-lg" style="color:#334155;background:rgba(255,255,255,0.02)">
                No turns recorded for this session
              </div>
            ) : (
              detail.turnsWithTelemetry.map(({ turn, toolCalls, events }, index) => (
                <TurnCard
                  turn={turn}
                  index={index}
                  toolCalls={toolCalls}
                  events={events}
                />
              ))
            )}
          </div>
          {/* Open + scroll to the turn named in the hash (waterfall click,
              deep link from the recent-turns feed). Progressive enhancement:
              without JS the cards are still all present, just closed. */}
          <script
            dangerouslySetInnerHTML={{
              __html:
                "(function(){function open(){var h=location.hash.slice(1);if(!h)return;try{h=decodeURIComponent(h);}catch(e){}var el=document.getElementById(h);if(el&&el.tagName==='DETAILS'){el.open=true;el.scrollIntoView({block:'center'});}}window.addEventListener('hashchange',open);open();})();",
            }}
          />
        </>
      )}
    </div>
  );
};
