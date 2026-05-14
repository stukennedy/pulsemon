import { describe, expect, it, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

const authHeaders = {
  Authorization: "Bearer test-key",
  "Content-Type": "application/json",
};

function concat(parts: readonly Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function varint(value: number | bigint) {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return new Uint8Array(bytes);
}

function fieldTag(number: number, wireType: number) {
  return varint((number << 3) | wireType);
}

function bytesField(number: number, bytes: Uint8Array) {
  return concat([fieldTag(number, 2), varint(bytes.length), bytes]);
}

function messageField(number: number, parts: readonly Uint8Array[]) {
  return bytesField(number, concat(parts));
}

function stringField(number: number, value: string) {
  return bytesField(number, new TextEncoder().encode(value));
}

function varintField(number: number, value: number | bigint) {
  return concat([fieldTag(number, 0), varint(value)]);
}

function fixed64Field(number: number, value: bigint) {
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < 8; index++) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return concat([fieldTag(number, 1), bytes]);
}

function doubleField(number: number, value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return concat([fieldTag(number, 1), bytes]);
}

function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function stringAnyValue(value: string) {
  return [stringField(1, value)];
}

function keyValueField(number: number, key: string, value: readonly Uint8Array[]) {
  return messageField(number, [
    stringField(1, key),
    messageField(2, value),
  ]);
}

function keyValue(key: string, value: readonly Uint8Array[]) {
  return keyValueField(1, key, value);
}

function resource(service: string) {
  return messageField(1, [keyValue("service.name", stringAnyValue(service))]);
}

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

  it("accepts gzip-compressed OTLP JSON request bodies", async () => {
    const payload = JSON.stringify({
      resourceLogs: [{
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "voice-gateway" } }],
        },
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: "1800000000000000000",
            severityText: "INFO",
            body: { stringValue: "compressed payload" },
          }],
        }],
      }],
    });

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
    const traceId = "11111111111111111111111111111111";
    const spanId = "2222222222222222";
    const connectionId = "conn-otlp-proto";
    const timestamp = 1800000000000000000n;

    const tracePayload = messageField(1, [
      resource("voice-gateway"),
      messageField(2, [
        messageField(2, [
          bytesField(1, hexBytes(traceId)),
          bytesField(2, hexBytes(spanId)),
          stringField(5, "voice.turn.protobuf"),
          fixed64Field(7, timestamp),
          fixed64Field(8, timestamp + 500000000n),
          keyValueField(9, "connection.id", stringAnyValue(connectionId)),
          messageField(15, [
            stringField(2, "provider failed"),
            varintField(3, 2),
          ]),
        ]),
      ]),
    ]);

    const traceRes = await ctx.request("/api/ingest/otlp/v1/traces", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: tracePayload,
    });

    expect(traceRes.status).toBe(201);
    const traceBody = await traceRes.json() as unknown;
    expect(traceBody).toEqual({ counts: { spans: 1 } });

    const span = ctx.sqlite
      .prepare("SELECT trace_id, id, service, operation, duration_ms, status, status_message, connection_id FROM spans WHERE id = ?")
      .get(spanId) as any;
    expect(span).toEqual({
      trace_id: traceId,
      id: spanId,
      service: "voice-gateway",
      operation: "voice.turn.protobuf",
      duration_ms: 500,
      status: "error",
      status_message: "provider failed",
      connection_id: connectionId,
    });

    const metricPayload = messageField(1, [
      resource("voice-gateway"),
      messageField(2, [
        messageField(2, [
          stringField(1, "voice.proto_latency_ms"),
          messageField(5, [
            messageField(1, [
              fixed64Field(3, timestamp),
              doubleField(4, 321.5),
              keyValueField(7, "provider", stringAnyValue("asr")),
            ]),
          ]),
        ]),
      ]),
    ]);

    const metricRes = await ctx.request("/api/ingest/otlp/v1/metrics", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: metricPayload,
    });
    expect(metricRes.status).toBe(201);
    const metricBody = await metricRes.json() as unknown;
    expect(metricBody).toEqual({ counts: { metrics: 1 } });

    const metric = ctx.sqlite
      .prepare("SELECT service, metric_name, metric_type, value, tags FROM metrics WHERE metric_name = ?")
      .get("voice.proto_latency_ms") as any;
    expect(metric).toEqual({
      service: "voice-gateway",
      metric_name: "voice.proto_latency_ms",
      metric_type: "gauge",
      value: 321.5,
      tags: JSON.stringify({ provider: "asr" }),
    });

    const logPayload = messageField(1, [
      resource("voice-gateway"),
      messageField(2, [
        messageField(2, [
          fixed64Field(1, timestamp),
          varintField(2, 17),
          stringField(3, "ERROR"),
          messageField(5, stringAnyValue("protobuf provider timeout")),
          keyValueField(6, "connection.id", stringAnyValue(connectionId)),
          bytesField(9, hexBytes(traceId)),
          bytesField(10, hexBytes(spanId)),
        ]),
      ]),
    ]);

    const logRes = await ctx.request("/api/ingest/otlp/v1/logs", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/x-protobuf",
      },
      body: logPayload,
    });
    expect(logRes.status).toBe(201);
    const logBody = await logRes.json() as unknown;
    expect(logBody).toEqual({ counts: { logs: 1 } });

    const log = ctx.sqlite
      .prepare("SELECT service, level, message, trace_id, span_id, connection_id FROM logs WHERE message = ?")
      .get("protobuf provider timeout") as any;
    expect(log).toEqual({
      service: "voice-gateway",
      level: "error",
      message: "protobuf provider timeout",
      trace_id: traceId,
      span_id: spanId,
      connection_id: connectionId,
    });
  });
});
