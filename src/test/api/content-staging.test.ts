import { describe, expect, it, spyOn } from "bun:test";
import { processTelemetryQueueBatch, processTelemetryQueueMessages } from "@/lib/effect/telemetry-queue";
import {
  createRawTelemetryBucketHarness,
  createTelemetryQueueHarness,
  createTestContext,
} from "../helpers";

const authHeaders = { Authorization: "Bearer test-key", "Content-Type": "application/json" };
const TRANSCRIPT = "what is my account balance for the savings pot";

function queuedContext(withBucket = true) {
  const queue = createTelemetryQueueHarness();
  const rawTelemetry = createRawTelemetryBucketHarness();
  const ctx = createTestContext({
    env: {
      INGEST_MODE: "queued",
      TELEMETRY_QUEUE: queue.queue,
      ...(withBucket ? { RAW_TELEMETRY: rawTelemetry.bucket, RAW_TELEMETRY_PREFIX: "raw-test" } : {}),
    },
  });
  return { ctx, queue, rawTelemetry };
}

describe("queued ingest keeps end-user content out of the queue", () => {
  it("stages a voice turn's transcript in R2 and enqueues a reference, never the text", async () => {
    const { ctx, queue, rawTelemetry } = queuedContext();

    const res = await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "staged-turn-1",
        connection_id: "conn-1",
        session_id: "sess-1",
        turn_index: 1,
        role: "user",
        transcript: TRANSCRIPT,
        asr_latency_ms: 240,
      }),
    });
    expect(res.status).toBe(202);
    expect(queue.messages).toHaveLength(1);

    const message = queue.messages[0]!;
    // The envelope: reference present, content absent — and the serialized
    // form (what Cloudflare Queues actually carries) has no trace of the text.
    expect(message.content_refs).toEqual([
      expect.objectContaining({ collection: "voiceTurns", index: 0, field: "transcript" }),
    ]);
    expect(message.content_refs![0]!.key).toBe(
      `raw-test-content/workspace=default/project=default/message=${message.id}/voiceTurns-0-transcript.json`,
    );
    expect(message.batch.voiceTurns[0]!.transcript).toBeUndefined();
    expect(message.batch.voiceTurns[0]!.asr_latency_ms).toBe(240);
    expect(JSON.stringify(message)).not.toContain(TRANSCRIPT);

    // The content went to the EU bucket, keyed by the reference.
    expect(rawTelemetry.objects).toHaveLength(1);
    expect(rawTelemetry.objects[0]!.key).toBe(message.content_refs![0]!.key);
    expect(JSON.parse(rawTelemetry.objects[0]!.body)).toEqual({ value: TRANSCRIPT });
    expect(rawTelemetry.objects[0]!.options?.customMetadata).toMatchObject({
      queue_message_id: message.id,
      collection: "voiceTurns",
      field: "transcript",
    });
  });

  it("hydrates the transcript back into D1 on consume; the raw archive stays content-free", async () => {
    const { ctx, queue, rawTelemetry } = queuedContext();
    await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "staged-turn-2",
        connection_id: "conn-1",
        session_id: "sess-1",
        turn_index: 2,
        role: "assistant",
        transcript: TRANSCRIPT,
      }),
    });

    await processTelemetryQueueMessages({
      DB: ctx.d1,
      RAW_TELEMETRY: rawTelemetry.bucket,
      RAW_TELEMETRY_PREFIX: "raw-test",
    }, queue.messages);

    const row = ctx.sqlite
      .prepare("SELECT role, transcript FROM voice_turns WHERE id = ?")
      .get("staged-turn-2") as { role: string; transcript: string };
    expect(row).toEqual({ role: "assistant", transcript: TRANSCRIPT });

    // Two objects: the staged content and the archived envelope. The archive
    // carries the reference, not the text; the staged object is still there
    // (never deleted — redeliveries must hydrate too).
    expect(rawTelemetry.objects).toHaveLength(2);
    const archive = rawTelemetry.objects.find((o) => o.key.startsWith("raw-test/"))!;
    expect(archive).toBeDefined();
    expect(archive.body).not.toContain(TRANSCRIPT);
    expect(JSON.parse(archive.body).content_refs).toHaveLength(1);
    expect(rawTelemetry.objects.filter((o) => o.key.includes("-content/"))).toHaveLength(1);
  });

  it("stages tool-call input and output the same way", async () => {
    const { ctx, queue, rawTelemetry } = queuedContext();
    const res = await ctx.request("/api/ingest/batch", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        tool_calls: [{
          id: "staged-tool-1",
          trace_id: "trace-1",
          tool_name: "lookup_account",
          status: "ok",
          input: { query: "savings pot balance" },
          output: { balance: 1234 },
        }],
      }),
    });
    expect(res.status).toBe(202);

    const message = queue.messages[0]!;
    expect(message.content_refs?.map((r) => r.field).sort()).toEqual(["input", "output"]);
    expect(message.batch.toolCalls[0]!.input).toBeUndefined();
    expect(message.batch.toolCalls[0]!.output).toBeUndefined();
    expect(JSON.stringify(message)).not.toContain("savings pot balance");

    await processTelemetryQueueMessages({ DB: ctx.d1, RAW_TELEMETRY: rawTelemetry.bucket }, queue.messages);
    const row = ctx.sqlite
      .prepare("SELECT input, output FROM agent_tool_calls WHERE id = ?")
      .get("staged-tool-1") as { input: string; output: string };
    expect(JSON.parse(row.input)).toEqual({ query: "savings pot balance" });
    expect(JSON.parse(row.output)).toEqual({ balance: 1234 });
  });

  it("refuses queued content with no bucket — content never falls back into the queue", async () => {
    const { ctx, queue } = queuedContext(false);
    const res = await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        connection_id: "conn-1",
        session_id: "sess-1",
        turn_index: 1,
        role: "user",
        transcript: TRANSCRIPT,
      }),
    });
    expect(res.status).toBe(503);
    expect(await res.json() as unknown).toEqual({ error: "Queued ingest of content requires the RAW_TELEMETRY bucket" });
    expect(queue.messages).toHaveLength(0);
  });

  it("leaves content-free messages untouched, bucket or not", async () => {
    const { ctx, queue } = queuedContext(false);
    const res = await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        connection_id: "conn-1",
        session_id: "sess-1",
        turn_index: 1,
        role: "user",
        asr_latency_ms: 200,
      }),
    });
    expect(res.status).toBe(202);
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]!.content_refs).toBeUndefined();
  });

  it("retries, rather than persisting a hollow turn, when a staged object is missing", async () => {
    const { ctx, queue, rawTelemetry } = queuedContext();
    await ctx.request("/api/ingest/voice/turns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "staged-turn-3",
        connection_id: "conn-1",
        session_id: "sess-1",
        turn_index: 3,
        role: "user",
        transcript: TRANSCRIPT,
      }),
    });
    // Simulate the staged object vanishing (it should never happen — that is
    // exactly why the consumer must not paper over it).
    rawTelemetry.objects.length = 0;

    let retried = false;
    let acknowledged = false;
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    await processTelemetryQueueBatch({ DB: ctx.d1, RAW_TELEMETRY: rawTelemetry.bucket }, {
      messages: [{
        body: queue.messages[0],
        attempts: 1,
        retry: () => { retried = true; },
        ack: () => { acknowledged = true; },
      }],
    } as unknown as MessageBatch<never>);
    errorLog.mockRestore();

    expect(retried).toBe(true);
    expect(acknowledged).toBe(false);
    const row = ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_turns WHERE id = ?").get("staged-turn-3") as { n: number };
    expect(row.n).toBe(0);
  });
});
