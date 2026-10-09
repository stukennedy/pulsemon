/**
 * Wire contract: the ingest client against THIS receiver.
 *
 * `pulsemon-client` (`packages/client`, resolved here as the built
 * workspace package: exactly the bytes that publish) is what surfaces use to
 * reach `/api/ingest/batch`. Its wire mapping was once hand-derived from a
 * rejected payload and drifted silently: every batch 400'd for a while,
 * unnoticed, because ingest is best-effort and the client swallows failures by
 * design. This test closes that gap from the receiver's side.
 *
 * It drives the real client through its public API into this app via
 * an injected `fetch`, then reads the rows back. A renamed field, a dropped
 * required key, a type change on either side lands here as a 422 the client
 * reports through `onError`, or as a missing row — in the SAME PR that made
 * the change, because both ends now live here.
 *
 * Direct mode on purpose: no queue between the client and D1, so the assertion
 * is about the WIRE, not the pipeline (content-staging.test.ts owns that).
 */
import { describe, expect, it } from "bun:test";
import { createPulsemonClient, type FetchLike } from "pulsemon-client";
import { createTestContext, type TestContext } from "../helpers";

const TRANSCRIPT = "what is my account balance for the savings pot";
const T0 = Date.parse("2026-09-10T12:00:00.000Z");

/** The client's transport, pointed at the in-process app. */
function transport(ctx: TestContext): FetchLike {
  return (url, init) => ctx.request(new URL(url).pathname, init);
}

function clientFor(ctx: TestContext, errors: unknown[], captureContent: boolean) {
  return createPulsemonClient(
    {
      PULSEMON_INGEST_URL: "https://pulsemon.test",
      PULSEMON_INGEST_KEY: "test-key",
      ...(captureContent ? { PULSEMON_CONTENT_CAPTURE: "true" } : {}),
    },
    { fetch: transport(ctx), onError: (detail) => errors.push(detail) },
  );
}

/** One of every record kind the client can emit, every optional field set. */
function emitEverything(client: ReturnType<typeof createPulsemonClient>) {
  client.connection({
    id: "conn-wire-1",
    service: "voice-gateway-audio",
    connectionType: "webrtc",
    clientId: "client-1",
    sessionId: "scan-1",
    startedAt: T0,
    status: "active",
    metadata: { tts_provider: "elevenlabs", stt_provider: "flux" },
  });
  client.connectionUpdate({
    id: "conn-wire-1",
    endedAt: T0 + 42_000,
    durationMs: 42_000,
    closeReason: "client_closed",
    status: "closed",
    metadata: { turns: 3 },
  });
  client.span({
    id: "span-wire-1",
    traceId: "trace-wire-1",
    parentSpanId: "span-wire-0",
    connectionId: "conn-wire-1",
    service: "voice-gateway",
    operation: "GET /scan/:deploymentId",
    startedAt: T0,
    endedAt: T0 + 12,
    durationMs: 12,
    status: "ok",
    statusMessage: "served",
    attributes: { path: "/scan/:deploymentId", status: 200, env: "test" },
  });
  client.event({
    id: "event-wire-1",
    eventType: "scan.started",
    connectionId: "conn-wire-1",
    traceId: "trace-wire-1",
    spanId: "span-wire-1",
    timestamp: T0,
    attributes: { step: "intro" },
    direction: "in",
    sizeBytes: 12,
  });
  client.log({
    id: "log-wire-1",
    timestamp: T0,
    level: "info",
    service: "scan-service",
    message: "scan started",
    traceId: "trace-wire-1",
    spanId: "span-wire-1",
    connectionId: "conn-wire-1",
    attributes: { env: "test" },
  });
  client.metric({
    id: "metric-wire-1",
    service: "voice-gateway",
    metricName: "app.slo.voice.turns",
    metricType: "counter",
    value: 1,
    timestamp: T0,
    unit: "count",
    tags: { env: "test" },
  });
  client.voiceTurn({
    id: "turn-wire-1",
    connectionId: "conn-wire-1",
    sessionId: "scan-1",
    traceId: "trace-wire-1",
    turnIndex: 1,
    role: "user",
    startedAt: T0,
    endedAt: T0 + 900,
    durationMs: 900,
    interruption: false,
    audioLatencyMs: 300,
    asrLatencyMs: 240,
    llmLatencyMs: 410,
    ttsLatencyMs: 120,
    inputTokens: 40,
    outputTokens: 60,
    costUsd: 0.0012,
    state: "complete",
    transcript: TRANSCRIPT,
    ttsDegradedReason: "rate_limited",
    metadata: { brain: "gemini" },
  });
  client.toolCall({
    id: "tool-wire-1",
    traceId: "trace-wire-1",
    spanId: "span-wire-1",
    connectionId: "conn-wire-1",
    sessionId: "scan-1",
    turnId: "turn-wire-1",
    toolName: "lookup_account",
    startedAt: T0,
    endedAt: T0 + 5,
    durationMs: 5,
    status: "ok",
    retryCount: 0,
    metadata: { source: "north-star" },
  });
}

describe("published pulsemon-client client ↔ this receiver's ingest contract", () => {
  it("every record kind the client emits is accepted and persisted", async () => {
    const ctx = createTestContext();
    const errors: unknown[] = [];
    const client = clientFor(ctx, errors, true);
    expect(client.enabled).toBe(true);

    emitEverything(client);
    expect(client.pending).toBe(8);
    await client.flush();

    // The client never throws; a contract break shows up ONLY here.
    expect(errors).toEqual([]);
    expect(client.pending).toBe(0);

    const one = <T>(sql: string, ...args: unknown[]) => ctx.sqlite.prepare(sql).get(...(args as never[])) as T;

    // connections + connection_updates collapse onto one row: opened, then closed.
    expect(one<{ service: string; connection_type: string; status: string; duration_ms: number; close_reason: string }>(
      "SELECT service, connection_type, status, duration_ms, close_reason FROM connections WHERE id = ?", "conn-wire-1",
    )).toEqual({ service: "voice-gateway-audio", connection_type: "webrtc", status: "closed", duration_ms: 42_000, close_reason: "client_closed" });

    expect(one<{ operation: string; status: string; duration_ms: number; trace_id: string }>(
      "SELECT operation, status, duration_ms, trace_id FROM spans WHERE id = ?", "span-wire-1",
    )).toEqual({ operation: "GET /scan/:deploymentId", status: "ok", duration_ms: 12, trace_id: "trace-wire-1" });

    expect(one<{ event_type: string }>("SELECT event_type FROM events WHERE id = ?", "event-wire-1"))
      .toEqual({ event_type: "scan.started" });

    expect(one<{ level: string; service: string; message: string }>(
      "SELECT level, service, message FROM logs WHERE id = ?", "log-wire-1",
    )).toEqual({ level: "info", service: "scan-service", message: "scan started" });

    expect(one<{ metric_name: string; metric_type: string; value: number }>(
      "SELECT metric_name, metric_type, value FROM metrics WHERE id = ?", "metric-wire-1",
    )).toEqual({ metric_name: "app.slo.voice.turns", metric_type: "counter", value: 1 });

    // Content capture on: the transcript reaches D1. The TTS-degradation
    // reason rides `metadata`, not a column — that is the pinned shape.
    const turn = one<{ role: string; transcript: string; asr_latency_ms: number; metadata: string }>(
      "SELECT role, transcript, asr_latency_ms, metadata FROM voice_turns WHERE id = ?", "turn-wire-1",
    );
    expect(turn.role).toBe("user");
    expect(turn.transcript).toBe(TRANSCRIPT);
    expect(turn.asr_latency_ms).toBe(240);
    expect(JSON.parse(turn.metadata)).toMatchObject({ tts_degraded_reason: "rate_limited", brain: "gemini" });

    expect(one<{ tool_name: string; status: string; duration_ms: number }>(
      "SELECT tool_name, status, duration_ms FROM agent_tool_calls WHERE id = ?", "tool-wire-1",
    )).toEqual({ tool_name: "lookup_account", status: "ok", duration_ms: 5 });
  });

  it("without PULSEMON_CONTENT_CAPTURE the client strips the transcript before the wire", async () => {
    const ctx = createTestContext();
    const errors: unknown[] = [];
    const client = clientFor(ctx, errors, false);

    client.voiceTurn({ id: "turn-wire-2", connectionId: "conn-x", sessionId: "scan-2", turnIndex: 1, role: "user", transcript: TRANSCRIPT });
    await client.flush();

    expect(errors).toEqual([]);
    const row = ctx.sqlite.prepare("SELECT transcript FROM voice_turns WHERE id = ?").get("turn-wire-2") as { transcript: string | null };
    expect(row.transcript ?? null).toBeNull();
  });

  it("negative control: a stale wire shape is rejected, so drift cannot pass silently", async () => {
    // The pre-fix client shipped camelCase keys. If the receiver ever started
    // accepting them, the first test could no longer distinguish a correct
    // client from a drifted one.
    const ctx = createTestContext();
    const res = await ctx.request("/api/ingest/batch", {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ connections: [{ id: "stale-1", service: "x", connectionType: "webrtc" }] }),
    });
    expect(res.status).toBe(422);
  });
});
