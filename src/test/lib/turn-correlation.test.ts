import { describe, expect, it } from "bun:test";
import { createTurnCorrelator, effectiveEnds, sharedTraceIds } from "@/lib/turn-correlation";
import type { AgentToolCall, Event, VoiceTurn } from "@/db/schema";

const turn = (partial: Partial<VoiceTurn>): VoiceTurn =>
  ({
    id: "vt_1",
    workspace_id: "default",
    project_id: "default",
    role: "agent",
    started_at: "2026-08-12T08:00:00.000Z",
    ended_at: "2026-08-12T08:00:10.000Z",
    interruption: 0,
    ...partial,
  }) as VoiceTurn;

const call = (partial: Partial<AgentToolCall>): AgentToolCall =>
  ({
    id: "tc_1",
    workspace_id: "default",
    project_id: "default",
    tool_name: "updateGoal",
    started_at: "2026-08-12T08:00:05.000Z",
    status: "ok",
    retry_count: 0,
    ...partial,
  }) as AgentToolCall;

const event = (partial: Partial<Event>): Event =>
  ({
    id: "ev_1",
    workspace_id: "default",
    project_id: "default",
    event_type: "voice.llm.completed",
    timestamp: "2026-08-12T08:00:05.000Z",
    ...partial,
  }) as Event;

describe("per-turn traces (one trace per turn — e.g. the DPT producer)", () => {
  const turns = [
    turn({ id: "vt_1", trace_id: "vturn_a" }),
    turn({ id: "vt_2", trace_id: "vturn_b", started_at: "2026-08-12T08:01:00.000Z" }),
  ];
  const correlator = createTurnCorrelator(turns);

  it("trace match attaches to exactly one turn", () => {
    const calls = [call({ trace_id: "vturn_a" })];
    expect(correlator.toolsForTurn(turns[0]!, calls)).toHaveLength(1);
    expect(correlator.toolsForTurn(turns[1]!, calls)).toHaveLength(0);
  });

  it("events follow the same single-turn attachment", () => {
    const events = [event({ trace_id: "vturn_b", timestamp: "2026-08-12T08:01:05.000Z" })];
    expect(correlator.eventsForTurn(turns[0]!, events)).toHaveLength(0);
    expect(correlator.eventsForTurn(turns[1]!, events)).toHaveLength(1);
  });
});

describe("session-level traces (every turn shares one trace)", () => {
  // The P1 case: a shared trace is a SESSION key. Matching on it attached
  // every call and every event to every turn — payloads and errors repeated
  // and misattributed on each card.
  const turns = [
    turn({ id: "vt_1", trace_id: "sess_t", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" }),
    turn({ id: "vt_2", trace_id: "sess_t", started_at: "2026-08-12T08:01:00.000Z", ended_at: "2026-08-12T08:01:10.000Z" }),
  ];
  const correlator = createTurnCorrelator(turns);

  it("identifies the shared trace", () => {
    expect(sharedTraceIds(turns).has("sess_t")).toBe(true);
  });

  it("does NOT attach a shared-trace call to every turn — time decides nothing here", () => {
    const calls = [call({ trace_id: "sess_t", started_at: "2026-08-12T08:00:05.000Z" })];
    // trace_id present but shared → not a turn key → no trace attachment.
    expect(correlator.toolsForTurn(turns[0]!, calls)).toHaveLength(0);
    expect(correlator.toolsForTurn(turns[1]!, calls)).toHaveLength(0);
  });

  it("shared-trace events fall back to the time window, landing on ONE turn", () => {
    const events = [event({ trace_id: "sess_t", timestamp: "2026-08-12T08:01:05.000Z" })];
    expect(correlator.eventsForTurn(turns[0]!, events)).toHaveLength(0);
    expect(correlator.eventsForTurn(turns[1]!, events)).toHaveLength(1);
  });
});

describe("turn_id producers", () => {
  const turns = [turn({ id: "vt_1", trace_id: "sess_t" }), turn({ id: "vt_2", trace_id: "sess_t" })];
  const correlator = createTurnCorrelator(turns);

  it("turn_id === turn.id is the canonical join and always wins", () => {
    const calls = [call({ turn_id: "vt_2" })];
    expect(correlator.toolsForTurn(turns[0]!, calls)).toHaveLength(0);
    expect(correlator.toolsForTurn(turns[1]!, calls)).toHaveLength(1);
  });

  it("turn_id matching the turn's own trace also joins (producer-side turn ids)", () => {
    const turnsB = [turn({ id: "vt_1", trace_id: "vturn_a" })];
    const calls = [call({ turn_id: "vturn_a" })];
    expect(createTurnCorrelator(turnsB).toolsForTurn(turnsB[0]!, calls)).toHaveLength(1);
  });
});

describe("unkeyed records", () => {
  const turns = [turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" })];
  const correlator = createTurnCorrelator(turns);

  it("fall back to the turn's time window", () => {
    expect(correlator.toolsForTurn(turns[0]!, [call({ started_at: "2026-08-12T08:00:05.000Z" })])).toHaveLength(1);
    expect(correlator.toolsForTurn(turns[0]!, [call({ started_at: "2026-08-12T08:05:00.000Z" })])).toHaveLength(0);
  });
});

describe("turns without ended_at (ingest allows them)", () => {
  it("bounds an unfinished turn at the NEXT turn's start, not year 9999", () => {
    // Codex round 2: left open-ended, every later record time-matched every
    // preceding unfinished turn — one payload rendered on every earlier card.
    const turns = [
      turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: null }),
      turn({ id: "vt_2", started_at: "2026-08-12T08:01:00.000Z", ended_at: null }),
    ];
    const correlator = createTurnCorrelator(turns);
    const late = [call({ started_at: "2026-08-12T08:01:30.000Z" })];
    expect(correlator.toolsForTurn(turns[0]!, late)).toHaveLength(0);
    expect(correlator.toolsForTurn(turns[1]!, late)).toHaveLength(1);
  });

  it("only the LAST turn stays open", () => {
    const turns = [
      turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: null }),
      turn({ id: "vt_2", started_at: "2026-08-12T08:01:00.000Z", ended_at: null }),
    ];
    const ends = effectiveEnds(turns);
    expect(ends.get("vt_1")).toBe("2026-08-12T08:01:00.000Z");
    expect(ends.get("vt_2")).toBe("9999");
  });
});
