/**
 * Voice SLO sources.
 *
 * The SLO machinery in `slos.ts` is deliberately narrow: an SLO is "at least
 * `objective_percent` of events in the window have `value <= threshold`",
 * evaluated against the `metrics` table by `metric_name`. That framing also
 * fits voice-turn telemetry perfectly — "p95 release→audible reply under
 * 1.5s" is exactly "95% of turns have audio_latency_ms <= 1500" — so instead
 * of inventing a parallel voice-SLO system (a second definitions table, a
 * second evaluator, a second UI), we reserve a `voice.turns.*` /
 * `voice.tools.*` metric-name namespace and route those definitions to
 * `voice_turns` / `agent_tool_calls` at evaluation time.
 *
 * Every SQL fragment below is a hard-coded constant selected by exact
 * metric-name match. Nothing user-supplied is ever interpolated into SQL —
 * thresholds, tenant ids, and window cutoffs are always bound parameters in
 * the evaluator.
 */

export interface VoiceSloSource {
  /** Reserved metric name that selects this source in an SLO definition. */
  readonly metric_name: string;
  /** Operator-facing label used for UI hints. */
  readonly label: string;
  /** Source table. Both carry tenant columns and `started_at`. */
  readonly table: "voice_turns" | "agent_tool_calls";
  /**
   * SQL expression producing the per-event value compared against the SLO
   * threshold (good event ⇔ value <= threshold). Constant, never user input.
   */
  readonly valueSql: string;
  /**
   * Extra WHERE fragment selecting eligible events, or null for all rows.
   * Latency sources only count turns that actually recorded the stage —
   * otherwise every user turn without a synthesis latency would count as a
   * violation and drown the signal.
   */
  readonly eligibleSql: string | null;
  /** How thresholds read for this source ("ms" latency vs 0/1 "flag"). */
  readonly unit: "ms" | "flag";
  readonly description: string;
}

function latencySource(column: string, label: string, description: string): VoiceSloSource {
  return {
    metric_name: `voice.turns.${column}`,
    label,
    table: "voice_turns",
    valueSql: column,
    eligibleSql: `${column} IS NOT NULL`,
    unit: "ms",
    description,
  };
}

export const VOICE_SLO_SOURCES: readonly VoiceSloSource[] = [
  latencySource(
    "audio_latency_ms",
    "Release → audible reply",
    "Share of turns where the caller heard the reply within the threshold (ms)."
  ),
  latencySource(
    "asr_latency_ms",
    "ASR transcription latency",
    "Share of turns transcribed within the threshold (ms)."
  ),
  latencySource(
    "llm_latency_ms",
    "LLM response latency",
    "Share of turns where the model responded within the threshold (ms)."
  ),
  latencySource(
    "tts_latency_ms",
    "TTS synthesis latency",
    "Share of turns synthesized within the threshold (ms)."
  ),
  {
    metric_name: "voice.turns.interruption",
    label: "Turns without interruption",
    table: "voice_turns",
    // interruption is a 0/1 flag, so with threshold 0 a "good" event is an
    // uninterrupted turn and the objective bounds the interruption rate:
    // objective 95% ⇔ at most 5% of turns interrupted.
    valueSql: "interruption",
    eligibleSql: null,
    unit: "flag",
    description: "Share of turns not interrupted by the caller. Use threshold 0.",
  },
  {
    metric_name: "voice.tools.error",
    label: "Agent tool calls succeed",
    table: "agent_tool_calls",
    // Same 0/1 framing: a "good" event is a tool call that ended ok, so the
    // objective bounds the tool error rate. Use threshold 0.
    valueSql: "CASE WHEN status != 'ok' THEN 1 ELSE 0 END",
    eligibleSql: null,
    unit: "flag",
    description: "Share of agent tool calls ending in ok status. Use threshold 0.",
  },
];

const SOURCES_BY_METRIC_NAME = new Map(
  VOICE_SLO_SOURCES.map((source) => [source.metric_name, source])
);

/**
 * Resolve a reserved voice metric name to its source, or undefined when the
 * definition should evaluate against the `metrics` table as before.
 */
export function resolveVoiceSloSource(metricName: string): VoiceSloSource | undefined {
  return SOURCES_BY_METRIC_NAME.get(metricName);
}
