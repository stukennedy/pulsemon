import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

describe("admin audit and RBAC", () => {
  it("records maintenance audit events and exposes them to admins", async () => {
    const ctx = createTestContext({
      env: {
        MAINTENANCE_API_KEY: "maintenance-key",
        UI_USERS: JSON.stringify({
          admin: { password: "secret", role: "admin" },
          viewer: { password: "readonly", role: "viewer" },
        }),
      },
    });

    const maintenance = await ctx.request("/api/admin/maintenance", {
      method: "POST",
      headers: { Authorization: "Bearer maintenance-key" },
    });
    expect(maintenance.status).toBe(200);

    const denied = await ctx.request("/api/admin/audit", {
      headers: { Authorization: basic("viewer", "readonly") },
    });
    expect(denied.status).toBe(403);

    const audit = await ctx.request("/api/admin/audit", {
      headers: { Authorization: basic("admin", "secret") },
    });
    expect(audit.status).toBe(200);

    const body = await audit.json() as any;
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      actor: "maintenance-token",
      actor_role: "system",
      action: "maintenance.run",
      outcome: "success",
      target: "maintenance",
      workspace_id: "default",
      project_id: "default",
    });
  });

  it("blocks viewer users from running maintenance and audits the denial", async () => {
    const ctx = createTestContext({
      env: {
        MAINTENANCE_API_KEY: "maintenance-key",
        UI_USERS: JSON.stringify({
          admin: { password: "secret", role: "admin" },
          viewer: { password: "readonly", role: "viewer" },
        }),
      },
    });

    const denied = await ctx.request("/api/admin/maintenance", {
      method: "POST",
      headers: { Authorization: basic("viewer", "readonly") },
    });
    expect(denied.status).toBe(403);

    const audit = await ctx.request("/api/admin/audit", {
      headers: { Authorization: basic("admin", "secret") },
    });
    const body = await audit.json() as any;

    expect(body.events[0]).toMatchObject({
      actor: "viewer",
      actor_role: "viewer",
      action: "maintenance.run",
      outcome: "denied",
    });
  });
});
