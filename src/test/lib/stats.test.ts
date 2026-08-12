import { describe, expect, it } from "bun:test";
import { queryDashboardStats } from "@/lib/stats";
import { createTestContext } from "../helpers";

describe("dashboard voice percentiles", () => {
  it("excludes invalid historical negative latency samples", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ id: "valid", asr_latency_ms: 120 });
    ctx.seedVoiceTurn({ id: "invalid-history", asr_latency_ms: -400 });

    const stats = await queryDashboardStats(ctx.d1);

    expect(stats.p50Latency.asr).toBe(120);
    expect(stats.p95Latency.asr).toBe(120);
    expect(stats.p99Latency.asr).toBe(120);
  });
});
