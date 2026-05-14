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

  it("GET / with seed data shows dashboard stats", async () => {
    ctx.seedConnection({ service: "voice-gateway", status: "active" });
    ctx.seedConnection({ service: "asr-service", status: "closed" });
    ctx.seedConnection({ service: "llm-service", status: "error" });

    const res = await ctx.request("/");
    const html = await res.text();
    expect(html).toContain("Active Connections");
  });
});
