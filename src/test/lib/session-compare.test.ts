import { describe, expect, it } from "bun:test";
import {
  buildVoiceSessionProfile,
  compareVoiceSessionProfiles,
  countRegressions,
  percentile,
  type TurnLatencySample,
} from "@/lib/effect/voice-session-profile";

function sample(overrides: Partial<TurnLatencySample> = {}): TurnLatencySample {
  return {
    audio_latency_ms: null,
    asr_latency_ms: null,
    llm_latency_ms: null,
    tts_latency_ms: null,
    interruption: 0,
    cost_usd: null,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("uses nearest-rank semantics like the monitor evaluator", () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(1000);
    expect(percentile([42], 95)).toBe(42);
  });
});

describe("buildVoiceSessionProfile", () => {
  it("computes per-stage stats over turns that recorded the stage", () => {
    const profile = buildVoiceSessionProfile("s1", "session s1", [
      sample({ audio_latency_ms: 500, llm_latency_ms: 900, cost_usd: 0.01 }),
      sample({ audio_latency_ms: 1500, interruption: 1, cost_usd: 0.03 }),
      sample({ asr_latency_ms: 200 }),
    ]);

    expect(profile.turnCount).toBe(3);
    expect(profile.stages.audio.count).toBe(2);
    expect(profile.stages.audio.p50).toBe(500);
    expect(profile.stages.audio.p95).toBe(1500);
    expect(profile.stages.asr.count).toBe(1);
    expect(profile.stages.tts.p95).toBeNull();
    expect(profile.interruptedTurns).toBe(1);
    expect(profile.interruptionRatePct).toBeCloseTo(100 / 3);
    expect(profile.totalCostUsd).toBeCloseTo(0.04);
    expect(profile.costPerTurnUsd).toBeCloseTo(0.04 / 3);
  });

  it("ignores historical negative latency samples", () => {
    const profile = buildVoiceSessionProfile("s1", "session s1", [
      sample({ llm_latency_ms: -1 }),
      sample({ llm_latency_ms: 800 }),
    ]);

    expect(profile.stages.llm.count).toBe(1);
    expect(profile.stages.llm.p50).toBe(800);
    expect(profile.stages.llm.p95).toBe(800);
  });

  it("returns null rates for an empty session", () => {
    const profile = buildVoiceSessionProfile("empty", "empty", []);
    expect(profile.turnCount).toBe(0);
    expect(profile.interruptionRatePct).toBeNull();
    expect(profile.costPerTurnUsd).toBeNull();
  });
});

describe("compareVoiceSessionProfiles", () => {
  const slowTurns = Array.from({ length: 10 }, () => sample({ llm_latency_ms: 2000 }));
  const fastTurns = Array.from({ length: 10 }, () => sample({ llm_latency_ms: 1000 }));

  it("flags a real latency regression", () => {
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("slow", "slow", slowTurns),
      buildVoiceSessionProfile("fast", "fast", fastTurns)
    );
    const p95 = rows.find((row) => row.metric === "LLM response p95");

    expect(p95?.candidate).toBe(2000);
    expect(p95?.reference).toBe(1000);
    expect(p95?.deltaPct).toBeCloseTo(100);
    expect(p95?.verdict).toBe("regressed");
    expect(countRegressions(rows)).toBeGreaterThan(0);
  });

  it("flags improvement in the other direction", () => {
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("fast", "fast", fastTurns),
      buildVoiceSessionProfile("slow", "slow", slowTurns)
    );
    expect(rows.find((row) => row.metric === "LLM response p95")?.verdict).toBe("improved");
  });

  it("treats sub-noise-floor wobble as flat", () => {
    // +10ms on 1000ms clears neither the 25ms absolute nor the 10% relative floor.
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("a", "a", Array.from({ length: 5 }, () => sample({ llm_latency_ms: 1010 }))),
      buildVoiceSessionProfile("b", "b", fastTurns)
    );
    expect(rows.find((row) => row.metric === "LLM response p95")?.verdict).toBe("flat");
  });

  it("requires the relative floor as well as the absolute one", () => {
    // +30ms clears the 25ms absolute floor but is only 3% of a 1000ms stage.
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("a", "a", Array.from({ length: 5 }, () => sample({ llm_latency_ms: 1030 }))),
      buildVoiceSessionProfile("b", "b", fastTurns)
    );
    expect(rows.find((row) => row.metric === "LLM response p95")?.verdict).toBe("flat");
  });

  it("uses absolute percentage points for interruption rate", () => {
    const interrupted = Array.from({ length: 10 }, (_, i) => sample({ interruption: i < 3 ? 1 : 0 }));
    const calm = Array.from({ length: 10 }, () => sample());
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("a", "a", interrupted),
      buildVoiceSessionProfile("b", "b", calm)
    );
    const rate = rows.find((row) => row.metric === "Interruption rate");

    expect(rate?.candidate).toBe(30);
    expect(rate?.reference).toBe(0);
    // reference is 0 so deltaPct is undefined, but the verdict still fires
    // off the absolute percentage-point move.
    expect(rate?.deltaPct).toBeNull();
    expect(rate?.verdict).toBe("regressed");
  });

  it("keeps turn counts informational, never a verdict", () => {
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("a", "a", fastTurns),
      buildVoiceSessionProfile("b", "b", fastTurns.slice(0, 2))
    );
    expect(rows.find((row) => row.metric === "Turns")?.verdict).toBe("flat");
  });

  it("reads no_data against a missing reference", () => {
    const rows = compareVoiceSessionProfiles(
      buildVoiceSessionProfile("a", "a", fastTurns),
      null
    );
    expect(rows.every((row) => row.verdict === "no_data" || row.metric === "Turns")).toBe(true);
    expect(rows.find((row) => row.metric === "Turns")?.verdict).toBe("no_data");
  });
});
