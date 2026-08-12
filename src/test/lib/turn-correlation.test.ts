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
  const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);

  it("trace match attaches to exactly one turn", () => {
    const calls = [call({ trace_id: "vturn_a" })];
    expect(assigned(calls).toolsFor(turns[0]!.id)).toHaveLength(1);
    expect(assigned(calls).toolsFor(turns[1]!.id)).toHaveLength(0);
  });

  it("events follow the same single-turn attachment", () => {
    const events = [event({ trace_id: "vturn_b", timestamp: "2026-08-12T08:01:05.000Z" })];
    expect(assigned([], events).eventsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned([], events).eventsFor(turns[1]!.id)).toHaveLength(1);
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
  const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);

  it("identifies the shared trace", () => {
    expect(sharedTraceIds(turns).has("sess_t")).toBe(true);
  });

  it("does not attach a shared-trace call to EVERY turn — time picks exactly one", () => {
    const calls = [call({ trace_id: "sess_t", started_at: "2026-08-12T08:00:05.000Z" })];
    // Shared trace carries no turn information, so the window decides — but it
    // must land on one turn, not all of them.
    expect(assigned(calls).toolsFor(turns[0]!.id)).toHaveLength(1);
    expect(assigned(calls).toolsFor(turns[1]!.id)).toHaveLength(0);
  });

  it("shared-trace events fall back to the time window, landing on ONE turn", () => {
    const events = [event({ trace_id: "sess_t", timestamp: "2026-08-12T08:01:05.000Z" })];
    expect(assigned([], events).eventsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned([], events).eventsFor(turns[1]!.id)).toHaveLength(1);
  });
});

describe("turn_id producers", () => {
  const turns = [turn({ id: "vt_1", trace_id: "sess_t" }), turn({ id: "vt_2", trace_id: "sess_t" })];
  const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);

  it("turn_id === turn.id is the canonical join and always wins", () => {
    const calls = [call({ turn_id: "vt_2" })];
    expect(assigned(calls).toolsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned(calls).toolsFor(turns[1]!.id)).toHaveLength(1);
  });

  it("turn_id matching the turn's own trace also joins (producer-side turn ids)", () => {
    const turnsB = [turn({ id: "vt_1", trace_id: "vturn_a" })];
    const calls = [call({ turn_id: "vturn_a" })];
    expect(createTurnCorrelator(turnsB).assign(calls, []).toolsFor(turnsB[0]!.id)).toHaveLength(1);
  });
});

describe("unkeyed records", () => {
  const turns = [turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" })];
  const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);

  it("fall back to the turn's time window", () => {
    expect(assigned([call({ started_at: "2026-08-12T08:00:05.000Z" })]).toolsFor(turns[0]!.id)).toHaveLength(1);
    expect(assigned([call({ started_at: "2026-08-12T08:05:00.000Z" })]).toolsFor(turns[0]!.id)).toHaveLength(0);
  });
});

describe("window boundaries", () => {
  it("an inferred bound is EXCLUSIVE — a record at the next turn's start belongs to that turn", () => {
    const turns = [
      turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: null }),
      turn({ id: "vt_2", started_at: "2026-08-12T08:01:00.000Z", ended_at: null }),
    ];
    const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);
    const onBoundary = [call({ started_at: "2026-08-12T08:01:00.000Z" })];
    expect(assigned(onBoundary).toolsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned(onBoundary).toolsFor(turns[1]!.id)).toHaveLength(1);
  });

  it("an explicit ended_at stays INCLUSIVE — the closing instant is this turn's", () => {
    const turns = [turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" })];
    const onEnd = [call({ started_at: "2026-08-12T08:00:10.000Z" })];
    expect(createTurnCorrelator(turns).assign(onEnd, []).toolsFor(turns[0]!.id)).toHaveLength(1);
  });
});

describe("shared-trace tool calls without turn_id", () => {
  it("fall back to time rather than being dropped from every card", () => {
    // Round 3 P1: producers copying a session-level trace onto each call have
    // no turn_id, and rejecting them outright meant their payloads appeared
    // nowhere in the Turns view.
    const turns = [
      turn({ id: "vt_1", trace_id: "sess_t", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" }),
      turn({ id: "vt_2", trace_id: "sess_t", started_at: "2026-08-12T08:01:00.000Z", ended_at: "2026-08-12T08:01:10.000Z" }),
    ];
    const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);
    const calls = [call({ trace_id: "sess_t", started_at: "2026-08-12T08:01:05.000Z" })];
    expect(assigned(calls).toolsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned(calls).toolsFor(turns[1]!.id)).toHaveLength(1);
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
    const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);
    const late = [call({ started_at: "2026-08-12T08:01:30.000Z" })];
    expect(assigned(late).toolsFor(turns[0]!.id)).toHaveLength(0);
    expect(assigned(late).toolsFor(turns[1]!.id)).toHaveLength(1);
  });

  it("only the LAST turn stays open", () => {
    const turns = [
      turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: null }),
      turn({ id: "vt_2", started_at: "2026-08-12T08:01:00.000Z", ended_at: null }),
    ];
    const ends = effectiveEnds(turns);
    expect(ends.get("vt_1")).toEqual({ end: Date.parse("2026-08-12T08:01:00.000Z"), inferred: true });
    expect(ends.get("vt_2")).toEqual({ end: Number.POSITIVE_INFINITY, inferred: true });
  });
});

describe("timestamp comparison uses instants, not strings", () => {
  it("orders correctly across RFC 3339 offsets", () => {
    // 09:00:30+01:00 is 08:00:30Z — inside turn 1 — but sorts AFTER "2026-..T08:01"
    // lexically, which would have placed it in turn 2.
    const turns = [
      turn({ id: "vt_1", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:59.000Z" }),
      turn({ id: "vt_2", started_at: "2026-08-12T08:01:00.000Z", ended_at: "2026-08-12T08:02:00.000Z" }),
    ];
    const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);
    const offsetCall = [call({ started_at: "2026-08-12T09:00:30.000+01:00" })];
    expect(assigned(offsetCall).toolsFor(turns[0]!.id)).toHaveLength(1);
    expect(assigned(offsetCall).toolsFor(turns[1]!.id)).toHaveLength(0);
  });

  it("tolerates differing fractional precision", () => {
    const turns = [turn({ id: "vt_1", started_at: "2026-08-12T08:00:00Z", ended_at: "2026-08-12T08:00:10.500Z" })];
    const assigned = (tools=[] , events=[]) => createTurnCorrelator(turns).assign(tools, events);
    expect(assigned([call({ started_at: "2026-08-12T08:00:05.25Z" })]).toolsFor(turns[0]!.id)).toHaveLength(1);
  });
});

describe("mixed keying styles in one session", () => {
  it("assigns a record to exactly ONE turn — key beats window, exclusively", () => {
    // Round 9 P1: an event carrying turn A's unique trace, timestamped inside
    // unkeyed turn B's window, matched A by trace AND B by time — rendered on
    // both cards. Assignment is now a single exclusive pass.
    const turns = [
      turn({ id: "vt_a", trace_id: "trace_a", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" }),
      turn({ id: "vt_b", trace_id: null, started_at: "2026-08-12T08:00:20.000Z", ended_at: "2026-08-12T08:00:30.000Z" }),
    ];
    const a = createTurnCorrelator(turns).assign(
      [],
      [event({ trace_id: "trace_a", timestamp: "2026-08-12T08:00:25.000Z" })]
    );
    expect(a.eventsFor("vt_a")).toHaveLength(1);
    expect(a.eventsFor("vt_b")).toHaveLength(0);
  });

  it("a windowed record still lands when keyed records exist elsewhere", () => {
    const turns = [
      turn({ id: "vt_a", trace_id: "trace_a", started_at: "2026-08-12T08:00:00.000Z", ended_at: "2026-08-12T08:00:10.000Z" }),
      turn({ id: "vt_b", trace_id: null, started_at: "2026-08-12T08:00:20.000Z", ended_at: "2026-08-12T08:00:30.000Z" }),
    ];
    const a = createTurnCorrelator(turns).assign(
      [call({ started_at: "2026-08-12T08:00:25.000Z" })],
      []
    );
    expect(a.toolsFor("vt_b")).toHaveLength(1);
    expect(a.toolsFor("vt_a")).toHaveLength(0);
  });
});
