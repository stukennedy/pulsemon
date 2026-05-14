import { describe, expect, it, beforeEach } from "bun:test";
import {
  OTLP_CONNECTION_ID,
  OTLP_LOG_MESSAGE,
  OTLP_HISTOGRAM_METRIC_NAME,
  OTLP_METRIC_NAME,
  OTLP_METRIC_VALUE,
  OTLP_PARENT_SPAN_ID,
  OTLP_SERVICE_NAME,
  OTLP_SESSION_ID,
  OTLP_SPAN_ID,
  OTLP_TRACE_ID,
  OTLP_TRACE_OPERATION,
  OTLP_SUMMARY_METRIC_NAME,
  otlpJsonHistogramMetricRequest,
  otlpJsonLogRequest,
  otlpJsonMetricRequest,
  otlpJsonSummaryMetricRequest,
  otlpJsonTraceRequest,
  otlpProtobufHistogramMetricRequest,
  otlpProtobufLogRequest,
  otlpProtobufMetricRequest,
  otlpProtobufSummaryMetricRequest,
  otlpProtobufTraceRequest,
} from "../fixtures/otlp";
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
      body: JSON.stringify(otlpJsonTraceRequest),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { spans: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT trace_id, parent_span_id, service, operation, duration_ms, status, status_message, connection_id, attributes FROM spans WHERE id = ?")
      .get(OTLP_SPAN_ID) as any;

    expect({ ...row, attributes: undefined }).toEqual({
      trace_id: OTLP_TRACE_ID,
      parent_span_id: OTLP_PARENT_SPAN_ID,
      service: OTLP_SERVICE_NAME,
      operation: OTLP_TRACE_OPERATION,
      duration_ms: 500,
      status: "error",
      status_message: "provider failed",
      connection_id: OTLP_CONNECTION_ID,
      attributes: undefined,
    });
    expect(JSON.parse(row.attributes)).toMatchObject({
      "connection.id": OTLP_CONNECTION_ID,
      "session.id": OTLP_SESSION_ID,
      "gen_ai.operation.name": "chat",
      "voice.pipeline.stage": "turn",
    });
  });

  it("translates OTLP JSON metrics into metric samples", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(otlpJsonMetricRequest),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { metrics: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT service, metric_name, metric_type, value, tags FROM metrics WHERE metric_name = ?")
      .get(OTLP_METRIC_NAME) as any;

    expect({ ...row, tags: undefined }).toEqual({
      service: OTLP_SERVICE_NAME,
      metric_name: OTLP_METRIC_NAME,
      metric_type: "gauge",
      value: OTLP_METRIC_VALUE,
      tags: undefined,
    });
    expect(JSON.parse(row.tags)).toMatchObject({
      provider: "asr",
      "session.id": OTLP_SESSION_ID,
      "gen_ai.request.model": "gpt-realtime",
    });
  });

  it("preserves OTLP JSON histogram distribution details", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(otlpJsonHistogramMetricRequest),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { metrics: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT metric_name, metric_type, value, unit, count, sum, min, max, buckets, tags FROM metrics WHERE metric_name = ?")
      .get(OTLP_HISTOGRAM_METRIC_NAME) as any;

    expect({ ...row, buckets: undefined, tags: undefined }).toEqual({
      metric_name: OTLP_HISTOGRAM_METRIC_NAME,
      metric_type: "histogram",
      value: 400,
      unit: "ms",
      count: 4,
      sum: 400,
      min: 50,
      max: 150,
      buckets: undefined,
      tags: undefined,
    });
    expect(JSON.parse(row.buckets)).toEqual({
      explicit_bounds: [50, 100, 200],
      bucket_counts: [1, 2, 1, 0],
    });
    expect(JSON.parse(row.tags)).toMatchObject({
      provider: "turn-detector",
      "session.id": OTLP_SESSION_ID,
    });
  });

  it("translates OTLP JSON summary metrics into quantile samples", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(otlpJsonSummaryMetricRequest),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { metrics: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT metric_name, metric_type, value, unit, count, sum, quantiles FROM metrics WHERE metric_name = ?")
      .get(OTLP_SUMMARY_METRIC_NAME) as any;

    expect({ ...row, quantiles: undefined }).toEqual({
      metric_name: OTLP_SUMMARY_METRIC_NAME,
      metric_type: "summary",
      value: 900,
      unit: "ms",
      count: 10,
      sum: 900,
      quantiles: undefined,
    });
    expect(JSON.parse(row.quantiles)).toEqual([
      { quantile: 0.5, value: 80 },
      { quantile: 0.95, value: 140 },
    ]);
  });

  it("translates OTLP JSON logs into log records", async () => {
    const res = await ctx.request("/api/ingest/otlp/v1/logs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(otlpJsonLogRequest),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { logs: 1 } });

    const row = ctx.sqlite
      .prepare("SELECT service, level, message, trace_id, span_id, connection_id, attributes FROM logs WHERE message = ?")
      .get(OTLP_LOG_MESSAGE) as any;

    expect({ ...row, attributes: undefined }).toEqual({
      service: OTLP_SERVICE_NAME,
      level: "error",
      message: OTLP_LOG_MESSAGE,
      trace_id: OTLP_TRACE_ID,
      span_id: OTLP_SPAN_ID,
      connection_id: OTLP_CONNECTION_ID,
      attributes: undefined,
    });
    expect(JSON.parse(row.attributes)).toMatchObject({
      "connection.id": OTLP_CONNECTION_ID,
      "session.id": OTLP_SESSION_ID,
      "event.name": "voice.provider.timeout",
    });
  });

  it("accepts gzip-compressed OTLP JSON request bodies", async () => {
    const payload = JSON.stringify(otlpJsonLogRequest);

    const res = await ctx.request("/api/ingest/otlp/v1/logs", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: Bun.gzipSync(Buffer.from(payload)),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ counts: { logs: 1 } });
  });

  it("accepts OTLP protobuf traces, metrics, and logs", async () => {
    const traceRes = await ctx.request("/api/ingest/otlp/v1/traces", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: otlpProtobufTraceRequest,
    });

    expect(traceRes.status).toBe(201);
    const traceBody = await traceRes.json() as unknown;
    expect(traceBody).toEqual({ counts: { spans: 1 } });

    const span = ctx.sqlite
      .prepare("SELECT trace_id, id, parent_span_id, service, operation, duration_ms, status, status_message, connection_id, attributes FROM spans WHERE id = ?")
      .get(OTLP_SPAN_ID) as any;
    expect({ ...span, attributes: undefined }).toEqual({
      trace_id: OTLP_TRACE_ID,
      id: OTLP_SPAN_ID,
      parent_span_id: OTLP_PARENT_SPAN_ID,
      service: OTLP_SERVICE_NAME,
      operation: OTLP_TRACE_OPERATION,
      duration_ms: 500,
      status: "error",
      status_message: "provider failed",
      connection_id: OTLP_CONNECTION_ID,
      attributes: undefined,
    });
    expect(JSON.parse(span.attributes)).toMatchObject({
      "session.id": OTLP_SESSION_ID,
      "gen_ai.operation.name": "chat",
    });

    const metricRes = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: otlpProtobufMetricRequest,
    });
    expect(metricRes.status).toBe(201);
    const metricBody = await metricRes.json() as unknown;
    expect(metricBody).toEqual({ counts: { metrics: 1 } });

    const metric = ctx.sqlite
      .prepare("SELECT service, metric_name, metric_type, value, tags FROM metrics WHERE metric_name = ?")
      .get(OTLP_METRIC_NAME) as any;
    expect({ ...metric, tags: undefined }).toEqual({
      service: OTLP_SERVICE_NAME,
      metric_name: OTLP_METRIC_NAME,
      metric_type: "gauge",
      value: OTLP_METRIC_VALUE,
      tags: undefined,
    });
    expect(JSON.parse(metric.tags)).toMatchObject({
      provider: "asr",
      "session.id": OTLP_SESSION_ID,
      "gen_ai.request.model": "gpt-realtime",
    });

    const histogramRes = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: otlpProtobufHistogramMetricRequest,
    });
    expect(histogramRes.status).toBe(201);
    const histogramBody = await histogramRes.json() as unknown;
    expect(histogramBody).toEqual({ counts: { metrics: 1 } });

    const histogram = ctx.sqlite
      .prepare("SELECT metric_type, value, unit, count, sum, min, max, buckets FROM metrics WHERE metric_name = ?")
      .get(OTLP_HISTOGRAM_METRIC_NAME) as any;
    expect({ ...histogram, buckets: undefined }).toEqual({
      metric_type: "histogram",
      value: 400,
      unit: "ms",
      count: 4,
      sum: 400,
      min: 50,
      max: 150,
      buckets: undefined,
    });
    expect(JSON.parse(histogram.buckets)).toEqual({
      explicit_bounds: [50, 100, 200],
      bucket_counts: [1, 2, 1, 0],
    });

    const summaryRes = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: otlpProtobufSummaryMetricRequest,
    });
    expect(summaryRes.status).toBe(201);
    const summaryBody = await summaryRes.json() as unknown;
    expect(summaryBody).toEqual({ counts: { metrics: 1 } });

    const summary = ctx.sqlite
      .prepare("SELECT metric_type, value, unit, count, sum, quantiles FROM metrics WHERE metric_name = ?")
      .get(OTLP_SUMMARY_METRIC_NAME) as any;
    expect({ ...summary, quantiles: undefined }).toEqual({
      metric_type: "summary",
      value: 900,
      unit: "ms",
      count: 10,
      sum: 900,
      quantiles: undefined,
    });
    expect(JSON.parse(summary.quantiles)).toEqual([
      { quantile: 0.5, value: 80 },
      { quantile: 0.95, value: 140 },
    ]);

    const logRes = await ctx.request("/api/ingest/otlp/v1/logs", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: otlpProtobufLogRequest,
    });
    expect(logRes.status).toBe(201);
    const logBody = await logRes.json() as unknown;
    expect(logBody).toEqual({ counts: { logs: 1 } });

    const log = ctx.sqlite
      .prepare("SELECT service, level, message, trace_id, span_id, connection_id, attributes FROM logs WHERE message = ?")
      .get(OTLP_LOG_MESSAGE) as any;
    expect({ ...log, attributes: undefined }).toEqual({
      service: OTLP_SERVICE_NAME,
      level: "error",
      message: OTLP_LOG_MESSAGE,
      trace_id: OTLP_TRACE_ID,
      span_id: OTLP_SPAN_ID,
      connection_id: OTLP_CONNECTION_ID,
      attributes: undefined,
    });
    expect(JSON.parse(log.attributes)).toMatchObject({
      "connection.id": OTLP_CONNECTION_ID,
      "session.id": OTLP_SESSION_ID,
      "event.name": "voice.provider.timeout",
    });
  });
});
