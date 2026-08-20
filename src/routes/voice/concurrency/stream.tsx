import type { Context } from "hono";
import { Effect, Either } from "effect";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { Env } from "@/types";
import type { TenantScope } from "@/types";
import { tenantScopeFromEnv } from "@/lib/tenant";
import { queryVoiceConcurrencyNow, queryVoiceConcurrencyWindow } from "@/lib/effect/voice-concurrency-io";
import {
  VoiceConcurrencyPanel,
  CONCURRENCY_WINDOW_MINUTES,
  concurrencyWindowKey,
  type ConcurrencyWindowKey,
} from "@/components/VoiceConcurrencyPanel";

/** How often the panel is re-rendered and pushed down the open connection.
 *  Well under Cloudflare's ~100s idle-connection kill, so this cadence alone
 *  keeps the stream alive — no separate heartbeat frame needed. */
const TICK_MS = 5_000;

/**
 * Cap on how long a single connection stays open. Datastar does NOT re-fire
 * `data-init`'s `@get` after a stream that finished cleanly (retry only
 * covers errors/disconnects), so the final frame re-arms the client itself:
 * it patches the panel with mode `replace`, which recreates the element and
 * re-runs its `data-init` — opening a fresh connection. Every connection
 * still has a bounded lifetime; an aborted (closed-tab) stream skips the
 * re-arm frame.
 */
const MAX_STREAM_MS = 10 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The one method of the SDK generator this loop needs — lets tests pass a
 *  recording fake instead of a live SSE connection. */
export interface ConcurrencyStreamSink {
  patchElements(html: string, options?: { mode?: string }): void;
}

export interface ConcurrencyStreamOptions {
  readonly db: D1Database;
  readonly tenant: TenantScope;
  readonly windowKey: ConcurrencyWindowKey;
  readonly tickMs?: number;
  readonly maxStreamMs?: number;
}

/**
 * The stream body, extracted from the handler so the re-arm contract is
 * unit-testable with tiny timings (the real cap is 10 minutes — unwaitable
 * in a test). Behaviour:
 * - one panel morph per tick while data reads succeed; a transient failure
 *   skips that tick's patch (the panel keeps its last good frame);
 * - on reaching the cap WITHOUT an abort, one final `mode: "replace"` patch
 *   re-arms the client (replace recreates #voice-concurrency-panel, so its
 *   `data-init` re-fires and opens the next connection — a plain morph
 *   would keep the element and the panel would silently freeze);
 * - the re-arm frame reuses the last good frame if the final read fails;
 *   with no good frame at all there is nothing valid to patch and the loop
 *   just ends (SSR frame remains);
 * - an abort (closed tab) stops within one tick and never re-arms.
 */
export async function runConcurrencyStream(
  sse: ConcurrencyStreamSink,
  isAborted: () => boolean,
  { db, tenant, windowKey, tickMs = TICK_MS, maxStreamMs = MAX_STREAM_MS }: ConcurrencyStreamOptions,
): Promise<void> {
  const minutes = CONCURRENCY_WINDOW_MINUTES[windowKey];
  const startedAt = Date.now();
  let lastGoodHtml: string | null = null;

  const renderFrame = async (): Promise<string | null> => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.all(
          [queryVoiceConcurrencyNow(db, tenant), queryVoiceConcurrencyWindow(db, tenant, { minutes })],
          { concurrency: 2 }
        )
      )
    );
    if (Either.isLeft(result)) return null;
    const [now, windowResult] = result.right;
    return String(<VoiceConcurrencyPanel now={now} window={windowResult} windowKey={windowKey} />);
  };

  while (!isAborted() && Date.now() - startedAt < maxStreamMs) {
    const html = await renderFrame();
    if (html !== null) {
      lastGoodHtml = html;
      sse.patchElements(html);
    }
    await sleep(tickMs);
  }

  if (isAborted()) return;

  const finalHtml = (await renderFrame()) ?? lastGoodHtml;
  if (finalHtml !== null) {
    sse.patchElements(finalHtml, { mode: "replace" });
  }
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const windowKey = concurrencyWindowKey(c.req.query("window"));
  const db = c.env.DB;

  // Shared across both callbacks below: `onAbort` fires when the client
  // disconnects, and the loop checks it each tick so an abandoned tab stops
  // querying D1 within one `TICK_MS` instead of running for the full cap.
  let aborted = false;

  return ServerSentEventGenerator.stream(
    async (sse) => {
      await runConcurrencyStream(sse, () => aborted, { db, tenant, windowKey });
      sse.close();
    },
    {
      keepalive: true,
      onAbort: () => {
        aborted = true;
      },
    }
  );
};
