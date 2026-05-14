import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

describe("POST /api/admin/maintenance", () => {
  it("requires a dedicated maintenance bearer token", async () => {
    const ctx = createTestContext();
    const res = await ctx.request("/api/admin/maintenance", { method: "POST" });

    expect(res.status).toBe(503);
    const body = await res.json() as unknown;
    expect(body).toEqual({ error: "Maintenance API not configured" });
  });

  it("runs maintenance when authorized", async () => {
    const ctx = createTestContext({
      env: {
        MAINTENANCE_API_KEY: "maintenance-key",
        RETENTION_DAYS: "7",
      },
    });
    ctx.seedConnection({ id: "expired-conn", started_at: "2000-01-01T00:00:00.000Z" });

    const res = await ctx.request("/api/admin/maintenance", {
      method: "POST",
      headers: { Authorization: "Bearer maintenance-key" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted.connections).toBe(1);
  });
});
