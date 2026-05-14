import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

describe("GET /api/slos", () => {
  it("returns SLO definitions and evaluations", async () => {
    const ctx = createTestContext();
    ctx.seedMetric({
      id: "api-slo-metric",
      metric_name: "voice.latency_ms",
      value: 120,
      timestamp: new Date().toISOString(),
    });

    const res = await ctx.request("/api/slos");

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.definitions.length).toBeGreaterThanOrEqual(1);
    expect(body.evaluations.length).toBeGreaterThanOrEqual(1);
    expect(body.evaluations.some((evaluation: any) => evaluation.slo_id === "slo.voice_latency")).toBe(true);
  });
});
