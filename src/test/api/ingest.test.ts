import { describe, expect, it, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

const authHeaders = {
  Authorization: "Bearer test-key",
  "Content-Type": "application/json",
};

describe("POST /api/ingest", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("rejects unauthenticated ingest requests", async () => {
    const res = await ctx.request("/api/ingest/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "voice-gateway", connection_type: "ws" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as unknown;
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("rejects ingest payloads over the configured byte limit", async () => {
    ctx = createTestContext({ env: { INGEST_MAX_BYTES: "20" } });

    const res = await ctx.request("/api/ingest/logs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        service: "voice-gateway",
        level: "info",
        message: "this payload is intentionally too large",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Payload exceeds");
  });

  it("enforces scoped ingest API keys when configured", async () => {
    ctx = createTestContext({
      env: {
        INGEST_API_KEY: undefined,
        INGEST_API_KEYS: JSON.stringify({
          "logs-key": ["logs"],
          "metrics-key": ["metrics"],
        }),
      },
    });

    const allowed = await ctx.request("/api/ingest/logs", {
      method: "POST",
      headers: {
        Authorization: "Bearer logs-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ service: "voice-gateway", level: "info", message: "scoped log" }),
    });
    expect(allowed.status).toBe(201);

    const denied = await ctx.request("/api/ingest/metrics", {
      method: "POST",
      headers: {
        Authorization: "Bearer logs-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service: "voice-gateway",
        metric_name: "voice.latency_ms",
        metric_type: "histogram",
        value: 123,
      }),
    });
    expect(denied.status).toBe(401);
  });

  it("assigns tenant scope from scoped ingest keys", async () => {
    ctx = createTestContext({
      env: {
        INGEST_API_KEY: undefined,
        INGEST_API_KEYS: JSON.stringify({
          "tenant-key": {
            scopes: ["connections"],
            workspace_id: "acme",
            project_id: "voice-prod",
          },
        }),
      },
    });

    const res = await ctx.request("/api/ingest/connections", {
      method: "POST",
      headers: {
        Authorization: "Bearer tenant-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "tenant-conn-1",
        service: "voice-gateway",
        connection_type: "ws",
      }),
    });

    expect(res.status).toBe(201);

    const row = ctx.sqlite
      .prepare("SELECT workspace_id, project_id FROM connections WHERE id = ?")
      .get("tenant-conn-1") as any;

    expect(row).toEqual({ workspace_id: "acme", project_id: "voice-prod" });
  });

  it("validates required connection fields", async () => {
    const res = await ctx.request("/api/ingest/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ connection_type: "ws" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("service");
  });

  it("inserts a connection through the Effect ingest pipeline", async () => {
    const res = await ctx.request("/api/ingest/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "conn-effect-1",
        service: "voice-gateway",
        connection_type: "ws",
        client_id: "client-1",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ id: "conn-effect-1" });

    const row = ctx.sqlite
      .prepare("SELECT service, connection_type, client_id, status FROM connections WHERE id = ?")
      .get("conn-effect-1") as any;

    expect(row).toEqual({
      service: "voice-gateway",
      connection_type: "ws",
      client_id: "client-1",
      status: "active",
    });
  });

  it("inserts logs through the Effect ingest pipeline", async () => {
    const res = await ctx.request("/api/ingest/logs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "log-effect-1",
        service: "voice-gateway",
        level: "error",
        message: "provider timeout",
        trace_id: "trace-1",
        attributes: { provider: "asr" },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ count: 1 });

    const row = ctx.sqlite
      .prepare("SELECT service, level, message, trace_id, attributes FROM logs WHERE id = ?")
      .get("log-effect-1") as any;

    expect(row).toEqual({
      service: "voice-gateway",
      level: "error",
      message: "provider timeout",
      trace_id: "trace-1",
      attributes: JSON.stringify({ provider: "asr" }),
    });
  });

  it("inserts metrics through the Effect ingest pipeline", async () => {
    const res = await ctx.request("/api/ingest/metrics", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "metric-effect-1",
        service: "voice-gateway",
        metric_name: "voice.latency_ms",
        metric_type: "histogram",
        value: 123.4,
        tags: { provider: "asr" },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ count: 1 });

    const row = ctx.sqlite
      .prepare("SELECT service, metric_name, metric_type, value, tags FROM metrics WHERE id = ?")
      .get("metric-effect-1") as any;

    expect(row).toEqual({
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      metric_type: "histogram",
      value: 123.4,
      tags: JSON.stringify({ provider: "asr" }),
    });
  });

  it("inserts voice turns through the Effect ingest pipeline", async () => {
    const res = await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "turn-effect-1",
        connection_id: "conn-effect-1",
        session_id: "session-1",
        trace_id: "trace-1",
        turn_index: 1,
        role: "user",
        transcript: "what is my account balance",
        transcript_confidence: 0.96,
        vad_start_ms: 120,
        vad_end_ms: 1540,
        interruption: false,
        audio_latency_ms: 80,
        asr_latency_ms: 240,
        metadata: { locale: "en-GB" },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ count: 1 });

    const row = ctx.sqlite
      .prepare("SELECT role, transcript, transcript_confidence, interruption, asr_latency_ms, metadata FROM voice_turns WHERE id = ?")
      .get("turn-effect-1") as any;

    expect(row).toEqual({
      role: "user",
      transcript: "what is my account balance",
      transcript_confidence: 0.96,
      interruption: 0,
      asr_latency_ms: 240,
      metadata: JSON.stringify({ locale: "en-GB" }),
    });
  });

  it("inserts agent tool calls through the Effect ingest pipeline", async () => {
    const res = await ctx.request("/api/ingest/agent/tool-calls", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "tool-effect-1",
        trace_id: "trace-1",
        span_id: "span-1",
        connection_id: "conn-effect-1",
        session_id: "session-1",
        turn_id: "turn-effect-1",
        tool_name: "billing.lookup_balance",
        status: "error",
        retry_count: 2,
        input: { account_id: "acct-1" },
        error: "provider timeout",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as unknown;
    expect(body).toEqual({ count: 1 });

    const row = ctx.sqlite
      .prepare("SELECT tool_name, status, retry_count, input, error FROM agent_tool_calls WHERE id = ?")
      .get("tool-effect-1") as any;

    expect(row).toEqual({
      tool_name: "billing.lookup_balance",
      status: "error",
      retry_count: 2,
      input: JSON.stringify({ account_id: "acct-1" }),
      error: "provider timeout",
    });
  });

  it("rejects invalid batch records instead of silently dropping them", async () => {
    const res = await ctx.request("/api/ingest/batch", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        connections: [{ id: "bad-conn", connection_type: "ws" }],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("service");
  });
});
