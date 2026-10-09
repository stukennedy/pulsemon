/**
 * Absolute-time gantt geometry for ONE voice turn — pure, mirroring
 * `TraceWaterfall.tsx`'s `minTime`/`maxTime`/`totalRange`/`leftPct`/
 * `widthPct` math (`src/components/TraceWaterfall.tsx:23-47`) so the same
 * mental model applies to both. Where `voice-waterfall.ts` draws one turn as
 * a proportional stack of its own stage durations (relative geometry, no
 * absolute placement), this draws where every signal for the turn actually
 * fell on the wall clock: the LLM generation span, each TTS sentence span,
 * the playout band the listener actually heard, and interrupt/cancel/tool
 * markers — all positioned on one shared absolute axis.
 *
 * Every input here (`spans`, `events`, `toolCalls`) is expected to already be
 * scoped to this one turn by the caller — this module only does geometry, not
 * correlation (that's `turn-correlation.ts` for tool calls/events, and a
 * direct `trace_id === turn.trace_id` filter for spans, both applied in
 * `sessions.ts`).
 */
import type { AgentToolCall, Event, Span, VoiceTurn } from "@/db/schema";

export type TimelineBandKind = "turn" | "llm" | "tts" | "playout";

export interface TimelineBand {
  readonly kind: TimelineBandKind;
  readonly label: string;
  readonly startMs: number;
  /** `null` = still open when the data was captured (e.g. an unpaired
   *  ingress-speech-start, or a span whose terminal event never arrived —
   *  `voice-waterfall.ts`'s TTS pairing already calls this "unterminated"). */
  readonly endMs: number | null;
  readonly leftPct: number;
  readonly widthPct: number;
  readonly status: "ok" | "error";
  readonly detail: string | null;
}

export type TimelineMarkerKind = "interrupt" | "cancel" | "tool";

export interface TimelineMarker {
  readonly kind: TimelineMarkerKind;
  readonly label: string;
  readonly atMs: number;
  readonly leftPct: number;
  readonly status: "ok" | "error";
  readonly detail: string | null;
}

export interface VoiceTurnTimelineResult {
  readonly turnId: string;
  /** True once any band beyond the bare turn extent, or any marker, exists —
   *  i.e. PR-A spans/events/tool-call timing actually reached this turn.
   *  `false` means the caller should degrade to the older proportional
   *  waterfall bar (`voice-waterfall.ts`) rather than render a gantt with
   *  nothing but an empty track. */
  readonly hasTimingData: boolean;
  readonly minTime: number;
  readonly maxTime: number;
  readonly totalRangeMs: number;
  readonly bands: TimelineBand[];
  readonly markers: TimelineMarker[];
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function sentenceIndex(attributes: string | null): number | null {
  if (!attributes) return null;
  try {
    const parsed = JSON.parse(attributes) as Record<string, unknown>;
    const raw = parsed.sentence_index;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  } catch {
    return null;
  }
}

function pct(value: number, min: number, range: number): number {
  return ((value - min) / range) * 100;
}

/** Pair chronologically-ordered ingress-speech start/end events into playout
 *  bands. An end with no preceding open start is ignored (nothing to pair —
 *  the honest degrade rather than guessing a start); a start with no
 *  following end stays open (`endMs: null`). */
function playoutBands(events: readonly Event[]): TimelineBand[] {
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const bands: TimelineBand[] = [];
  let openStart: number | null = null;

  for (const event of ordered) {
    const at = parseMs(event.timestamp);
    if (at === null) continue;
    if (event.event_type === "voice.ingress.speech.start") {
      openStart = at;
    } else if (event.event_type === "voice.ingress.speech.end" && openStart !== null) {
      bands.push({
        kind: "playout",
        label: "playout",
        startMs: openStart,
        endMs: at,
        leftPct: 0,
        widthPct: 0,
        status: "ok",
        detail: null,
      });
      openStart = null;
    }
  }

  if (openStart !== null) {
    bands.push({
      kind: "playout",
      label: "playout",
      startMs: openStart,
      endMs: null,
      leftPct: 0,
      widthPct: 0,
      status: "ok",
      detail: null,
    });
  }

  return bands;
}

function toolCallDetail(call: AgentToolCall): string {
  const parts = [call.status];
  if (call.error) parts.push(call.error);
  if (call.retry_count > 0) parts.push(`${call.retry_count} retries`);
  return parts.join(" — ");
}

export function buildVoiceTurnTimeline(
  turn: VoiceTurn,
  spans: readonly Span[],
  events: readonly Event[],
  toolCalls: readonly AgentToolCall[]
): VoiceTurnTimelineResult {
  const turnStart = parseMs(turn.started_at) ?? Date.now();
  const turnEnd = parseMs(turn.ended_at)
    ?? (typeof turn.duration_ms === "number" && turn.duration_ms >= 0 ? turnStart + turn.duration_ms : null);

  const bands: TimelineBand[] = [
    {
      kind: "turn",
      label: `${turn.role} turn`,
      startMs: turnStart,
      endMs: turnEnd,
      leftPct: 0,
      widthPct: 0,
      status: "ok",
      detail: null,
    },
  ];

  for (const span of spans) {
    const startMs = parseMs(span.started_at);
    if (startMs === null) continue;
    const endMs = parseMs(span.ended_at);
    const status = span.status === "error" ? "error" as const : "ok" as const;

    if (span.operation === "voice.llm.generate") {
      bands.push({
        kind: "llm",
        label: "LLM generate",
        startMs,
        endMs,
        leftPct: 0,
        widthPct: 0,
        status,
        detail: span.status_message,
      });
    } else if (span.operation === "voice.tts.synthesize") {
      const index = sentenceIndex(span.attributes);
      bands.push({
        kind: "tts",
        label: index !== null ? `TTS #${index}` : "TTS",
        startMs,
        endMs,
        leftPct: 0,
        widthPct: 0,
        status,
        detail: span.status_message,
      });
    }
  }

  bands.push(...playoutBands(events));

  const markers: TimelineMarker[] = [];
  for (const event of events) {
    if (event.event_type !== "voice.turn.interrupt" && event.event_type !== "voice.playback.cancel") continue;
    const atMs = parseMs(event.timestamp);
    if (atMs === null) continue;
    markers.push({
      kind: event.event_type === "voice.turn.interrupt" ? "interrupt" : "cancel",
      label: event.event_type === "voice.turn.interrupt" ? "interrupted" : "playback cancelled",
      atMs,
      leftPct: 0,
      status: "error",
      detail: null,
    });
  }

  for (const call of toolCalls) {
    const atMs = parseMs(call.started_at);
    if (atMs === null) continue;
    markers.push({
      kind: "tool",
      label: call.tool_name,
      atMs,
      leftPct: 0,
      status: call.status === "ok" ? "ok" : "error",
      detail: toolCallDetail(call),
    });
  }

  const hasTimingData = bands.length > 1 || markers.length > 0;

  const allTimes = [
    ...bands.map((b) => b.startMs),
    ...bands.map((b) => b.endMs ?? b.startMs),
    ...markers.map((m) => m.atMs),
  ];
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const totalRangeMs = Math.max(maxTime - minTime, 1);

  const placedBands = bands.map((band) => {
    const left = pct(band.startMs, minTime, totalRangeMs);
    // An open band (no end) is still running: extend it to the axis end so
    // an in-flight LLM/TTS/playout interval reads as ongoing, not as a
    // sliver at its start instant. (`maxTime` deliberately excludes open
    // ends — the axis is sized by what has actually happened.)
    const right = pct(band.endMs ?? maxTime, minTime, totalRangeMs);
    return { ...band, leftPct: left, widthPct: Math.max(right - left, 0.5) };
  });
  const placedMarkers = markers.map((marker) => ({
    ...marker,
    leftPct: pct(marker.atMs, minTime, totalRangeMs),
  }));

  return {
    turnId: turn.id,
    hasTimingData,
    minTime,
    maxTime,
    totalRangeMs,
    bands: placedBands,
    markers: placedMarkers,
  };
}
