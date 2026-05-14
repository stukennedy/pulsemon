import { describe, expect, it } from "bun:test";
import {
  PulsemonClient,
  PulsemonError,
  parseTraceparent,
  traceparent,
  type PulsemonFetch,
} from "@/sdk";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Pulsemon TypeScript SDK", () => {
  it("sends typed logs with auth, service, and default attributes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: PulsemonFetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse({ count: 1 });
    };

    const client = new PulsemonClient({
      endpoint: "https://pulsemon.example",
      apiKey: "sdk-key",
      service: "voice-gateway",
      fetch: fetcher,
      defaultAttributes: { region: "eu" },
    });

    const result = await client.log({
      level: "info",
      message: "session opened",
      attributes: { provider: "asr" },
    });

    expect(result).toEqual({ count: 1 });
    expect(calls[0].url).toBe("https://pulsemon.example/api/ingest/logs");
    expect(calls[0].init.headers).toEqual({
      Authorization: "Bearer sdk-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      level: "info",
      message: "session opened",
      service: "voice-gateway",
      attributes: { region: "eu", provider: "asr" },
    });
  });

  it("records a span around an async operation", async () => {
    const bodies: unknown[] = [];
    const fetcher: PulsemonFetch = async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return jsonResponse({ id: "span-id" });
    };
    const client = new PulsemonClient({
      endpoint: "https://pulsemon.example",
      apiKey: "sdk-key",
      service: "agent-api",
      fetch: fetcher,
    });

    const result = await client.withSpan({ traceId: "a".repeat(32), operation: "llm.generate" }, async (ctx) => {
      expect(ctx.traceId).toBe("a".repeat(32));
      expect(ctx.spanId).toHaveLength(16);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      trace_id: "a".repeat(32),
      service: "agent-api",
      operation: "llm.generate",
      status: "ok",
    });
  });

  it("buffers and flushes batch records", async () => {
    const bodies: unknown[] = [];
    const fetcher: PulsemonFetch = async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return jsonResponse({ counts: { logs: 1, metrics: 1 } });
    };
    const client = new PulsemonClient({
      endpoint: "https://pulsemon.example",
      apiKey: "sdk-key",
      service: "voice-gateway",
      fetch: fetcher,
    });

    const batcher = client.batcher()
      .log({ level: "info", message: "turn started" })
      .metric({ metric_name: "voice.latency_ms", metric_type: "histogram", value: 123 });

    expect(batcher.size()).toBe(2);
    await batcher.flush();
    expect(batcher.size()).toBe(0);
    expect(bodies[0]).toMatchObject({
      logs: [{ level: "info", message: "turn started", service: "voice-gateway" }],
      metrics: [{ metric_name: "voice.latency_ms", metric_type: "histogram", value: 123, service: "voice-gateway" }],
    });
  });

  it("retries 429 and 5xx responses before failing or succeeding", async () => {
    let calls = 0;
    const fetcher: PulsemonFetch = async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "rate limited" }, 429)
        : jsonResponse({ count: 1 });
    };
    const client = new PulsemonClient({
      endpoint: "https://pulsemon.example",
      apiKey: "sdk-key",
      service: "voice-gateway",
      fetch: fetcher,
      retryBaseMs: 0,
    });

    await expect(client.event({ event_type: "message_received" })).resolves.toEqual({ count: 1 });
    expect(calls).toBe(2);
  });

  it("throws PulsemonError for non-retryable responses", async () => {
    const client = new PulsemonClient({
      endpoint: "https://pulsemon.example",
      apiKey: "sdk-key",
      service: "voice-gateway",
      fetch: async () => jsonResponse({ error: "bad payload" }, 400),
    });

    await expect(client.metric({
      metric_name: "voice.latency_ms",
      metric_type: "histogram",
      value: 123,
    })).rejects.toBeInstanceOf(PulsemonError);
  });

  it("parses and serializes W3C traceparent values", () => {
    const parsed = parseTraceparent(`00-${"b".repeat(32)}-${"c".repeat(16)}-01`);

    expect(parsed).toEqual({
      traceId: "b".repeat(32),
      spanId: "c".repeat(16),
      traceFlags: "01",
    });
    expect(traceparent(parsed!)).toBe(`00-${"b".repeat(32)}-${"c".repeat(16)}-01`);
    expect(parseTraceparent("bad")).toBeNull();
  });
});
