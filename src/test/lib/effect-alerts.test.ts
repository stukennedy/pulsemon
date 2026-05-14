import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestContext } from "../helpers";
import { processMonitorAlerts } from "@/lib/effect/alerts";
import type { MonitorEvaluation } from "@/lib/effect/monitors";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

function evaluation(status: MonitorEvaluation["status"], evaluated_at: string): MonitorEvaluation {
  return {
    monitor_id: "voice.asr_p95_latency_ms",
    name: "ASR p95 latency",
    status,
    value: status === "alert" ? 1500 : 400,
    threshold: 1200,
    window_minutes: 15,
    description: "Voice turns with ASR latency above 1.2s",
    evaluated_at,
  };
}

describe("Effect alert processing", () => {
  it("opens an incident and sends one webhook for a new alert", async () => {
    const ctx = createTestContext();
    const deliveries: unknown[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      deliveries.push(JSON.parse(init?.body as string));
      return new Response("ok", { status: 200 });
    };

    const result = await Effect.runPromise(processMonitorAlerts(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      [evaluation("alert", "2026-05-14T10:00:00.000Z")],
      { webhookUrl: "https://alerts.example/hook", webhookSecret: "secret" },
      fetcher
    ));

    expect(result).toEqual({ opened: 1, resolved: 0, notifications: 1 });
    expect(deliveries).toHaveLength(1);

    const incident = ctx.sqlite
      .prepare("SELECT monitor_id, status, notification_count FROM alert_incidents")
      .get() as any;
    expect(incident).toEqual({
      monitor_id: "voice.asr_p95_latency_ms",
      status: "firing",
      notification_count: 1,
    });
  });

  it("resolves an active incident and sends a recovery webhook", async () => {
    const ctx = createTestContext();
    const fetcher = async () => new Response("ok", { status: 200 });

    await Effect.runPromise(processMonitorAlerts(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      [evaluation("alert", "2026-05-14T10:00:00.000Z")],
      { webhookUrl: "https://alerts.example/hook" },
      fetcher
    ));

    const result = await Effect.runPromise(processMonitorAlerts(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      [evaluation("ok", "2026-05-14T10:05:00.000Z")],
      { webhookUrl: "https://alerts.example/hook" },
      fetcher
    ));

    expect(result).toEqual({ opened: 0, resolved: 1, notifications: 1 });
    const incident = ctx.sqlite
      .prepare("SELECT status, resolved_at, notification_count FROM alert_incidents")
      .get() as any;
    expect(incident.status).toBe("resolved");
    expect(incident.resolved_at).toBe("2026-05-14T10:05:00.000Z");
    expect(incident.notification_count).toBe(2);
  });
});
