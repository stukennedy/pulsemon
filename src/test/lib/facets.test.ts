import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";
import {
  getConnectionDetail,
  getConnectionFacetValues,
  getLogFacetValues,
  getMetricFacetValues,
  getTraceSpans,
  queryConnections,
  queryLogs,
  queryMetrics,
  queryMetricSummaries,
  querySpans,
} from "@/lib/facets";

describe("facets", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  describe("queryConnections", () => {
    it("returns all connections with no tags", async () => {
      ctx.seedConnection({ service: "a" });
      ctx.seedConnection({ service: "b" });
      const { connections, total } = await queryConnections(ctx.d1, []);
      expect(total).toBe(2);
      expect(connections).toHaveLength(2);
    });

    it("filters by service", async () => {
      ctx.seedConnection({ service: "a" });
      ctx.seedConnection({ service: "b" });
      ctx.seedConnection({ service: "a" });
      const { total } = await queryConnections(ctx.d1, [{ facet: "service", value: "a" }]);
      expect(total).toBe(2);
    });

    it("AND logic across different facets", async () => {
      ctx.seedConnection({ service: "a", status: "active" });
      ctx.seedConnection({ service: "a", status: "error" });
      ctx.seedConnection({ service: "b", status: "active" });
      const { total } = await queryConnections(ctx.d1, [
        { facet: "service", value: "a" },
        { facet: "status", value: "active" },
      ]);
      expect(total).toBe(1);
    });

    it("OR logic for same facet", async () => {
      ctx.seedConnection({ service: "a" });
      ctx.seedConnection({ service: "b" });
      ctx.seedConnection({ service: "c" });
      const { total } = await queryConnections(ctx.d1, [
        { facet: "service", value: "a" },
        { facet: "service", value: "b" },
      ]);
      expect(total).toBe(2);
    });
  });

  describe("getConnectionDetail", () => {
    it("returns connection with events and spans", async () => {
      ctx.seedConnection({ id: "conn-1", service: "gw" });
      ctx.seedEvent({ connection_id: "conn-1", event_type: "message_received" });
      ctx.seedEvent({ connection_id: "conn-1", event_type: "message_sent" });
      ctx.seedSpan({ connection_id: "conn-1", operation: "asr.transcribe" });

      const detail = await getConnectionDetail(ctx.d1, "conn-1");
      expect(detail.connection).not.toBeNull();
      expect(detail.connection!.service).toBe("gw");
      expect(detail.events).toHaveLength(2);
      expect(detail.spans).toHaveLength(1);
    });

    it("returns null for missing connection", async () => {
      const detail = await getConnectionDetail(ctx.d1, "nonexistent");
      expect(detail.connection).toBeNull();
    });
  });

  describe("querySpans", () => {
    it("filters by operation", async () => {
      ctx.seedSpan({ operation: "asr.transcribe" });
      ctx.seedSpan({ operation: "llm.generate" });
      const { spans, total } = await querySpans(ctx.d1, [{ facet: "operation", value: "llm.generate" }]);
      expect(total).toBe(1);
      expect(spans[0].operation).toBe("llm.generate");
    });
  });

  describe("queryLogs", () => {
    it("filters by log level", async () => {
      ctx.seedLog({ level: "info", message: "session opened" });
      ctx.seedLog({ level: "error", message: "provider timeout" });

      const { logs, total } = await queryLogs(ctx.d1, [{ facet: "level", value: "error" }]);
      expect(total).toBe(1);
      expect(logs[0].message).toBe("provider timeout");
    });
  });

  describe("queryMetrics", () => {
    it("filters by metric name", async () => {
      ctx.seedMetric({ metric_name: "voice.latency_ms", value: 120 });
      ctx.seedMetric({ metric_name: "tokens.total", metric_type: "counter", value: 10 });

      const { metrics, total } = await queryMetrics(ctx.d1, [{ facet: "name", value: "tokens.total" }]);
      expect(total).toBe(1);
      expect(metrics[0].metric_name).toBe("tokens.total");
    });

    it("summarizes grouped metrics", async () => {
      ctx.seedMetric({ service: "voice-gateway", metric_name: "voice.latency_ms", value: 100 });
      ctx.seedMetric({ service: "voice-gateway", metric_name: "voice.latency_ms", value: 200 });

      const summaries = await queryMetricSummaries(ctx.d1, []);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        service: "voice-gateway",
        metric_name: "voice.latency_ms",
        count: 2,
        avg: 150,
        min: 100,
        max: 200,
      });
    });
  });

  describe("getTraceSpans", () => {
    it("returns spans for a trace", async () => {
      ctx.seedSpan({ trace_id: "t1", operation: "a" });
      ctx.seedSpan({ trace_id: "t1", operation: "b" });
      ctx.seedSpan({ trace_id: "t2", operation: "c" });

      const spans = await getTraceSpans(ctx.d1, "t1");
      expect(spans).toHaveLength(2);
    });
  });

  describe("getConnectionFacetValues", () => {
    it("returns unique service values", async () => {
      ctx.seedConnection({ service: "alpha" });
      ctx.seedConnection({ service: "beta" });
      ctx.seedConnection({ service: "alpha" });

      const values = await getConnectionFacetValues(ctx.d1, "service", "", []);
      expect(values).toContain("alpha");
      expect(values).toContain("beta");
      expect(values).toHaveLength(2);
    });

    it("filters by prefix", async () => {
      ctx.seedConnection({ service: "alpha" });
      ctx.seedConnection({ service: "beta" });

      const values = await getConnectionFacetValues(ctx.d1, "service", "alp", []);
      expect(values).toEqual(["alpha"]);
    });
  });

  describe("getLogFacetValues", () => {
    it("returns unique log level values", async () => {
      ctx.seedLog({ level: "info" });
      ctx.seedLog({ level: "error" });
      ctx.seedLog({ level: "error" });

      const values = await getLogFacetValues(ctx.d1, "level", "", []);
      expect(values.sort()).toEqual(["error", "info"]);
    });
  });

  describe("getMetricFacetValues", () => {
    it("returns unique metric names", async () => {
      ctx.seedMetric({ metric_name: "voice.latency_ms" });
      ctx.seedMetric({ metric_name: "tokens.total" });
      ctx.seedMetric({ metric_name: "tokens.total" });

      const values = await getMetricFacetValues(ctx.d1, "name", "", []);
      expect(values.sort()).toEqual(["tokens.total", "voice.latency_ms"]);
    });
  });
});
