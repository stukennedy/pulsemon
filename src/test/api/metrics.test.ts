import { describe, expect, it, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

describe("GET /api/metrics", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("returns empty table when no metrics exist", async () => {
    const res = await ctx.request("/api/metrics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No metrics match");
    expect(html).toContain("0 samples");
  });

  it("returns metric summaries and recent samples", async () => {
    ctx.seedMetric({ service: "voice-gateway", metric_name: "voice.latency_ms", value: 100 });
    ctx.seedMetric({ service: "voice-gateway", metric_name: "voice.latency_ms", value: 200 });
    ctx.seedMetric({ service: "llm-service", metric_name: "tokens.total", metric_type: "counter", value: 42 });

    const res = await ctx.request("/api/metrics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("voice.latency_ms");
    expect(html).toContain("tokens.total");
    expect(html).toContain("3 samples");
  });

  it("filters metrics by metric name tag", async () => {
    ctx.seedMetric({ metric_name: "voice.latency_ms", value: 100 });
    ctx.seedMetric({ metric_name: "tokens.total", metric_type: "counter", value: 42 });

    const res = await ctx.request("/api/metrics?tags=name:tokens.total");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("tokens.total");
    expect(html).not.toContain("voice.latency_ms");
    expect(html).toContain("1 sample");
  });
});
