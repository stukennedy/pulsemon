import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestContext } from "../helpers";
import { createSloDefinition, evaluateAndPersistSlos } from "@/lib/effect/slos";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("Effect SLO service", () => {
  it("evaluates metric threshold SLOs and persists snapshots", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    await Effect.runPromise(createSloDefinition(ctx.d1, DEFAULT_TENANT_SCOPE, {
      id: "slo.voice-fast",
      name: "Voice under 200ms",
      metric_name: "voice.latency_ms",
      objective_percent: 75,
      threshold: 200,
      window_minutes: 15,
    }));

    ctx.seedMetric({ id: "slo-metric-1", metric_name: "voice.latency_ms", timestamp, value: 100 });
    ctx.seedMetric({ id: "slo-metric-2", metric_name: "voice.latency_ms", timestamp, value: 150 });
    ctx.seedMetric({ id: "slo-metric-3", metric_name: "voice.latency_ms", timestamp, value: 250 });
    ctx.seedMetric({ id: "slo-metric-4", metric_name: "voice.latency_ms", timestamp, value: 300 });

    const result = await Effect.runPromise(evaluateAndPersistSlos(ctx.d1, DEFAULT_TENANT_SCOPE));
    const custom = result.evaluations.find((evaluation) => evaluation.slo_id === "slo.voice-fast");

    expect(custom?.attainment_percent).toBe(50);
    expect(custom?.good_events).toBe(2);
    expect(custom?.total_events).toBe(4);

    const persisted = ctx.sqlite
      .prepare("SELECT COUNT(*) AS count FROM slo_evaluations WHERE slo_id = ?")
      .get("slo.voice-fast") as any;
    expect(persisted.count).toBe(1);
  });
});
