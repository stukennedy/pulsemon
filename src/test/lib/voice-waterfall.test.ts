import { describe, expect, it } from "bun:test";
import { buildWaterfall } from "@/lib/voice-waterfall";
import type { VoiceTurn } from "@/db/schema";

/** Only the fields the layout reads. */
function turn(partial: Partial<VoiceTurn>): VoiceTurn {
  return {
    id: "t",
    workspace_id: "default",
    project_id: "default",
    connection_id: null,
    session_id: null,
    trace_id: null,
    turn_index: null,
    role: "agent",
    started_at: "2026-08-12T08:00:00.000Z",
    ended_at: null,
    duration_ms: null,
    transcript: null,
    transcript_confidence: null,
    vad_start_ms: null,
    vad_end_ms: null,
    interruption: 0,
    audio_latency_ms: null,
    asr_latency_ms: null,
    llm_latency_ms: null,
    tts_latency_ms: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    state: null,
    metadata: null,
    ...partial,
  } as VoiceTurn;
}

describe("buildWaterfall", () => {
  it("decomposes a turn into stage segments plus the derived tail", () => {
    const [row] = buildWaterfall([
      turn({ asr_latency_ms: 100, llm_latency_ms: 800, tts_latency_ms: 200, duration_ms: 2000 }),
    ]);
    expect(row!.segments.map((s) => [s.stage, s.ms])).toEqual([
      ["asr", 100],
      ["llm", 800],
      ["tts", 200],
      ["tail", 900], // 2000 - measured stages: playback + everything unmeasured
    ]);
  });

  it("segments sum to exactly 100% of their own row", () => {
    const [row] = buildWaterfall([
      turn({ asr_latency_ms: 100, llm_latency_ms: 800, tts_latency_ms: 200, duration_ms: 2000 }),
    ]);
    const total = row!.segments.reduce((sum, s) => sum + s.pct, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("scales row widths against the longest turn, so rows compare visually", () => {
    const rows = buildWaterfall([
      turn({ duration_ms: 1000, llm_latency_ms: 500 }),
      turn({ duration_ms: 4000, llm_latency_ms: 500 }),
    ]);
    expect(rows[1]!.widthPct).toBe(100);
    expect(rows[0]!.widthPct).toBe(25);
  });

  it("never draws a negative tail when stages overlap oddly", () => {
    // Stages can sum past duration_ms on turns assembled from partial data —
    // a negative bar drawn to scale would be a lie.
    const [row] = buildWaterfall([
      turn({ asr_latency_ms: 500, llm_latency_ms: 900, tts_latency_ms: 300, duration_ms: 1000 }),
    ]);
    expect(row!.segments.find((s) => s.stage === "tail")).toBeUndefined();
    expect(row!.totalMs).toBe(1700); // geometry widens to the stage sum
    expect(row!.reportedMs).toBe(1000); // ...but the reported duration is preserved
  });

  it("reports an unmeasured turn as unknown, not as 1ms", () => {
    // The divide-by-zero guard used to surface on the card as a literal 1ms.
    const [row] = buildWaterfall([turn({})]);
    expect(row!.segments).toEqual([]);
    expect(row!.totalMs).toBeNull();
    expect(row!.reportedMs).toBeNull();
    expect(row!.widthPct).toBeGreaterThan(0); // still renders a hairline row
  });

  it("keeps a floor width so short turns remain clickable", () => {
    const rows = buildWaterfall([
      turn({ duration_ms: 10 }),
      turn({ duration_ms: 60_000 }),
    ]);
    expect(rows[0]!.widthPct).toBeGreaterThanOrEqual(2);
  });
});

describe("zero duration", () => {
  it("treats an explicit zero duration as reported, not unknown", () => {
    const [row] = buildWaterfall([turn({ duration_ms: 0 })]);
    expect(row!.reportedMs).toBe(0);
  });
});
