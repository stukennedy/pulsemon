import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestContext } from "../helpers";
import { getRealtimeSession, queryVoiceSessionSummaries } from "@/lib/effect/sessions";
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

  it("returns a correlated session timeline", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({ id: "conn-a", session_id: "session-a" });
    ctx.seedVoiceTurn({ session_id: "session-a", connection_id: "conn-a", trace_id: "trace-a" });
    ctx.seedAgentToolCall({ session_id: "session-a", connection_id: "conn-a", trace_id: "trace-a" });
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
  });
});
