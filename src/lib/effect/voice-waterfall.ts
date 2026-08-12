/**
 * Layout math for the per-turn voice waterfall - pure, so the geometry that
 * makes the chart honest is unit-testable without rendering anything.
 *
 * A turn's row decomposes into the stages a learner actually waits through:
 *
 *   [ ASR ][ LLM (ttft) ][ TTS ][ playback / tail ]
 *
 * The first three are measured directly (`asr/llm/tts_latency_ms`). The tail
 * is DERIVED: `duration_ms` minus the measured stages - everything else the
 * turn spent (audio playout, pacer lead, generation after first token). It is
 * clamped at zero because the stages can overlap on odd turns and a negative
 * bar would be a lie drawn to scale.
 */
import type { VoiceTurn } from "@/db/schema";

export interface WaterfallSegment {
  readonly stage: "asr" | "llm" | "tts" | "tail";
  readonly ms: number;
  /** Percentage of the ROW's own duration - segments always sum to <=100. */
  readonly pct: number;
}

export interface WaterfallRow {
  readonly turn: VoiceTurn;
  /** Null when the turn reports no duration AND no stage - "unknown", which
   *  must not be rendered as the 1ms the divide-by-zero guard would imply. */
  readonly totalMs: number | null;
  /**
   * The duration the producer actually REPORTED, when it did. Distinct from
   * `totalMs`: when stage measurements overlap and sum past `duration_ms`,
   * geometry widens to the stage sum (bars must not lie spatially) but the
   * number shown stays the recorded duration - the chart must not invent a
   * total the turn never reported.
   */
  readonly reportedMs: number | null;
  /** Row width as a percentage of the LONGEST turn, so rows compare visually. */
  readonly widthPct: number;
  readonly segments: WaterfallSegment[];
}

const ms = (v: number | null | undefined): number => (typeof v === "number" && v > 0 ? v : 0);

export function buildWaterfall(turns: readonly VoiceTurn[]): WaterfallRow[] {
  const totals = turns.map((t) => Math.max(ms(t.duration_ms), ms(t.asr_latency_ms) + ms(t.llm_latency_ms) + ms(t.tts_latency_ms)));
  const maxTotal = Math.max(1, ...totals);

  return turns.map((turn, i) => {
    const total = totals[i] ?? 0;
    const geometryTotal = Math.max(1, total);
    const asr = ms(turn.asr_latency_ms);
    const llm = ms(turn.llm_latency_ms);
    const tts = ms(turn.tts_latency_ms);
    // No reported duration and no measured stage means no segments at all.
    // Deriving a tail from the divide-by-zero guard would draw a phantom
    // sliver for a turn we know nothing about. An EXPLICIT zero duration
    // counts as reported - "instant" and "unknown" are different facts.
    const reportedDuration = typeof turn.duration_ms === "number" && turn.duration_ms >= 0;
    const measured = reportedDuration || asr + llm + tts > 0;
    const tail = measured ? Math.max(0, total - asr - llm - tts) : 0;
    const segments: WaterfallSegment[] = (
      [
        { stage: "asr", ms: asr },
        { stage: "llm", ms: llm },
        { stage: "tts", ms: tts },
        { stage: "tail", ms: tail },
      ] as const
    )
      .filter((s) => s.ms > 0)
      .map((s) => ({ ...s, pct: (s.ms / geometryTotal) * 100 }));

    return {
      turn,
      totalMs: measured ? total : null,
      reportedMs: reportedDuration ? (turn.duration_ms as number) : null,
      widthPct: Math.max(2, (geometryTotal / maxTotal) * 100),
      segments,
    };
  });
}

/** Stage-to-bar colour. One authority so the legend can't drift from the bars. */
export const STAGE_COLOURS: Record<WaterfallSegment["stage"], string> = {
  asr: "#22d3ee", // cyan - hearing
  llm: "#818cf8", // indigo - thinking
  tts: "#fbbf24", // amber - voicing
  tail: "#334155", // slate - playback & everything unmeasured
};

export const STAGE_LABELS: Record<WaterfallSegment["stage"], string> = {
  asr: "ASR",
  llm: "LLM (ttft)",
  tts: "TTS",
  tail: "playback/tail",
};
