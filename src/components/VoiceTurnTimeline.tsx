import type { FC } from "hono/jsx";
import type { TimelineBand, TimelineBandKind, VoiceTurnTimelineResult } from "@/lib/effect/voice-turn-timeline";
import { formatDuration } from "@/components/StatusBadge";

const BAND_COLOURS: Record<TimelineBandKind, string> = {
  turn: "#334155",
  llm: "#818cf8",
  tts: "#fbbf24",
  playout: "#10b981",
};

const MARKER_COLOURS = {
  ok: "#34d399",
  error: "#fb7185",
};

function bandDuration(band: TimelineBand): string {
  if (band.endMs === null) return "open";
  return formatDuration(band.endMs - band.startMs);
}

function bandTitle(band: TimelineBand): string {
  const parts = [`${band.label}: ${bandDuration(band)}`];
  if (band.detail) parts.push(band.detail);
  return parts.join(" — ");
}

const BandRow: FC<{ band: TimelineBand }> = ({ band }) => (
  <div class="relative h-4">
    <div
      class="absolute h-full rounded-sm"
      style={`left:${band.leftPct.toFixed(2)}%;width:${band.widthPct.toFixed(2)}%;background:${BAND_COLOURS[band.kind]};opacity:${band.status === "error" ? 1 : 0.75};min-width:2px;${band.status === "error" ? "outline:1px solid #fb7185" : ""}`}
      title={bandTitle(band)}
    />
  </div>
);

/**
 * Absolute-time gantt for ONE turn — geometry from `voice-turn-timeline.ts`
 * (mirrors `TraceWaterfall`'s leftPct/widthPct placement). Renders nothing
 * (returns `null`) when the turn carries no timing data beyond its own
 * extent; the caller (`VoiceSessions.tsx`) is expected to fall back to the
 * older proportional bar in that case rather than show an empty track.
 */
export const VoiceTurnTimeline: FC<{ result: VoiceTurnTimelineResult }> = ({ result }) => {
  if (!result.hasTimingData) return null;

  const bandOrder: TimelineBandKind[] = ["turn", "llm", "tts", "playout"];
  const rows = bandOrder
    .map((kind) => ({ kind, bands: result.bands.filter((b) => b.kind === kind) }))
    .filter((row) => row.bands.length > 0);

  return (
    <div class="mt-3 rounded" style="background:rgba(0,0,0,0.15);padding:8px">
      <div class="space-y-1">
        {rows.map((row) => (
          <div class="flex items-center gap-2">
            <span class="w-14 shrink-0 text-[10px] font-mono uppercase" style="color:#475569">
              {row.kind}
            </span>
            <div class="flex-1 relative">
              {row.bands.map((band) => (
                <BandRow band={band} />
              ))}
            </div>
          </div>
        ))}
        {result.markers.length > 0 ? (
          <div class="flex items-center gap-2">
            <span class="w-14 shrink-0 text-[10px] font-mono uppercase" style="color:#475569">
              markers
            </span>
            <div class="flex-1 relative h-4">
              {result.markers.map((marker) => (
                <span
                  class="absolute rounded-full"
                  style={`left:${marker.leftPct.toFixed(2)}%;top:2px;width:6px;height:6px;transform:translateX(-3px);background:${MARKER_COLOURS[marker.status]}`}
                  title={`${marker.label}${marker.detail ? ` — ${marker.detail}` : ""}`}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
