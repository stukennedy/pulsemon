import { describe, it, expect } from "bun:test";
import { createTestContext } from "../helpers";

/**
 * The stream stays open for up to 10 minutes pushing a frame every ~5s
 * (`src/routes/voice/concurrency/stream.tsx`), so this only reads the FIRST
 * frame off the response body and cancels — cancelling the reader triggers
 * the SDK's `onAbort` callback (see `ServerSentEventGenerator.stream`'s
 * `cancel` handler), which stops the route's loop from scheduling further
 * ticks. Reading to completion would hang the test for up to 10 minutes.
 */
async function readFirstChunk(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("expected a streamed response body");
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("GET /voice/concurrency/stream", () => {
  it("responds with an SSE stream carrying a datastar-patch-elements frame for the panel", async () => {
    const ctx = createTestContext();

    const res = await ctx.request("/voice/concurrency/stream");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const firstChunk = await readFirstChunk(res);
    expect(firstChunk).toContain("event: datastar-patch-elements");
    expect(firstChunk).toContain("elements ");
    expect(firstChunk).toContain('id="voice-concurrency-panel"');
    expect(firstChunk).toContain("Sessions now");
  });

  it("honours the ?window= param in the first rendered frame", async () => {
    const ctx = createTestContext();

    const res = await ctx.request("/voice/concurrency/stream?window=24h");
    const firstChunk = await readFirstChunk(res);

    expect(firstChunk).toContain("24h");
  });

  it("re-arms the panel with a mode:replace patch when the stream cap is reached without an abort", async () => {
    const { runConcurrencyStream } = await import("@/routes/voice/concurrency/stream");
    const { DEFAULT_TENANT_SCOPE } = await import("@/lib/tenant");
    const ctx = createTestContext();
    const patches: Array<{ html: string; mode?: string }> = [];

    await runConcurrencyStream(
      { patchElements: (html, options) => patches.push({ html, mode: options?.mode }) },
      () => false,
      { db: ctx.d1, tenant: DEFAULT_TENANT_SCOPE, windowKey: "1h", tickMs: 1, maxStreamMs: 10 },
    );

    // At least one live morph frame, and the FINAL frame must be a replace —
    // Datastar does not re-run data-init after a cleanly finished stream, so
    // only recreating #voice-concurrency-panel re-opens the connection.
    expect(patches.length).toBeGreaterThanOrEqual(2);
    const last = patches[patches.length - 1]!;
    expect(last.mode).toBe("replace");
    expect(last.html).toContain('id="voice-concurrency-panel"');
    // Hono JSX HTML-escapes the quotes inside attribute values.
    expect(last.html).toContain("@get(&#39;/voice/concurrency/stream?window=1h&#39;)");
    for (const frame of patches.slice(0, -1)) expect(frame.mode).toBeUndefined();
  });

  it("never re-arms after an abort (closed tab)", async () => {
    const { runConcurrencyStream } = await import("@/routes/voice/concurrency/stream");
    const { DEFAULT_TENANT_SCOPE } = await import("@/lib/tenant");
    const ctx = createTestContext();
    const patches: Array<{ mode?: string }> = [];
    let ticks = 0;

    await runConcurrencyStream(
      { patchElements: (_html, options) => patches.push({ mode: options?.mode }) },
      () => ticks++ >= 1, // abort after the first tick
      { db: ctx.d1, tenant: DEFAULT_TENANT_SCOPE, windowKey: "1h", tickMs: 1, maxStreamMs: 10_000 },
    );

    expect(patches.some((p) => p.mode === "replace")).toBe(false);
  });

  it("still renders when a session has no PR-A connection/span data (pre-migration data)", async () => {
    const ctx = createTestContext();
    // Old-shape data only: a voice turn with no connection row, no spans.
    ctx.seedVoiceTurn({ id: "legacy-turn", session_id: "legacy-session" });

    const res = await ctx.request("/voice/concurrency/stream");

    expect(res.status).toBe(200);
    const firstChunk = await readFirstChunk(res);
    expect(firstChunk).toContain("event: datastar-patch-elements");
  });
});
