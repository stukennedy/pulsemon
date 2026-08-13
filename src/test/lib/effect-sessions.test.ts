import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestContext } from "../helpers";
import { getRealtimeSession, queryVoiceSessionSummaries, queryVoiceStageStats } from "@/lib/effect/sessions";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("Effect voice session queries", () => {
  it("summarizes voice turns and agent tool calls by session", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({
      session_id: "session-a",
      connection_id: "conn-a",
      trace_id: "trace-a",
      asr_latency_ms: 200,
      llm_latency_ms: 800,
      tts_latency_ms: 300,
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 0.01,
    });
    ctx.seedVoiceTurn({
      session_id: "session-a",
      connection_id: "conn-a",
      trace_id: "trace-a",
      interruption: 1,
      asr_latency_ms: 400,
      llm_latency_ms: 1000,
      tts_latency_ms: 500,
      input_tokens: 5,
      output_tokens: 10,
      cost_usd: 0.02,
    });
    ctx.seedAgentToolCall({ session_id: "session-a", trace_id: "trace-a", status: "error" });

    const summaries = await Effect.runPromise(queryVoiceSessionSummaries(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      session_id: "session-a",
      connection_id: "conn-a",
      trace_id: "trace-a",
      turn_count: 2,
      interruption_count: 1,
      tool_call_count: 1,
      tool_error_count: 1,
      avg_asr_latency_ms: 300,
      avg_llm_latency_ms: 900,
      avg_tts_latency_ms: 400,
      total_tokens: 45,
    });
    expect(summaries[0].cost_usd).toBeCloseTo(0.03);
  });

  it("excludes invalid historical negative latency samples from session averages", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "session-a", asr_latency_ms: 120 });
    ctx.seedVoiceTurn({ session_id: "session-a", asr_latency_ms: -400 });

    const summaries = await Effect.runPromise(queryVoiceSessionSummaries(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(summaries[0]?.avg_asr_latency_ms).toBe(120);
  });

  it("returns a correlated session timeline", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({ id: "conn-a", session_id: "session-a" });
    ctx.seedVoiceTurn({ id: "turn-a", session_id: "session-a", connection_id: "conn-a", trace_id: "trace-a" });
    ctx.seedAgentToolCall({ id: "tool-a", session_id: "session-a", connection_id: "conn-a", trace_id: "trace-a" });
    ctx.seedSpan({ trace_id: "trace-a", connection_id: "conn-a", operation: "llm.generate" });
    ctx.seedLog({ trace_id: "trace-a", connection_id: "conn-a", message: "tool completed" });
    ctx.seedEvent({ trace_id: "trace-a", connection_id: "conn-a", event_type: "message_sent" });

    const detail = await Effect.runPromise(getRealtimeSession(ctx.d1, DEFAULT_TENANT_SCOPE, "session-a"));

    expect(detail.summary?.session_id).toBe("session-a");
    expect(detail.connection?.id).toBe("conn-a");
    expect(detail.turns).toHaveLength(1);
    expect(detail.toolCalls).toHaveLength(1);
    expect(detail.spans).toHaveLength(1);
    expect(detail.logs).toHaveLength(1);
    expect(detail.events).toHaveLength(1);
    expect(detail.turnsWithTelemetry).toEqual([
      expect.objectContaining({
        turn: expect.objectContaining({ id: "turn-a" }),
        toolCalls: [expect.objectContaining({ id: "tool-a" })],
        events: [expect.objectContaining({ event_type: "message_sent" })],
      }),
    ]);
    expect(detail.waterfallRows).toHaveLength(1);
    expect(detail.timeline.map((entry) => entry.type).sort()).toEqual([
      "event", "log", "span", "tool", "turn",
    ]);
  });

  it("includes a turn-keyed tool call even when it omits session_id", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({
      id: "turn-a",
      session_id: "session-a",
      trace_id: "trace-a",
      started_at: "2026-08-12T08:00:00.000Z",
    });
    ctx.seedAgentToolCall({
      id: "tool-a",
      session_id: null,
      turn_id: "turn-a",
      started_at: "2026-08-12T08:00:01.000Z",
    });

    const detail = await Effect.runPromise(getRealtimeSession(ctx.d1, DEFAULT_TENANT_SCOPE, "session-a"));

    expect(detail.toolCalls.map((call) => call.id)).toEqual(["tool-a"]);
    expect(detail.turnsWithTelemetry[0]?.toolCalls.map((call) => call.id)).toEqual(["tool-a"]);
  });

  it("loads a session large enough to exceed D1's 100 bound parameter limit", async () => {
    // Regression: scan_B2fh16ltHKfD (50 turns, 25 traces) made the
    // agent_tool_calls lookup bind 104 parameters and 500 on UAT.
    const ctx = createTestContext();
    for (let i = 0; i < 50; i++) {
      ctx.seedVoiceTurn({
        id: `turn-${i}`,
        session_id: "session-big",
        connection_id: "conn-big",
        trace_id: `trace-${Math.floor(i / 2)}`,
        started_at: new Date(Date.UTC(2026, 7, 12, 8, 0, i)).toISOString(),
      });
    }
    ctx.seedAgentToolCall({ id: "tool-big", session_id: "session-big", trace_id: "trace-0" });

    const detail = await Effect.runPromise(getRealtimeSession(ctx.d1, DEFAULT_TENANT_SCOPE, "session-big"));

    expect(detail.turns).toHaveLength(50);
    expect(detail.toolCalls.map((call) => call.id)).toEqual(["tool-big"]);
    expect(detail.summary?.session_id).toBe("session-big");
  });

  it("summarizes more sessions than fit in one bound parameter budget", async () => {
    // The tool-call aggregation binds one parameter per session, so >98
    // distinct sessions breaks the single-query form against real D1.
    const ctx = createTestContext();
    for (let i = 0; i < 120; i++) {
      ctx.seedVoiceTurn({ session_id: `session-${String(i).padStart(3, "0")}` });
      ctx.seedAgentToolCall({ session_id: `session-${String(i).padStart(3, "0")}` });
    }

    const summaries = await Effect.runPromise(queryVoiceSessionSummaries(ctx.d1, DEFAULT_TENANT_SCOPE, 200));

    expect(summaries).toHaveLength(120);
    expect(summaries.every((summary) => summary.tool_call_count === 1)).toBe(true);
  });

  it("excludes invalid historical negative latencies from voice stage stats", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ id: "valid", asr_latency_ms: 120 });
    ctx.seedVoiceTurn({ id: "invalid-history", asr_latency_ms: -400 });

    const stats = await Effect.runPromise(queryVoiceStageStats(ctx.d1, DEFAULT_TENANT_SCOPE));
    const asr = stats.find((stage) => stage.stage === "asr");

    expect(asr).toMatchObject({ samples: 1, avg: 120, p50: 120, p95: 120 });
  });
});
