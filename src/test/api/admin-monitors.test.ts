import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

const env = {
  UI_USERS: JSON.stringify({
    admin: { password: "secret", role: "admin" },
    viewer: { password: "readonly", role: "viewer" },
  }),
};

describe("admin monitor definitions", () => {
  it("lists seeded monitor definitions for admins", async () => {
    const ctx = createTestContext({ env });

    const res = await ctx.request("/api/admin/monitors", {
      headers: { Authorization: basic("admin", "secret") },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.monitors.length).toBeGreaterThanOrEqual(6);
    expect(body.monitors.some((monitor: any) => monitor.id === "voice.asr_p95_latency_ms")).toBe(true);
  });

  it("creates, updates, and deletes custom metric monitors", async () => {
    const ctx = createTestContext({ env });

    const created = await ctx.request("/api/admin/monitors", {
      method: "POST",
      headers: {
        Authorization: basic("admin", "secret"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "metric.voice_latency",
        name: "Voice latency average",
        kind: "metric_avg",
        metric_name: "voice.latency_ms",
        service: "voice-gateway",
        threshold: 250,
        window_minutes: 15,
      }),
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json() as any;
    expect(createdBody.monitor).toMatchObject({
      id: "metric.voice_latency",
      metric_name: "voice.latency_ms",
      service: "voice-gateway",
      enabled: true,
    });

    const updated = await ctx.request("/api/admin/monitors/metric.voice_latency", {
      method: "PATCH",
      headers: {
        Authorization: basic("admin", "secret"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ threshold: 200, enabled: false }),
    });

    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as any;
    expect(updatedBody.monitor.threshold).toBe(200);
    expect(updatedBody.monitor.enabled).toBe(false);

    const deleted = await ctx.request("/api/admin/monitors/metric.voice_latency", {
      method: "DELETE",
      headers: { Authorization: basic("admin", "secret") },
    });
    expect(deleted.status).toBe(200);
  });

  it("blocks viewer users from monitor definition writes", async () => {
    const ctx = createTestContext({ env });

    const res = await ctx.request("/api/admin/monitors", {
      method: "POST",
      headers: {
        Authorization: basic("viewer", "readonly"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Nope",
        kind: "metric_avg",
        metric_name: "voice.latency_ms",
        threshold: 250,
        window_minutes: 15,
      }),
    });

    expect(res.status).toBe(403);
  });
});
