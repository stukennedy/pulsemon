import { describe, expect, it, spyOn } from "bun:test";
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

  it("does not expose database exception details", async () => {
    const databaseDetail = "SQL_SENTINEL: SELECT secret FROM private_table";
    const failingDb = {
      prepare() {
        throw new Error(databaseDetail);
      },
    } as unknown as D1Database;
    const ctx = createTestContext({ env: { DB: failingDb } });
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);

    const res = await ctx.request("/api/sessions");
    const logged = errorLog.mock.calls.flat().join(" ");
    errorLog.mockRestore();

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Internal server error" });
    expect(body).not.toContain(databaseDetail);
    expect(logged).toContain("DatabaseError");
    expect(logged).not.toContain(databaseDetail);
  });

  it("does not expose unexpected route exception details", async () => {
    const unexpectedDetail = "UNKNOWN_SENTINEL: private runtime detail";
    const unexpectedName = "NAME_SENTINEL: ops@example.com";
    const ctx = createTestContext();
    ctx.app.get("/test/unexpected-error", () => {
      const error = new Error(unexpectedDetail);
      error.name = unexpectedName;
      throw error;
    });
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);

    const res = await ctx.request("/test/unexpected-error");
    const logged = errorLog.mock.calls.flat().join(" ");
    errorLog.mockRestore();

    const body = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "Internal server error" });
    expect(body).not.toContain(unexpectedDetail);
    expect(logged).toContain("pulsemon.unexpected_request_error");
    expect(logged).not.toContain(unexpectedDetail);
    expect(logged).not.toContain(unexpectedName);
  });
});
