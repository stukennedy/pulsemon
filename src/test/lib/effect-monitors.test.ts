import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createTestContext } from "../helpers";
import {
  createMonitorDefinition,
  evaluateAndPersistRealtimeMonitors,
  listMonitorDefinitions,
} from "@/lib/effect/monitors";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("Effect realtime monitors", () => {
  it("evaluates voice and agent SLO monitors and persists snapshots", async () => {
    const ctx = createTestContext();
    const startedAt = new Date().toISOString();

    ctx.sqlite.prepare(`
      INSERT INTO voice_turns (
        id, workspace_id, project_id, role, started_at, asr_latency_ms, llm_latency_ms, tts_latency_ms, interruption
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("turn-1", "default", "default", "user", startedAt, 1800, 1000, 900, 1);

    ctx.sqlite.prepare(`
      INSERT INTO agent_tool_calls (
        id, workspace_id, project_id, tool_name, started_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("tool-1", "default", "default", "lookup_account", startedAt, "error");

    const evaluations = await Effect.runPromise(
      evaluateAndPersistRealtimeMonitors(ctx.d1, DEFAULT_TENANT_SCOPE)
    );

    const asr = evaluations.find((item) => item.monitor_id === "voice.asr_p95_latency_ms");
    const toolErrors = evaluations.find((item) => item.monitor_id === "agent.tool_error_rate_pct");

    expect(asr?.status).toBe("alert");
    expect(toolErrors?.status).toBe("alert");

    const persisted = ctx.sqlite
      .prepare("SELECT COUNT(*) AS count FROM monitor_evaluations")
      .get() as any;
    expect(persisted.count).toBe(evaluations.length);
  });

  it("evaluates persisted custom metric monitors", async () => {
    const ctx = createTestContext();
    const timestamp = new Date().toISOString();

    await Effect.runPromise(createMonitorDefinition(ctx.d1, DEFAULT_TENANT_SCOPE, {
      id: "metric.voice_latency_avg",
      name: "Voice latency average",
      kind: "metric_avg",
      metric_name: "voice.latency_ms",
      service: "voice-gateway",
      threshold: 100,
      window_minutes: 15,
    }));

    ctx.seedMetric({
      id: "metric-custom-monitor",
      service: "voice-gateway",
      metric_name: "voice.latency_ms",
      timestamp,
      value: 150,
    });

    const definitions = await Effect.runPromise(listMonitorDefinitions(ctx.d1, DEFAULT_TENANT_SCOPE));
    expect(definitions.some((definition) => definition.id === "metric.voice_latency_avg")).toBe(true);

    const evaluations = await Effect.runPromise(
      evaluateAndPersistRealtimeMonitors(ctx.d1, DEFAULT_TENANT_SCOPE)
    );
    const custom = evaluations.find((item) => item.monitor_id === "metric.voice_latency_avg");

    expect(custom?.value).toBe(150);
    expect(custom?.status).toBe("alert");
  });
});
