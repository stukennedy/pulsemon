import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

describe("GET /api/connections", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("returns empty table when no connections", async () => {
    const res = await ctx.request("/api/connections");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0 connection");
  });

  it("returns connections as HTML table rows", async () => {
    ctx.seedConnection({ service: "voice-gateway", connection_type: "ws", status: "active" });
    ctx.seedConnection({ service: "asr-service", connection_type: "grpc", status: "closed" });

    const res = await ctx.request("/api/connections");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("voice-gateway");
    expect(html).toContain("asr-service");
    expect(html).toContain("2 connection");
  });

  it("only returns the configured tenant scope", async () => {
    ctx = createTestContext({
      env: {
        DEFAULT_WORKSPACE_ID: "acme",
        DEFAULT_PROJECT_ID: "voice-prod",
      },
    });
    ctx.seedConnection({
      service: "voice-gateway",
      workspace_id: "acme",
      project_id: "voice-prod",
    });
    ctx.seedConnection({
      service: "other-tenant",
      workspace_id: "other",
      project_id: "voice-prod",
    });

    const res = await ctx.request("/api/connections");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("voice-gateway");
    expect(html).not.toContain("other-tenant");
    expect(html).toContain("1 connection");
  });

  it("filters by service tag", async () => {
    ctx.seedConnection({ service: "voice-gateway" });
    ctx.seedConnection({ service: "asr-service" });
    ctx.seedConnection({ service: "asr-service" });

    const res = await ctx.request("/api/connections?tags=service:asr-service");
    const html = await res.text();
    expect(html).toContain("2 connection");
  });

  it("filters by connection type", async () => {
    ctx.seedConnection({ connection_type: "ws" });
    ctx.seedConnection({ connection_type: "grpc" });
    ctx.seedConnection({ connection_type: "ws" });

    const res = await ctx.request("/api/connections?tags=type:ws");
    const html = await res.text();
    expect(html).toContain("2 connection");
  });

  it("filters by status", async () => {
    ctx.seedConnection({ status: "active" });
    ctx.seedConnection({ status: "closed" });
    ctx.seedConnection({ status: "error" });

    const res = await ctx.request("/api/connections?tags=status:error");
    const html = await res.text();
    expect(html).toContain("1 connection");
  });

  it("supports multiple tag AND logic", async () => {
    ctx.seedConnection({ service: "voice-gateway", status: "active" });
    ctx.seedConnection({ service: "voice-gateway", status: "error" });
    ctx.seedConnection({ service: "asr-service", status: "active" });

    const res = await ctx.request("/api/connections?tags=service:voice-gateway|status:active");
    const html = await res.text();
    expect(html).toContain("1 connection");
  });

  it("shows 'No connections match' for empty filtered result", async () => {
    ctx.seedConnection({ service: "voice-gateway" });

    const res = await ctx.request("/api/connections?tags=service:nonexistent");
    const html = await res.text();
    expect(html).toContain("No connections match");
  });

  it("contains table headers", async () => {
    const res = await ctx.request("/api/connections");
    const html = await res.text();
    expect(html).toContain("Service");
    expect(html).toContain("Type");
    expect(html).toContain("Status");
    expect(html).toContain("Duration");
  });
});
