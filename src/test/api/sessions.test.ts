import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

describe("GET /api/sessions", () => {
  it("returns voice session summaries", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "session-a", connection_id: "conn-a" });

    const res = await ctx.request("/api/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].session_id).toBe("session-a");
  });

  it("returns a session detail payload", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "session-a", connection_id: "conn-a", trace_id: "trace-a" });

    const res = await ctx.request("/api/sessions/session-a");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summary.session_id).toBe("session-a");
    expect(body.turns).toHaveLength(1);
  });
});
