import { Effect } from "effect";
import type { Env } from "@/types";
import { InternalError, MissingConfigError, type IngestError } from "./errors";
import type { TelemetryQueueMessage } from "./telemetry-queue";

/**
 * Content staging — keeps end-user content OUT of the queue.
 *
 * Cloudflare Queues have no data-residency control, so
 * in queued mode a message must carry ids and metrics only. The fields that
 * can hold verbatim end-user content — a voice turn's `transcript`, and an
 * agent tool call's `input` / `output` — are written to the R2
 * bucket at the edge (`content/…`, keyed by queue message id) and replaced in
 * the envelope by references. The queue consumer hydrates them back before the
 * D1 write, so the persisted model and the UI are unchanged: content still
 * lives in D1 (and now also R2); the queue only ever
 * sees where it is.
 *
 * Staged objects are NOT deleted after persistence. Queues are at-least-once:
 * a redelivery after a successful write must still hydrate, or an already
 * persisted message would poison itself into the dead-letter queue. They sit
 * beside the raw envelope archive under the same bucket and retention story.
 *
 * Scope matches the client's content-free contract (pulsemon-client
 * scrubs every content-shaped attribute key before the wire; `transcript` is
 * the one field it can ship, behind PULSEMON_CONTENT_CAPTURE). Log messages
 * and attributes are governed (redaction) rather than staged — the surface
 * rule is that they carry no PII, and staging them would make every log line
 * an R2 round trip.
 *
 * Direct mode (INGEST_MODE=direct) never enters here: no queue, no transit.
 */

export interface ContentRef {
  readonly collection: "voiceTurns" | "toolCalls";
  readonly index: number;
  readonly field: "transcript" | "input" | "output";
  readonly key: string;
}

export type ContentStagingEnv = Pick<Env, "RAW_TELEMETRY" | "RAW_TELEMETRY_PREFIX">;

const CONTENT_FIELDS: Record<ContentRef["collection"], readonly ContentRef["field"][]> = {
  voiceTurns: ["transcript"],
  toolCalls: ["input", "output"],
};

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._=-]/g, "_");
}

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  return true;
}

function contentKey(message: TelemetryQueueMessage, ref: Omit<ContentRef, "key">, prefix = "telemetry") {
  return [
    `${prefix.replace(/^\/+|\/+$/g, "") || "telemetry"}-content`,
    `workspace=${cleanSegment(message.context.workspace_id)}`,
    `project=${cleanSegment(message.context.project_id)}`,
    `message=${cleanSegment(message.id)}`,
    `${ref.collection}-${ref.index}-${ref.field}.json`,
  ].join("/");
}

/** Every content-bearing field present in the message, with its future key. */
function findContent(message: TelemetryQueueMessage, prefix: string | undefined): ContentRef[] {
  const refs: ContentRef[] = [];
  for (const collection of Object.keys(CONTENT_FIELDS) as ContentRef["collection"][]) {
    const rows = message.batch[collection] as readonly Record<string, unknown>[];
    rows.forEach((row, index) => {
      for (const field of CONTENT_FIELDS[collection]) {
        if (hasContent(row[field])) {
          const ref = { collection, index, field };
          refs.push({ ...ref, key: contentKey(message, ref, prefix) });
        }
      }
    });
  }
  return refs;
}

function withField(
  message: TelemetryQueueMessage,
  ref: ContentRef,
  value: unknown
): TelemetryQueueMessage {
  const rows = [...(message.batch[ref.collection] as readonly Record<string, unknown>[])];
  rows[ref.index] = { ...rows[ref.index], [ref.field]: value };
  return { ...message, batch: { ...message.batch, [ref.collection]: rows } };
}

/**
 * Edge side. Writes each content value to R2 and returns the envelope with
 * those fields removed and `content_refs` recorded. A message with no content
 * passes through untouched — the common case for logs, spans and metrics.
 *
 * Content with no bucket is a hard stop, whatever RAW_TELEMETRY_REQUIRED says:
 * the alternative is content in the queue, which is the thing this exists to
 * prevent. Rigs bind the bucket; a deployment that does not cannot run queued
 * ingest for content-bearing signals.
 */
export function stageContent(
  env: ContentStagingEnv,
  message: TelemetryQueueMessage
): Effect.Effect<TelemetryQueueMessage, IngestError> {
  const refs = findContent(message, env.RAW_TELEMETRY_PREFIX);
  if (refs.length === 0) return Effect.succeed(message);
  if (!env.RAW_TELEMETRY) {
    return Effect.fail(new MissingConfigError({
      message: "Queued ingest of content requires the RAW_TELEMETRY bucket",
    }));
  }
  const bucket = env.RAW_TELEMETRY;

  return Effect.tryPromise({
    try: async () => {
      let staged = message;
      for (const ref of refs) {
        const row = (message.batch[ref.collection] as readonly Record<string, unknown>[])[ref.index];
        await bucket.put(ref.key, JSON.stringify({ value: row[ref.field] }), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            workspace_id: message.context.workspace_id,
            project_id: message.context.project_id,
            queue_message_id: message.id,
            collection: ref.collection,
            field: ref.field,
          },
        });
        staged = withField(staged, ref, undefined);
      }
      return { ...staged, content_refs: refs };
    },
    catch: (error) => new InternalError({
      message: error instanceof Error ? error.message : "Failed to stage telemetry content",
    }),
  });
}

/**
 * Consumer side. Reads every referenced object back into its field. A missing
 * object is an error (the message retries and, eventually, dead-letters with
 * its references intact): objects are never deleted, so absence means the
 * edge write did not happen, and persisting a turn without its transcript
 * would silently drop what the emitter sent.
 */
export function hydrateContent(
  env: ContentStagingEnv,
  message: TelemetryQueueMessage
): Effect.Effect<TelemetryQueueMessage, IngestError> {
  const refs = message.content_refs ?? [];
  if (refs.length === 0) return Effect.succeed(message);
  if (!env.RAW_TELEMETRY) {
    return Effect.fail(new MissingConfigError({
      message: "Queued message carries content references but no RAW_TELEMETRY bucket is bound",
    }));
  }
  const bucket = env.RAW_TELEMETRY;

  return Effect.tryPromise({
    try: async () => {
      let hydrated = message;
      for (const ref of refs) {
        const object = await bucket.get(ref.key);
        if (!object) throw new Error(`staged content missing: ${ref.collection}[${ref.index}].${ref.field}`);
        const { value } = (await object.json()) as { value: unknown };
        hydrated = withField(hydrated, ref, value);
      }
      const { content_refs: _refs, ...rest } = hydrated;
      return rest as TelemetryQueueMessage;
    },
    catch: (error) => new InternalError({
      message: error instanceof Error ? error.message : "Failed to hydrate telemetry content",
    }),
  });
}
