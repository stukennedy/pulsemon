import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { createTestContext } from "../helpers";
import { createSloDefinition, evaluateAndPersistSlos } from "@/lib/effect/slos";
import { resolveVoiceSloSource, VOICE_SLO_SOURCES } from "@/lib/effect/voice-slo";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("voice SLO sources", () => {
  it("resolves only reserved voice metric names", () => {
    expect(resolveVoiceSloSource("voice.turns.audio_latency_ms")?.table).toBe("voice_turns");
    expect(resolveVoiceSloSource("voice.tools.error")?.table).toBe("agent_tool_calls");
    expect(resolveVoiceSloSource("voice.latency_ms")).toBeUndefined();
    expect(resolveVoiceSloSource("http.request_duration_ms")).toBeUndefined();
  });

  it("keeps registry metric names unique", () => {
    const names = VOICE_SLO_SOURCES.map((source) => source.metric_name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Effect voice SLO evaluation", () => {
  it("evaluates latency objectives from voice_turns, ignoring turns without the stage", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    // 3 turns recorded release→audible latency: 800ms, 1200ms good; 2000ms bad.
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, audio_latency_ms: 800 });
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, audio_latency_ms: 1200 });
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, audio_latency_ms: 2000 });
    // A user turn without audio latency must not count against the objective.
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const evaluation = result.evaluations.find((item) => item.slo_id === "slo.voice_reply_audible");

    expect(evaluation?.total_events).toBe(3);
    expect(evaluation?.good_events).toBe(2);
    expect(evaluation?.attainment_percent).toBeCloseTo((2 / 3) * 100);
  });

  it("evaluates the interruption flag objective across all turns", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, interruption: 0 });
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, interruption: 0 });
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, interruption: 0 });
    ctx.seedVoiceTurn({ session_id: "s1", started_at: timestamp, interruption: 1 });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const evaluation = result.evaluations.find((item) => item.slo_id === "slo.voice_uninterrupted_turns");

    expect(evaluation?.total_events).toBe(4);
    expect(evaluation?.good_events).toBe(3);
    expect(evaluation?.attainment_percent).toBe(75);
  });

  it("evaluates tool success from agent_tool_calls", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    ctx.seedAgentToolCall({ started_at: timestamp, status: "ok" });
    ctx.seedAgentToolCall({ started_at: timestamp, status: "ok" });
    ctx.seedAgentToolCall({ started_at: timestamp, status: "error" });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const evaluation = result.evaluations.find((item) => item.slo_id === "slo.agent_tool_success");

    expect(evaluation?.total_events).toBe(3);
    expect(evaluation?.good_events).toBe(2);
    expect(evaluation?.attainment_percent).toBeCloseTo((2 / 3) * 100);
  });

  it("only counts turns inside the evaluation window", async () => {
    const ctx = createTestContext();

    await Effect.runPromise(createSloDefinition(ctx.d1, DEFAULT_TENANT_SCOPE, {
      id: "slo.voice-window",
      name: "Recent audio latency",
      metric_name: "voice.turns.audio_latency_ms",
      objective_percent: 95,
      threshold: 1500,
      window_minutes: 15,
    }));

    ctx.seedVoiceTurn({ started_at: new Date().toISOString(), audio_latency_ms: 100 });
    ctx.seedVoiceTurn({
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      audio_latency_ms: 9000,
    });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const evaluation = result.evaluations.find((item) => item.slo_id === "slo.voice-window");

    expect(evaluation?.total_events).toBe(1);
    expect(evaluation?.good_events).toBe(1);
  });

  it("scopes voice objectives to the tenant", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    ctx.seedVoiceTurn({ started_at: timestamp, audio_latency_ms: 100 });
    ctx.seedVoiceTurn({
      started_at: timestamp,
      audio_latency_ms: 9000,
      workspace_id: "other-workspace",
      project_id: "other-project",
    });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const evaluation = result.evaluations.find((item) => item.slo_id === "slo.voice_reply_audible");

    expect(evaluation?.total_events).toBe(1);
    expect(evaluation?.good_events).toBe(1);
  });

  it("rejects a service filter on voice objectives", async () => {
    const ctx = createTestContext();

    const result = await Effect.runPromise(Effect.either(createSloDefinition(ctx.d1, DEFAULT_TENANT_SCOPE, {
      name: "Voice with service",
      metric_name: "voice.turns.llm_latency_ms",
      service: "voice-gateway",
      objective_percent: 95,
      threshold: 3000,
      window_minutes: 60,
    })));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
    }
  });
});
