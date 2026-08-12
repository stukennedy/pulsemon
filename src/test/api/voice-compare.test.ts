import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

describe("GET /voice/compare", () => {
  it("renders the empty picker state", async () => {
    const ctx = createTestContext();
    const res = await ctx.request("/voice/compare");

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Compare Sessions");
    expect(html).toContain("Pick a candidate session");
  });

  it("compares a session against the rolling baseline", async () => {
    const ctx = createTestContext();
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      ctx.seedVoiceTurn({ session_id: "session-slow", started_at: now, llm_latency_ms: 3000 });
      ctx.seedVoiceTurn({ session_id: "session-steady", started_at: now, llm_latency_ms: 1000 });
    }

    const res = await ctx.request("/voice/compare?a=session-slow&b=baseline&days=7");

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("LLM response p95");
    expect(html).toContain("regressed");
    expect(html).toContain("session session-slow");
  });

  it("compares two concrete sessions", async () => {
    const ctx = createTestContext();
    const now = new Date().toISOString();
    ctx.seedVoiceTurn({ session_id: "session-a", started_at: now, llm_latency_ms: 900 });
    ctx.seedVoiceTurn({ session_id: "session-b", started_at: now, llm_latency_ms: 800 });

    const res = await ctx.request("/voice/compare?a=session-a&b=session-b");

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("session session-a");
    expect(html).toContain("session session-b");
  });

  it("returns 404 for an unknown candidate session", async () => {
    const ctx = createTestContext();
    const res = await ctx.request("/voice/compare?a=missing-session");
    expect(res.status).toBe(404);
  });

  it("returns 400 for an out-of-range baseline window", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "session-a" });
    const res = await ctx.request("/voice/compare?a=session-a&b=baseline&days=900");
    expect(res.status).toBe(400);
  });
});
