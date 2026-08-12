/**
 * Pure session-compare logic.
 *
 * Turns "it feels slower today" into evidence: given the latency samples of a
 * candidate session and a reference (another session, or a rolling baseline
 * built from recent turns), compute per-stage percentiles and classify each
 * metric as regressed / improved / flat. All D1 access lives in
 * `session-compare.ts`; this module is deliberately free of IO
 * so the verdict rules can be tested exhaustively.
 */

export type StageKey = "audio" | "asr" | "llm" | "tts";

export const STAGE_KEYS: readonly StageKey[] = ["audio", "asr", "llm", "tts"];

export const STAGE_LABELS: Record<StageKey, string> = {
  audio: "Release to audible reply",
  asr: "ASR transcription",
  llm: "LLM response",
  tts: "TTS synthesis",
};

/** The subset of a voice_turns row the comparison needs. */
import type { VoiceTurn } from "@/db/schema";

export type TurnLatencySample = Pick<
  VoiceTurn,
  | "audio_latency_ms"
  | "asr_latency_ms"
  | "llm_latency_ms"
  | "tts_latency_ms"
  | "interruption"
  | "cost_usd"
>;

export interface StageStats {
  /** Turns that actually recorded this stage. */
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface VoiceSessionProfile {
  /** Session id, or a synthetic key such as "baseline". */
  readonly key: string;
  /** Operator-facing label ("session abc123", "last 7 days"). */
  readonly label: string;
  readonly turnCount: number;
  readonly interruptedTurns: number;
  readonly interruptionRatePct: number | null;
  readonly totalCostUsd: number;
  readonly costPerTurnUsd: number | null;
  readonly stages: Record<StageKey, StageStats>;
}

export type CompareUnit = "ms" | "pct" | "usd" | "count";

export type CompareVerdict = "regressed" | "improved" | "flat" | "no_data";

export interface CompareRow {
  readonly metric: string;
  readonly unit: CompareUnit;
  readonly candidate: number | null;
  readonly reference: number | null;
  /** Relative change vs reference; null when either side is missing or reference is 0. */
  readonly deltaPct: number | null;
  readonly verdict: CompareVerdict;
}

const STAGE_COLUMNS: Record<StageKey, keyof TurnLatencySample> = {
  audio: "audio_latency_ms",
  asr: "asr_latency_ms",
  llm: "llm_latency_ms",
  tts: "tts_latency_ms",
};

/**
 * Noise floors keep the verdict honest: a 4ms wobble on a 30ms stage is not a
 * regression, and neither is +12% on a metric that moved by 3ms. A change must
 * clear BOTH the absolute floor for its unit and (for ms/usd) a 10% relative
 * move before it earns a verdict. Percentage-point metrics use the absolute
 * floor only; relative change on a near-zero rate is meaningless.
 */
const ABSOLUTE_FLOOR: Record<CompareUnit, number> = {
  ms: 25,
  pct: 2,
  usd: 0.001,
  count: Number.POSITIVE_INFINITY, // counts are informational, never a verdict
};

const RELATIVE_FLOOR = 0.1;

/** Nearest-rank percentile, matching the evaluator in lib/effect/monitors.ts. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function stageStats(samples: readonly TurnLatencySample[], stage: StageKey): StageStats {
  const values = samples
    .map((sample) => sample[STAGE_COLUMNS[stage]])
    .filter((value): value is number => (
      typeof value === "number" && Number.isFinite(value) && value >= 0
    ));

  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

export function buildVoiceSessionProfile(
  key: string,
  label: string,
  samples: readonly TurnLatencySample[]
): VoiceSessionProfile {
  const turnCount = samples.length;
  const interruptedTurns = samples.filter((sample) => sample.interruption === 1).length;
  const totalCostUsd = samples.reduce((sum, sample) => sum + (sample.cost_usd ?? 0), 0);

  return {
    key,
    label,
    turnCount,
    interruptedTurns,
    interruptionRatePct: turnCount === 0 ? null : (interruptedTurns / turnCount) * 100,
    totalCostUsd,
    costPerTurnUsd: turnCount === 0 ? null : totalCostUsd / turnCount,
    stages: {
      audio: stageStats(samples, "audio"),
      asr: stageStats(samples, "asr"),
      llm: stageStats(samples, "llm"),
      tts: stageStats(samples, "tts"),
    },
  };
}

function verdictFor(
  candidate: number | null,
  reference: number | null,
  unit: CompareUnit
): CompareVerdict {
  if (candidate === null || reference === null) return "no_data";

  const delta = candidate - reference;
  const clearsAbsolute = Math.abs(delta) >= ABSOLUTE_FLOOR[unit];
  // Guard the relative check against a zero reference (fresh baseline with
  // all-zero costs, 0% interruption rate): the absolute floor decides alone.
  const clearsRelative = unit === "pct" || reference === 0
    ? true
    : Math.abs(delta) / Math.abs(reference) >= RELATIVE_FLOOR;

  if (!clearsAbsolute || !clearsRelative) return "flat";
  // Every compared metric is lower-is-better (latency, interruption rate, cost).
  return delta > 0 ? "regressed" : "improved";
}

function row(
  metric: string,
  unit: CompareUnit,
  candidate: number | null,
  reference: number | null
): CompareRow {
  const deltaPct = candidate !== null && reference !== null && reference !== 0
    ? ((candidate - reference) / reference) * 100
    : null;

  return { metric, unit, candidate, reference, deltaPct, verdict: verdictFor(candidate, reference, unit) };
}

/**
 * Build the comparison table. `reference` may be null (e.g. an empty baseline
 * window); every row then reads no_data rather than pretending the candidate
 * regressed against nothing.
 */
export function compareVoiceSessionProfiles(
  candidate: VoiceSessionProfile,
  reference: VoiceSessionProfile | null
): CompareRow[] {
  const rows: CompareRow[] = [];

  for (const stage of STAGE_KEYS) {
    const a = candidate.stages[stage];
    const b = reference?.stages[stage] ?? null;
    rows.push(row(`${STAGE_LABELS[stage]} p50`, "ms", a.p50, b?.p50 ?? null));
    rows.push(row(`${STAGE_LABELS[stage]} p95`, "ms", a.p95, b?.p95 ?? null));
  }

  rows.push(row("Interruption rate", "pct", candidate.interruptionRatePct, reference?.interruptionRatePct ?? null));
  rows.push(row("Cost per turn", "usd", candidate.costPerTurnUsd, reference?.costPerTurnUsd ?? null));
  rows.push(row("Turns", "count", candidate.turnCount, reference?.turnCount ?? null));

  return rows;
}

/** Rows worth an operator's attention, used for the summary strip. */
export function countRegressions(rows: readonly CompareRow[]): number {
  return rows.filter((item) => item.verdict === "regressed").length;
}
