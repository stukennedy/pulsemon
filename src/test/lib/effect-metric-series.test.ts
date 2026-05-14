import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { createTestContext } from "../helpers";
import { queryMetricSeries } from "@/lib/effect/metric-series";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("Effect metric series queries", () => {
  it("uses raw metric samples for short windows", async () => {
    const ctx = createTestContext();
    ctx.seedMetric({
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp: "2026-05-14T10:00:10.000Z",
      value: 100,
    });
    ctx.seedMetric({
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp: "2026-05-14T10:00:40.000Z",
      value: 200,
    });

    const result = await Effect.runPromise(queryMetricSeries(ctx.d1, DEFAULT_TENANT_SCOPE, {
      metric_name: "voice.latency_ms",
      from: "2026-05-14T09:59:00.000Z",
      to: "2026-05-14T10:01:00.000Z",
    }));

    expect(result.source).toBe("raw");
    expect(result.points).toEqual([{
      bucket_start: "2026-05-14T10:00:00.000Z",
      count: 2,
      avg: 150,
      min: 100,
      max: 200,
      sum: 300,
    }]);
  });

  it("uses metric rollups for long windows", async () => {
    const ctx = createTestContext();
    ctx.sqlite.prepare(`
      INSERT INTO metric_rollups_1m (
        id, workspace_id, project_id, service, metric_name, metric_type, bucket_start, count, avg, min, max, sum
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "rollup-1",
      "default",
      "default",
      "voice-gateway",
      "voice.latency_ms",
      "histogram",
      "2026-05-14T10:00:00.000Z",
      2,
      150,
      100,
      200,
      300,
    );

    const result = await Effect.runPromise(queryMetricSeries(ctx.d1, DEFAULT_TENANT_SCOPE, {
      metric_name: "voice.latency_ms",
      from: "2026-05-14T00:00:00.000Z",
      to: "2026-05-14T12:00:00.000Z",
    }));

    expect(result.source).toBe("rollup");
    expect(result.points[0]).toMatchObject({
      bucket_start: "2026-05-14T10:00:00.000Z",
      count: 2,
      avg: 150,
      min: 100,
      max: 200,
      sum: 300,
    });
  });

  it("validates bad time windows", async () => {
    const ctx = createTestContext();
    const result = await Effect.runPromise(Effect.either(queryMetricSeries(ctx.d1, DEFAULT_TENANT_SCOPE, {
      from: "2026-05-14T10:00:00.000Z",
      to: "2026-05-14T09:00:00.000Z",
    })));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toContain("from");
    }
  });
});
