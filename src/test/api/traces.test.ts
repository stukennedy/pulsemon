import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../helpers";

describe("GET /api/traces", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("returns empty table when no spans", async () => {
    const res = await ctx.request("/api/traces");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0 span");
  });

  it("returns trace list grouped by trace_id", async () => {
    ctx.seedSpan({ trace_id: "trace-a", operation: "asr.transcribe", service: "asr-service" });
    ctx.seedSpan({ trace_id: "trace-a", operation: "llm.generate", service: "llm-service" });
    ctx.seedSpan({ trace_id: "trace-b", operation: "tts.synthesize", service: "tts-service" });

    const res = await ctx.request("/api/traces");
    const html = await res.text();
    expect(html).toContain("2 trace");
    expect(html).toContain("3 span");
  });

  it("filters by service tag", async () => {
    ctx.seedSpan({ trace_id: "t1", service: "asr-service" });
    ctx.seedSpan({ trace_id: "t2", service: "llm-service" });

    const res = await ctx.request("/api/traces?tags=service:asr-service");
    const html = await res.text();
    expect(html).toContain("1 trace");
  });

  it("filters by operation", async () => {
    ctx.seedSpan({ trace_id: "t1", operation: "asr.transcribe" });
    ctx.seedSpan({ trace_id: "t2", operation: "llm.generate" });
    ctx.seedSpan({ trace_id: "t3", operation: "llm.generate" });

    const res = await ctx.request("/api/traces?tags=operation:llm.generate");
    const html = await res.text();
    expect(html).toContain("2 span");
  });

  it("filters by error status", async () => {
    ctx.seedSpan({ trace_id: "t1", status: "ok" });
    ctx.seedSpan({ trace_id: "t2", status: "error" });

    const res = await ctx.request("/api/traces?tags=status:error");
    const html = await res.text();
    expect(html).toContain("1 span");
  });
});
