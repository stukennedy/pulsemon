import { Effect } from "effect";
import type { Env } from "@/types";
import { MissingConfigError, type IngestError } from "./errors";
import type { TelemetryQueueMessage } from "./telemetry-queue";

export type RawTelemetryEnv = Pick<
  Env,
  "RAW_TELEMETRY" | "RAW_TELEMETRY_PREFIX" | "RAW_TELEMETRY_REQUIRED"
>;

function isRequired(value: string | undefined) {
  return value === "true" || value === "1" || value === "yes";
}

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._=-]/g, "_");
}

export function rawTelemetryKey(message: TelemetryQueueMessage, prefix = "telemetry") {
  const enqueued = new Date(message.enqueued_at);
  const validDate = Number.isFinite(enqueued.getTime()) ? enqueued : new Date(0);
  const year = String(validDate.getUTCFullYear()).padStart(4, "0");
  const month = String(validDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(validDate.getUTCDate()).padStart(2, "0");
  const hour = String(validDate.getUTCHours()).padStart(2, "0");
  const tenant = message.context;

  return [
    prefix.replace(/^\/+|\/+$/g, "") || "telemetry",
    `workspace=${cleanSegment(tenant.workspace_id)}`,
    `project=${cleanSegment(tenant.project_id)}`,
    `signal=${cleanSegment(message.signal)}`,
    `year=${year}`,
    `month=${month}`,
    `day=${day}`,
    `hour=${hour}`,
    `${cleanSegment(message.id)}.json`,
  ].join("/");
}

export function archiveRawTelemetryMessage(
  env: RawTelemetryEnv,
  message: TelemetryQueueMessage
): Effect.Effect<void, IngestError> {
  if (!env.RAW_TELEMETRY) {
    return isRequired(env.RAW_TELEMETRY_REQUIRED)
      ? Effect.fail(new MissingConfigError({ message: "Raw telemetry bucket is not configured" }))
      : Effect.void;
  }

  const key = rawTelemetryKey(message, env.RAW_TELEMETRY_PREFIX);
  const body = JSON.stringify(message);

  return Effect.tryPromise({
    try: async () => {
      await env.RAW_TELEMETRY!.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          workspace_id: message.context.workspace_id,
          project_id: message.context.project_id,
          signal: message.signal,
          queue_message_id: message.id,
        },
      });
    },
    catch: (error) => new MissingConfigError({
      message: error instanceof Error ? error.message : "Failed to archive raw telemetry",
    }),
  });
}
