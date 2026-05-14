import { describe, expect, it, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

describe("GET /api/logs", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("returns empty table when no logs exist", async () => {
    const res = await ctx.request("/api/logs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0 logs");
  });

  it("returns logs as HTML table rows", async () => {
    ctx.seedLog({ service: "voice-gateway", level: "info", message: "session opened" });
    ctx.seedLog({ service: "llm-service", level: "error", message: "provider timeout" });

    const res = await ctx.request("/api/logs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("session opened");
    expect(html).toContain("provider timeout");
    expect(html).toContain("2 logs");
  });

  it("filters logs by level tag", async () => {
    ctx.seedLog({ level: "info", message: "session opened" });
    ctx.seedLog({ level: "error", message: "provider timeout" });

    const res = await ctx.request("/api/logs?tags=level:error");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("provider timeout");
    expect(html).not.toContain("session opened");
    expect(html).toContain("1 log");
  });
});
