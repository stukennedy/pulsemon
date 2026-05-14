import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

describe("GET /api/metrics/timeseries", () => {
  it("returns metric series JSON", async () => {
    const ctx = createTestContext();
    ctx.seedMetric({
      metric_name: "voice.latency_ms",
      timestamp: "2026-05-14T10:00:10.000Z",
      value: 120,
    });

    const res = await ctx.request(
      "/api/metrics/timeseries?name=voice.latency_ms&from=2026-05-14T09:59:00.000Z&to=2026-05-14T10:01:00.000Z"
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.source).toBe("raw");
    expect(body.points).toHaveLength(1);
    expect(body.points[0].avg).toBe(120);
  });
});
