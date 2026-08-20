import type { FC } from "hono/jsx";
import { MetricTimeseriesChart } from "@/components/MetricTimeseriesChart";
import type { VoiceConcurrencyNow, VoiceConcurrencyWindowResult } from "@/lib/effect/voice-concurrency-io";

export type ConcurrencyWindowKey = "1h" | "6h" | "24h";

/** Minutes for each selectable window — the window-selector links and the
 *  SSE stream both resolve a key through this table, so they can never
 *  drift out of sync with each other. */
export const CONCURRENCY_WINDOW_MINUTES: Record<ConcurrencyWindowKey, number> = {
  "1h": 60,
  "6h": 360,
  "24h": 1440,
};

const WINDOW_KEYS: ConcurrencyWindowKey[] = ["1h", "6h", "24h"];

/** Parse the `?window=` query param, defaulting (and falling back on any
 *  unrecognised value) to `1h`. */
export function concurrencyWindowKey(raw: string | undefined | null): ConcurrencyWindowKey {
  return raw === "6h" || raw === "24h" ? raw : "1h";
}

const HEADING =
  "font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace";

const StatTile: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div class="stat-card">
    <div class="stat-label">{label}</div>
    <div class="stat-value">{value.toLocaleString()}</div>
  </div>
);

export interface VoiceConcurrencyPanelProps {
  readonly now: VoiceConcurrencyNow;
  readonly window: VoiceConcurrencyWindowResult;
  readonly windowKey: ConcurrencyWindowKey;
}

/**
 * Live concurrency panel — sessions/LLM/TTS "in flight now" tiles plus a
 * bucketed history chart per series. This entire `<div>` is the Datastar
 * morph target: `data-init` opens ONE long-lived SSE connection
 * (`GET /voice/concurrency/stream`), and the server re-renders and patches
 * this same component back in by id every ~5s over that one connection — see
 * `src/routes/voice/concurrency/stream.tsx`. `windowKey` rides along in the
 * `data-init` URL so the stream keeps honouring whichever window the
 * operator picked (state lives on the server, per the datastar skill).
 */
export const VoiceConcurrencyPanel: FC<VoiceConcurrencyPanelProps> = ({ now, window, windowKey }) => (
  <div
    id="voice-concurrency-panel"
    class="rounded-lg p-4"
    style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
    data-init={`@get('/voice/concurrency/stream?window=${windowKey}')`}
  >
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
      <span style={HEADING}>Voice Concurrency</span>
      <div class="flex gap-1">
        {WINDOW_KEYS.map((key) => (
          <a
            href={`/voice?window=${key}`}
            class="px-2.5 py-1 rounded text-[11px] font-mono no-underline"
            style={key === windowKey ? "background:rgba(255,255,255,0.08);color:#e2e8f0" : "color:#64748b"}
          >
            {key}
          </a>
        ))}
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
      <StatTile label="Sessions now" value={now.sessionsNow} />
      <StatTile label="LLM in-flight" value={now.llmInFlight} />
      <StatTile label="TTS in-flight" value={now.ttsInFlight} />
      <StatTile label="Peak sessions (window)" value={window.sessions.peak} />
    </div>

    <div class="grid lg:grid-cols-3 gap-3">
      <div>
        <div class="mb-1" style={HEADING}>Sessions</div>
        <MetricTimeseriesChart series={window.sessions.series} />
      </div>
      <div>
        <div class="mb-1" style={HEADING}>LLM generations</div>
        <MetricTimeseriesChart series={window.llm.series} />
      </div>
      <div>
        <div class="mb-1" style={HEADING}>TTS syntheses</div>
        <MetricTimeseriesChart series={window.tts.series} />
      </div>
    </div>
  </div>
);
