import { describe, expect, it } from "bun:test";
import { buildVoiceTurnTimeline } from "@/lib/effect/voice-turn-timeline";
import type { AgentToolCall, Event, Span, VoiceTurn } from "@/db/schema";

/** Only the fields the geometry reads — mirrors voice-waterfall.test.ts's
 *  fixture style. */
function turn(partial: Partial<VoiceTurn>): VoiceTurn {
  return {
    id: "turn-1",
    workspace_id: "default",
    project_id: "default",
    connection_id: null,
    session_id: null,
    trace_id: "turn-1",
    turn_index: null,
    role: "agent",
    started_at: "2026-08-18T10:00:00.000Z",
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

function span(partial: Partial<Span>): Span {
  return {
    id: "span-1",
    workspace_id: "default",
    project_id: "default",
    trace_id: "turn-1",
    parent_span_id: null,
    connection_id: null,
    service: "voice-pipeline",
    operation: "voice.llm.generate",
    started_at: "2026-08-18T10:00:00.500Z",
    ended_at: "2026-08-18T10:00:01.000Z",
    duration_ms: 500,
    status: "ok",
    status_message: null,
    attributes: null,
    ...partial,
  } as Span;
}

function event(partial: Partial<Event>): Event {
  return {
    id: "event-1",
    workspace_id: "default",
    project_id: "default",
    connection_id: null,
    span_id: null,
    trace_id: "turn-1",
    event_type: "voice.ingress.speech.start",
    timestamp: "2026-08-18T10:00:01.100Z",
    data: null,
    direction: null,
    size_bytes: null,
    ...partial,
  } as Event;
}

function toolCall(partial: Partial<AgentToolCall>): AgentToolCall {
  return {
    id: "tool-1",
    workspace_id: "default",
    project_id: "default",
    trace_id: "turn-1",
    span_id: null,
    connection_id: null,
    session_id: null,
    turn_id: "turn-1",
    tool_name: "recordInsight",
    started_at: "2026-08-18T10:00:00.700Z",
    ended_at: null,
    duration_ms: 50,
    status: "ok",
    retry_count: 0,
    input: null,
    output: null,
    error: null,
    metadata: null,
    ...partial,
  } as AgentToolCall;
}

describe("buildVoiceTurnTimeline", () => {
  it("degrades to the bare turn band with no timing data", () => {
    const result = buildVoiceTurnTimeline(turn({}), [], [], []);
    expect(result.hasTimingData).toBe(false);
    expect(result.bands).toHaveLength(1);
    expect(result.bands[0]).toMatchObject({ kind: "turn", leftPct: 0 });
    expect(result.markers).toEqual([]);
  });

  it("places the LLM span band on the absolute axis", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:02.000Z" });
    const result = buildVoiceTurnTimeline(
      t,
      [span({ operation: "voice.llm.generate", started_at: "2026-08-18T10:00:00.500Z", ended_at: "2026-08-18T10:00:01.000Z" })],
      [],
      []
    );
    expect(result.hasTimingData).toBe(true);
    const llm = result.bands.find((b) => b.kind === "llm")!;
    // [0.5s, 1s] within a [0s, 2s] turn => left 25%, width 25%.
    expect(llm.leftPct).toBeCloseTo(25, 6);
    expect(llm.widthPct).toBeCloseTo(25, 6);
  });

  it("labels each TTS span by its sentence index and keeps them ordered", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:03.000Z" });
    const spans = [
      span({
        id: "tts-1",
        operation: "voice.tts.synthesize",
        started_at: "2026-08-18T10:00:01.000Z",
        ended_at: "2026-08-18T10:00:01.500Z",
        attributes: JSON.stringify({ sentence_index: 0 }),
      }),
      span({
        id: "tts-2",
        operation: "voice.tts.synthesize",
        started_at: "2026-08-18T10:00:01.500Z",
        ended_at: "2026-08-18T10:00:02.000Z",
        attributes: JSON.stringify({ sentence_index: 1 }),
      }),
    ];
    const result = buildVoiceTurnTimeline(t, spans, [], []);
    const ttsBands = result.bands.filter((b) => b.kind === "tts");
    expect(ttsBands.map((b) => b.label)).toEqual(["TTS #0", "TTS #1"]);
  });

  it("marks a failed span's status and carries the status_message as detail", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:02.000Z" });
    const result = buildVoiceTurnTimeline(
      t,
      [span({ operation: "voice.tts.synthesize", status: "error", status_message: "rate_limited" })],
      [],
      []
    );
    const tts = result.bands.find((b) => b.kind === "tts")!;
    expect(tts.status).toBe("error");
    expect(tts.detail).toBe("rate_limited");
  });

  it("ignores span operations outside the voice llm/tts contract", () => {
    const t = turn({});
    const result = buildVoiceTurnTimeline(t, [span({ operation: "asr.transcribe" })], [], []);
    expect(result.bands.map((b) => b.kind)).toEqual(["turn"]);
  });

  it("pairs ingress speech start/end events into a playout band", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:03.000Z" });
    const events = [
      event({ event_type: "voice.ingress.speech.start", timestamp: "2026-08-18T10:00:01.000Z" }),
      event({ event_type: "voice.ingress.speech.end", timestamp: "2026-08-18T10:00:02.000Z" }),
    ];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    const playout = result.bands.find((b) => b.kind === "playout")!;
    expect(playout.startMs).toBe(Date.parse("2026-08-18T10:00:01.000Z"));
    expect(playout.endMs).toBe(Date.parse("2026-08-18T10:00:02.000Z"));
  });

  it("leaves an unpaired ingress start open (endMs null)", () => {
    const t = turn({});
    const events = [event({ event_type: "voice.ingress.speech.start", timestamp: "2026-08-18T10:00:01.000Z" })];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    const playout = result.bands.find((b) => b.kind === "playout")!;
    expect(playout.endMs).toBeNull();
  });

  it("extends an open band to the axis end instead of collapsing it to a sliver", () => {
    // An in-flight interval (endMs null) must read as still running: its
    // right edge is the axis end (maxTime), not its own start instant.
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:10.000Z" });
    const events = [event({ event_type: "voice.ingress.speech.start", timestamp: "2026-08-18T10:00:02.000Z" })];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    const playout = result.bands.find((b) => b.kind === "playout")!;
    expect(playout.endMs).toBeNull();
    // Start = 2s into a 10s axis → left 20%, extends to 100% → width 80%.
    expect(playout.leftPct).toBeCloseTo(20, 1);
    expect(playout.widthPct).toBeCloseTo(80, 1);
  });

  it("ignores an ingress end with no preceding open start", () => {
    const t = turn({});
    const events = [event({ event_type: "voice.ingress.speech.end", timestamp: "2026-08-18T10:00:01.000Z" })];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    expect(result.bands.find((b) => b.kind === "playout")).toBeUndefined();
  });

  it("pairs multiple non-overlapping playout bands independently", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:05.000Z" });
    const events = [
      event({ event_type: "voice.ingress.speech.start", timestamp: "2026-08-18T10:00:01.000Z" }),
      event({ event_type: "voice.ingress.speech.end", timestamp: "2026-08-18T10:00:01.500Z" }),
      event({ event_type: "voice.ingress.speech.start", timestamp: "2026-08-18T10:00:03.000Z" }),
      event({ event_type: "voice.ingress.speech.end", timestamp: "2026-08-18T10:00:03.500Z" }),
    ];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    expect(result.bands.filter((b) => b.kind === "playout")).toHaveLength(2);
  });

  it("renders interrupt and cancel events as markers, not bands", () => {
    const t = turn({});
    const events = [
      event({ event_type: "voice.turn.interrupt", timestamp: "2026-08-18T10:00:01.000Z" }),
      event({ event_type: "voice.playback.cancel", timestamp: "2026-08-18T10:00:01.200Z" }),
    ];
    const result = buildVoiceTurnTimeline(t, [], events, []);
    expect(result.bands.map((b) => b.kind)).toEqual(["turn"]);
    expect(result.markers.map((m) => m.kind).sort()).toEqual(["cancel", "interrupt"]);
  });

  it("places a tool call marker at its started_at with status/error/retries in detail", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:02.000Z" });
    const result = buildVoiceTurnTimeline(
      t,
      [],
      [],
      [toolCall({ tool_name: "submitRatings", status: "error", error: "timeout", retry_count: 2 })]
    );
    const marker = result.markers.find((m) => m.kind === "tool")!;
    expect(marker.label).toBe("submitRatings");
    expect(marker.status).toBe("error");
    expect(marker.detail).toBe("error — timeout — 2 retries");
  });

  it("ignores non-voice-contract event types entirely", () => {
    const t = turn({});
    const result = buildVoiceTurnTimeline(t, [], [event({ event_type: "message_sent" })], []);
    expect(result.bands.map((b) => b.kind)).toEqual(["turn"]);
    expect(result.markers).toEqual([]);
  });

  it("never produces overlapping-looking negative widths and floors width at 0.5%", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: "2026-08-18T10:00:10.000Z" });
    const result = buildVoiceTurnTimeline(
      t,
      [span({ operation: "voice.llm.generate", started_at: "2026-08-18T10:00:01.000Z", ended_at: "2026-08-18T10:00:01.000Z" })],
      [],
      []
    );
    const llm = result.bands.find((b) => b.kind === "llm")!;
    expect(llm.widthPct).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps an unterminated span open (endMs null) rather than crashing", () => {
    const t = turn({});
    const result = buildVoiceTurnTimeline(
      t,
      [span({ operation: "voice.llm.generate", ended_at: null, duration_ms: null })],
      [],
      []
    );
    const llm = result.bands.find((b) => b.kind === "llm")!;
    expect(llm.endMs).toBeNull();
  });

  it("derives the turn band end from duration_ms when ended_at is absent", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: null, duration_ms: 1500 });
    const result = buildVoiceTurnTimeline(t, [], [], []);
    const turnBand = result.bands[0]!;
    expect(turnBand.endMs).toBe(Date.parse("2026-08-18T10:00:00.000Z") + 1500);
  });

  it("leaves the turn band open when neither ended_at nor duration_ms is known", () => {
    const t = turn({ started_at: "2026-08-18T10:00:00.000Z", ended_at: null, duration_ms: null });
    const result = buildVoiceTurnTimeline(t, [], [], []);
    expect(result.bands[0]!.endMs).toBeNull();
    // Total range still degrades to a non-zero, non-crashing value.
    expect(result.totalRangeMs).toBeGreaterThanOrEqual(1);
  });

  it("computes minTime/maxTime spanning every band and marker", () => {
    const t = turn({ started_at: "2026-08-18T10:00:01.000Z", ended_at: "2026-08-18T10:00:02.000Z" });
    const result = buildVoiceTurnTimeline(
      t,
      [],
      [event({ event_type: "voice.turn.interrupt", timestamp: "2026-08-18T10:00:05.000Z" })],
      []
    );
    expect(result.minTime).toBe(Date.parse("2026-08-18T10:00:01.000Z"));
    expect(result.maxTime).toBe(Date.parse("2026-08-18T10:00:05.000Z"));
  });
});
