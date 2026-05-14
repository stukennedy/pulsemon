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
