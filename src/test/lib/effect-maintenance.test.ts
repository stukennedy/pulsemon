import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { createTestContext } from "../helpers";
import { maintenanceConfigFromEnv, runMaintenance } from "@/lib/effect/maintenance";

describe("Effect maintenance service", () => {
  it("rolls up old metric samples and deletes expired raw telemetry", async () => {
    const ctx = createTestContext();
    ctx.seedMetric({
      id: "old-metric-1",
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp: "2000-01-01T00:00:10.000Z",
      value: 100,
    });
    ctx.seedMetric({
      id: "old-metric-2",
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp: "2000-01-01T00:00:40.000Z",
      value: 200,
    });
    ctx.seedMetric({
      id: "future-metric",
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp: "2999-01-01T00:00:00.000Z",
      value: 999,
    });
    ctx.seedConnection({ id: "expired-conn", started_at: "2000-01-01T00:00:00.000Z" });
    ctx.seedConnection({ id: "future-conn", started_at: "2999-01-01T00:00:00.000Z" });

    const result = await Effect.runPromise(runMaintenance(ctx.d1, {
      retentionDays: 7,
      metricRollupAfterMinutes: 0,
      metricRollupRetentionDays: 20000,
      deleteChunkSize: 500,
      deleteMaxChunksPerTable: 20,
    }));

    expect(result.rollups).toBeGreaterThanOrEqual(1);
    expect(result.deleted.connections).toBe(1);
    expect(result.deleted.metrics).toBe(2);

    const rollup = ctx.sqlite.prepare(`
      SELECT service, metric_name, count, avg, min, max, sum
      FROM metric_rollups_1m
      WHERE bucket_start = '2000-01-01T00:00:00.000Z'
    `).get() as any;
    expect(rollup).toEqual({
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      count: 2,
      avg: 150,
      min: 100,
      max: 200,
      sum: 300,
    });

    const remainingConnections = ctx.sqlite
      .prepare("SELECT COUNT(*) AS count FROM connections WHERE id = 'future-conn'")
      .get() as any;
    expect(remainingConnections.count).toBe(1);
  });

  it("deletes expired rows in bounded chunks", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({ id: "expired-conn-1", started_at: "2000-01-01T00:00:00.000Z" });
    ctx.seedConnection({ id: "expired-conn-2", started_at: "2000-01-01T00:01:00.000Z" });
    ctx.seedConnection({ id: "expired-conn-3", started_at: "2000-01-01T00:02:00.000Z" });

    const result = await Effect.runPromise(runMaintenance(ctx.d1, {
      retentionDays: 7,
      metricRollupAfterMinutes: 0,
      metricRollupRetentionDays: 20000,
      deleteChunkSize: 1,
      deleteMaxChunksPerTable: 2,
    }));

    expect(result.deleted.connections).toBe(2);

    const remaining = ctx.sqlite
      .prepare("SELECT COUNT(*) AS count FROM connections WHERE id LIKE 'expired-conn-%'")
      .get() as any;
    expect(remaining.count).toBe(1);
  });

  it("validates maintenance retention config", async () => {
    const result = await Effect.runPromise(Effect.either(
      maintenanceConfigFromEnv({ RETENTION_DAYS: "0" })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toContain("RETENTION_DAYS");
    }
  });

  it("validates maintenance delete chunk config", async () => {
    const result = await Effect.runPromise(Effect.either(
      maintenanceConfigFromEnv({ MAINTENANCE_DELETE_CHUNK_SIZE: "0" })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toContain("MAINTENANCE_DELETE_CHUNK_SIZE");
    }
  });
});
