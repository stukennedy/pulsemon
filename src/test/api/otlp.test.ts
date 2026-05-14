import { describe, expect, it, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

const authHeaders = {
  Authorization: "Bearer test-key",
  "Content-Type": "application/json",
};

describe("POST /api/ingest/otlp", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("translates OTLP JSON traces into spans", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/traces", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        resourceSpans: [{
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "voice-gateway" } }],
          },
          scopeSpans: [{
            spans: [{
              traceId: "trace-otlp-1",
              spanId: "span-otlp-1",
              name: "voice.turn",
              startTimeUnixNano: "1800000000000000000",
              endTimeUnixNano: "1800000000500000000",
              status: { code: 2, message: "provider failed" },
              attributes: [{ key: "connection.id", value: { stringValue: "conn-otlp-1" } }],
            }],
          }],
        }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { spans: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT trace_id, service, operation, duration_ms, status, status_message, connection_id FROM spans WHERE id = ?")
      .get("span-otlp-1") as any;

    expect(row).toEqual({
      trace_id: "trace-otlp-1",
      service: "voice-gateway",
      operation: "voice.turn",
      duration_ms: 500,
      status: "error",
      status_message: "provider failed",
      connection_id: "conn-otlp-1",
    });
  });

  it("translates OTLP JSON metrics into metric samples", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        resourceMetrics: [{
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "voice-gateway" } }],
          },
          scopeMetrics: [{
            metrics: [{
              name: "voice.latency_ms",
              gauge: {
                dataPoints: [{
                  timeUnixNano: "1800000000000000000",
                  asDouble: 123.4,
                  attributes: [{ key: "provider", value: { stringValue: "asr" } }],
                }],
              },
            }],
          }],
        }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { metrics: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT service, metric_name, metric_type, value, tags FROM metrics WHERE metric_name = ?")
      .get("voice.latency_ms") as any;

    expect(row).toEqual({
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      metric_type: "gauge",
      value: 123.4,
      tags: JSON.stringify({ provider: "asr" }),
    });
  });

  it("translates OTLP JSON logs into log records", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/logs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        resourceLogs: [{
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "voice-gateway" } }],
          },
          scopeLogs: [{
            logRecords: [{
              timeUnixNano: "1800000000000000000",
              severityText: "ERROR",
              body: { stringValue: "provider timeout" },
              traceId: "trace-otlp-1",
              spanId: "span-otlp-1",
              attributes: [{ key: "connection.id", value: { stringValue: "conn-otlp-1" } }],
            }],
          }],
        }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { logs: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT service, level, message, trace_id, span_id, connection_id FROM logs WHERE message = ?")
      .get("provider timeout") as any;

    expect(row).toEqual({
      service: "voice-gateway",
      level: "error",
      message: "provider timeout",
      trace_id: "trace-otlp-1",
      span_id: "span-otlp-1",
      connection_id: "conn-otlp-1",
    });
  });
});
