import type { FC } from "hono/jsx";
import type { RecentVoiceTurn, VoiceStageStats } from "@/lib/effect/sessions";
import { durationColor, formatDuration } from "./StatusBadge";
import { LocalTime } from "./LocalTime";
import { STAGE_COLOURS } from "@/lib/voice-waterfall";

/**
 * Voice page header: per-stage latency cards + the recent-turns feed.
 *
 * Sourced from `voice_turns` — the canonical voice record — NOT from spans.
 * The previous version filtered spans by an `asr./llm./tts.` operation-name
 * convention no ingest enforces, so a producer reporting turns (the documented
 * voice path) saw "0 samples" and "No voice pipeline traces found" forever
 * while its data sat one table away.
 */

const CARD_STAGES: Array<{ key: VoiceStageStats["stage"]; label: string; hint: string }> = [
  { key: "asr", label: "ASR", hint: "release → transcript" },
  { key: "llm", label: "LLM", hint: "time to first token" },
  { key: "tts", label: "TTS", hint: "first audio chunk" },
  { key: "audio", label: "HEARD", hint: "release → audible reply" },
];

const StatCell: FC<{ label: string; value: number | null; tone: string }> = ({ label, value, tone }) => (
  <div>
    <div style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
      {label}
    </div>
    <div class={`text-sm font-mono mt-1 ${value === null ? "" : durationColor(value)}`} style={value === null ? "color:#334155" : ""}>
      {value === null ? "—" : formatDuration(value)}
    </div>
  </div>
);

export const VoiceStageCards: FC<{ stages: VoiceStageStats[] }> = ({ stages }) => (
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
    {CARD_STAGES.map(({ key, label, hint }) => {
      const stage = stages.find((s) => s.stage === key);
      return (
        <div class="rounded-lg p-4" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" style={`background:${STAGE_COLOURS[key === "audio" ? "tail" : key] ?? "#64748b"}`} />
            <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:#94a3b8;font-family:'IBM Plex Mono',monospace">{label}</span>
            <span class="text-[10px]" style="color:#475569">{hint}</span>
          </div>
          <div class="grid grid-cols-3 gap-3 mt-3">
            <StatCell label="Avg" value={stage?.avg ?? null} tone="" />
            <StatCell label="P50" value={stage?.p50 ?? null} tone="" />
            <StatCell label="P95" value={stage?.p95 ?? null} tone="" />
          </div>
          <div class="text-[10px] font-mono mt-2" style="color:#475569">{stage?.samples ?? 0} samples</div>
        </div>
      );
    })}
  </div>
);

export const RecentVoiceTurnsTable: FC<{ turns: RecentVoiceTurn[] }> = ({ turns }) => (
  <div class="rounded-lg overflow-hidden" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
    <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
        Recent Turns
      </span>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
          {["Turn", "ASR", "LLM", "TTS", "Heard", "Total", "Time"].map((h) => (
            <th
              class={`px-4 py-2 ${h === "Turn" ? "text-left" : "text-right"}`}
              style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {turns.length === 0 ? (
          <tr>
            <td colspan={7} class="px-4 py-8 text-center text-xs font-mono" style="color:#334155">
              No voice turns yet — turns appear here as producers report them
            </td>
          </tr>
        ) : (
          turns.map((turn) => (
            <tr
              class={`log-row ${turn.session_id ? "cursor-pointer" : ""}`}
              style="border-top:1px solid rgba(255,255,255,0.04)"
              onclick={
                turn.session_id
                  ? `window.location.href=${JSON.stringify(
                      `/sessions/${encodeURIComponent(turn.session_id)}#turn-${encodeURIComponent(turn.id)}`
                    )}`
                  : undefined
              }
            >
              <td class="px-4 py-2">
                <div class="text-xs font-mono" style="color:#cbd5e1">
                  {turn.trace_id ?? "—"}
                  {turn.interruption ? <span class="ml-2 text-[10px]" style="color:#f59e0b">⚡ interrupted</span> : null}
                </div>
                <div class="text-[10px] font-mono" style="color:#475569">{turn.session_id ?? "no session"}</div>
              </td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(turn.asr_latency_ms)}`}>{formatDuration(turn.asr_latency_ms)}</td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(turn.llm_latency_ms)}`}>{formatDuration(turn.llm_latency_ms)}</td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(turn.tts_latency_ms)}`}>{formatDuration(turn.tts_latency_ms)}</td>
              <td class={`px-4 py-2 text-xs font-mono text-right ${durationColor(turn.audio_latency_ms)}`}>{formatDuration(turn.audio_latency_ms)}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#94a3b8">{formatDuration(turn.duration_ms)}</td>
              <td class="px-4 py-2 text-xs font-mono text-right" style="color:#475569"><LocalTime iso={turn.started_at} /></td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
