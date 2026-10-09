import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { createTestContext } from "../helpers";
import {
  queryVoiceConcurrencyNow,
  queryVoiceConcurrencyWindow,
} from "@/lib/effect/voice-concurrency-io";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

const WINDOW_FROM = "2026-08-18T09:00:00.000Z";
const WINDOW_TO = "2026-08-18T10:00:00.000Z";

describe("queryVoiceConcurrencyWindow", () => {
  it("buckets sessions from connections rows", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({
      id: "conn-a",
      started_at: "2026-08-18T09:10:00.000Z",
      duration_ms: 20 * 60_000,
      status: "closed",
    });
    ctx.sqlite.prepare(`UPDATE connections SET ended_at = ? WHERE id = ?`).run(
      "2026-08-18T09:30:00.000Z",
      "conn-a"
    );

    const result = await Effect.runPromise(
      queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE, { from: WINDOW_FROM, to: WINDOW_TO })
    );

    expect(result.sessions.peak).toBe(1);
    expect(result.sessions.series.source).toBe("raw");
    expect(result.llm.peak).toBe(0);
    expect(result.tts.peak).toBe(0);
  });

  it("falls back to voice_turns-derived session intervals when no connections exist in the window", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({
      id: "turn-a",
      session_id: "session-a",
      started_at: "2026-08-18T09:05:00.000Z",
    });
    ctx.sqlite.prepare(`UPDATE voice_turns SET ended_at = ? WHERE id = ?`).run(
      "2026-08-18T09:07:00.000Z",
      "turn-a"
    );

    const result = await Effect.runPromise(
      queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE, { from: WINDOW_FROM, to: WINDOW_TO })
    );

    expect(result.sessions.peak).toBe(1);
    expect(result.sessions.current).toBe(0); // fallback intervals never read as open
  });

  it("still falls back when a connections row exists but outside this window", async () => {
    const ctx = createTestContext();
    // A connection well outside the query window — the primary query still
    // returns zero rows FOR THIS WINDOW, so the fallback triggers exactly as
    // it would for a tenant with no connections rows at all.
    ctx.seedConnection({
      id: "conn-old",
      started_at: "2026-08-17T09:00:00.000Z",
      duration_ms: 60_000,
      status: "closed",
    });
    ctx.sqlite.prepare(`UPDATE connections SET ended_at = ? WHERE id = ?`).run(
      "2026-08-17T09:01:00.000Z",
      "conn-old"
    );
    // Turn data inside the window that the fallback should pick up.
    ctx.seedVoiceTurn({ id: "turn-a", session_id: "session-a", started_at: "2026-08-18T09:05:00.000Z" });

    const result = await Effect.runPromise(
      queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE, { from: WINDOW_FROM, to: WINDOW_TO })
    );

    expect(result.sessions.peak).toBe(1);
  });

  it("buckets LLM and TTS generation spans separately by operation", async () => {
    const ctx = createTestContext();
    ctx.seedSpan({
      id: "span-llm",
      operation: "voice.llm.generate",
      started_at: "2026-08-18T09:10:00.000Z",
      duration_ms: 2000,
    });
    ctx.sqlite.prepare(`UPDATE spans SET ended_at = ? WHERE id = ?`).run(
      "2026-08-18T09:10:02.000Z",
      "span-llm"
    );
    ctx.seedSpan({
      id: "span-tts-1",
      operation: "voice.tts.synthesize",
      started_at: "2026-08-18T09:12:00.000Z",
      duration_ms: 500,
    });
    ctx.sqlite.prepare(`UPDATE spans SET ended_at = ? WHERE id = ?`).run(
      "2026-08-18T09:12:00.500Z",
      "span-tts-1"
    );
    ctx.seedSpan({
      id: "span-tts-2",
      operation: "voice.tts.synthesize",
      started_at: "2026-08-18T09:12:00.100Z",
      duration_ms: 500,
    });
    ctx.sqlite.prepare(`UPDATE spans SET ended_at = ? WHERE id = ?`).run(
      "2026-08-18T09:12:00.600Z",
      "span-tts-2"
    );

    const result = await Effect.runPromise(
      queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE, { from: WINDOW_FROM, to: WINDOW_TO })
    );

    expect(result.llm.peak).toBe(1);
    expect(result.tts.peak).toBe(2); // the two TTS spans overlap
  });

  it("ignores spans of other operations entirely", async () => {
    const ctx = createTestContext();
    ctx.seedSpan({ id: "span-other", operation: "asr.transcribe", started_at: "2026-08-18T09:10:00.000Z" });

    const result = await Effect.runPromise(
      queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE, { from: WINDOW_FROM, to: WINDOW_TO })
    );

    expect(result.llm.peak).toBe(0);
    expect(result.tts.peak).toBe(0);
  });

  it("rejects a window wider than the cap", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        queryVoiceConcurrencyWindow(createTestContext().d1, DEFAULT_TENANT_SCOPE, {
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-08-31T00:00:00.000Z",
        })
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
    }
  });

  it("rejects from after to", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        queryVoiceConcurrencyWindow(createTestContext().d1, DEFAULT_TENANT_SCOPE, {
          from: WINDOW_TO,
          to: WINDOW_FROM,
        })
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
    }
  });

  it("rejects an out-of-range minutes value", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        queryVoiceConcurrencyWindow(createTestContext().d1, DEFAULT_TENANT_SCOPE, { minutes: 999_999 })
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
    }
  });

  it("defaults to the last hour when no window params are given", async () => {
    const ctx = createTestContext();
    const result = await Effect.runPromise(queryVoiceConcurrencyWindow(ctx.d1, DEFAULT_TENANT_SCOPE));
    const spanMs = Date.parse(result.to) - Date.parse(result.from);
    expect(spanMs).toBe(60 * 60_000);
  });
});

describe("queryVoiceConcurrencyNow", () => {
  it("counts active connections started recently as sessionsNow", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({
      id: "conn-live",
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      status: "active",
    });

    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(now.sessionsNow).toBe(1);
  });

  it("applies the staleness guard: an old active row does not count as live", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({
      id: "conn-leaked",
      started_at: new Date(Date.now() - 6 * 60 * 60_000).toISOString(), // 6h ago
      status: "active",
    });

    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(now.sessionsNow).toBe(0);
  });

  it("does not count a closed connection as live regardless of recency", async () => {
    const ctx = createTestContext();
    ctx.seedConnection({
      id: "conn-closed",
      started_at: new Date(Date.now() - 30_000).toISOString(),
      status: "closed",
    });

    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(now.sessionsNow).toBe(0);
  });

  it("counts LLM/TTS spans with no ended_at as in-flight", async () => {
    const ctx = createTestContext();
    ctx.seedSpan({
      id: "span-llm-live",
      operation: "voice.llm.generate",
      started_at: new Date(Date.now() - 2000).toISOString(),
    });
    ctx.sqlite.prepare(`UPDATE spans SET ended_at = NULL WHERE id = ?`).run("span-llm-live");

    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(now.llmInFlight).toBe(1);
    expect(now.ttsInFlight).toBe(0);
  });

  it("does not count a completed span outside the lookback window", async () => {
    const ctx = createTestContext();
    const startedAt = new Date(Date.now() - 60 * 60_000); // 1h ago
    ctx.seedSpan({
      id: "span-tts-old",
      operation: "voice.tts.synthesize",
      started_at: startedAt.toISOString(),
      duration_ms: 500,
    });
    ctx.sqlite.prepare(`UPDATE spans SET ended_at = ? WHERE id = ?`).run(
      new Date(startedAt.getTime() + 500).toISOString(),
      "span-tts-old"
    );

    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));

    expect(now.ttsInFlight).toBe(0);
  });

  it("returns zeros for an empty tenant", async () => {
    const ctx = createTestContext();
    const now = await Effect.runPromise(queryVoiceConcurrencyNow(ctx.d1, DEFAULT_TENANT_SCOPE));
    expect(now).toEqual({ sessionsNow: 0, llmInFlight: 0, ttsInFlight: 0 });
  });
});
