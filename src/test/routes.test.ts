import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "./helpers";

describe("Page routes", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("GET / returns dashboard page", async () => {
    const res = await ctx.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("pulsemon");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Active Connections");
  });

  it("GET /connections returns connections page", async () => {
    const res = await ctx.request("/connections");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connections");
    expect(html).toContain("ws-container");
  });

  it("GET /traces returns traces page", async () => {
    const res = await ctx.request("/traces");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Traces");
  });

  it("GET /logs returns logs page", async () => {
    const res = await ctx.request("/logs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Logs");
    expect(html).toContain("ws-container");
  });

  it("GET /metrics returns metrics page", async () => {
    const res = await ctx.request("/metrics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Metrics");
    expect(html).toContain("ws-container");
  });

  it("GET /voice returns voice pipeline page", async () => {
    const res = await ctx.request("/voice");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Voice");
    expect(html).toContain("Recent Voice Sessions");
  });

  it("GET /sessions/:id returns session detail page", async () => {
    ctx.seedVoiceTurn({
      id: "turn-route-a",
      session_id: "session-route",
      connection_id: "conn-route",
      trace_id: "trace-route-a",
      transcript: "hello route",
    });
    ctx.seedVoiceTurn({
      id: "turn-route-b",
      session_id: "session-route",
      connection_id: "conn-route",
      trace_id: "trace-route-b",
    });
    ctx.seedAgentToolCall({
      session_id: "session-route",
      connection_id: "conn-route",
      trace_id: "trace-route-a",
      tool_name: "lookup_account",
    });

    const res = await ctx.request("/sessions/session-route");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("session-route");
    expect(html).toContain("hello route");
    expect(html).toContain('data-turn-waterfall-legend="true"');
    expect(html).toContain("flex-wrap");
    expect(html).toContain('data-tool-call-row="true"');
    expect(html).not.toContain('data-tool-call-card="true"');
  });

  it("GET /sessions/:id renders a waterfall for a single-turn session", async () => {
    ctx.seedVoiceTurn({ id: "only-turn", session_id: "single-turn-session" });

    const res = await ctx.request("/sessions/single-turn-session");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("Turn Waterfall");
    expect(html).toContain("#turn-only-turn");
  });

  it("GET /monitors returns monitor evaluations page", async () => {
    const res = await ctx.request("/monitors");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Monitors");
    expect(html).toContain("ASR p95 latency");
  });

  it("GET /slos returns SLO page", async () => {
    const res = await ctx.request("/slos");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("SLO");
    expect(html).toContain("Voice latency under 1.5s");
  });

  it("GET /connections/:id returns 200 for existing connection", async () => {
    ctx.seedConnection({ id: "conn-test-123", service: "voice-gateway" });

    const res = await ctx.request("/connections/conn-test-123");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("voice-gateway");
    expect(html).toContain("conn-test-123");
  });

  it("GET /connections/:id shows not found for missing connection", async () => {
    const res = await ctx.request("/connections/nonexistent");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connection not found");
  });

  it("GET /traces/:id returns trace waterfall", async () => {
    ctx.seedSpan({ trace_id: "trace-xyz", operation: "asr.transcribe", service: "asr-service" });

    const res = await ctx.request("/traces/trace-xyz");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("trace-xyz");
    expect(html).toContain("asr.transcribe");
  });

  it("GET /ws keys the search Durable Object by browser session id", async () => {
    const names: string[] = [];
    const forwardedUrls: string[] = [];

    ctx = createTestContext({
      env: {
        SEARCH_SESSION: {
          idFromName: (name: string) => {
            names.push(name);
            return { name };
          },
          get: () => ({
            fetch: (request: Request) => {
              forwardedUrls.push(request.url);
              return new Response("ws mock", { status: 101 });
            },
          }),
        } as any,
      },
    });

    const res = await ctx.request("/ws?view=logs&sid=browser_session_12345", {
      headers: {
        Upgrade: "websocket",
        "CF-Connecting-IP": "198.51.100.44",
      },
    });

    expect(res.status).toBe(101);
    expect(names).toEqual(["default:default:search:browser_session_12345"]);
    expect(names[0]).not.toContain("198.51.100.44");
    expect(names[0]).not.toContain(":logs");
    expect(new URL(forwardedUrls[0]).searchParams.get("view")).toBe("logs");
  });

  it("GET / with seed data shows dashboard stats", async () => {
    ctx.seedConnection({ service: "voice-gateway", status: "active" });
    ctx.seedConnection({ service: "asr-service", status: "closed" });
    ctx.seedConnection({ service: "llm-service", status: "error" });

    const res = await ctx.request("/");
    const html = await res.text();
    expect(html).toContain("Active Connections");
  });

  it("optionally protects UI routes with basic auth", async () => {
    ctx = createTestContext({ env: { UI_BASIC_AUTH: "admin:secret" } });

    const unauthorized = await ctx.request("/");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toContain("Basic");

    const authorized = await ctx.request("/", {
      headers: { Authorization: `Basic ${btoa("admin:secret")}` },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain("Dashboard");
  });

  it("does not apply optional UI basic auth to ingest routes", async () => {
    ctx = createTestContext({ env: { UI_BASIC_AUTH: "admin:secret" } });

    const res = await ctx.request("/api/ingest/connections", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ service: "voice-gateway", connection_type: "ws" }),
    });

    expect(res.status).toBe(201);
  });
});
