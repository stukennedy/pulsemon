import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import {
  errorStatus,
  MalformedRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/effect/errors";
import { authorizeBrowserKey, ingestBrowserBatch, parseBrowserKeys } from "@/lib/effect/browser";
import { governanceConfigFromEnv } from "@/lib/effect/governance";
import { makeIngestPressureController } from "@/lib/effect/pressure";

const MAX_BROWSER_BODY_BYTES = 1_048_576;

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function readBody(c: Context<{ Bindings: Env }>, gzip: boolean) {
  return Effect.gen(function* () {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BROWSER_BODY_BYTES) {
      return yield* Effect.fail(new PayloadTooLargeError({ message: `Payload exceeds ${MAX_BROWSER_BODY_BYTES} bytes` }));
    }
    if (gzip && typeof DecompressionStream === "undefined") {
      return yield* Effect.fail(new UnsupportedMediaTypeError({ message: "gzip bodies are not supported in this runtime" }));
    }

    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const stream = c.req.raw.body;
        if (!stream) return new Uint8Array();
        const source = gzip ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
        const reader = source.getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BROWSER_BODY_BYTES) {
            await reader.cancel();
            throw new PayloadTooLargeError({ message: `Payload exceeds ${MAX_BROWSER_BODY_BYTES} bytes` });
          }
          parts.push(value);
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.byteLength;
        }
        return out;
      },
      catch: (error) => error instanceof PayloadTooLargeError
        ? error
        : new MalformedRequestError({ message: gzip ? "Invalid gzip body" : "Invalid body" }),
    });

    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return yield* Effect.fail(new MalformedRequestError({ message: "Invalid JSON" }));
    }
  });
}

export const onRequestOptions = async (c: Context<{ Bindings: Env }>) => {
  const origin = c.req.header("origin");
  const keys = await Effect.runPromise(Effect.either(parseBrowserKeys(c.env.BROWSER_INGEST_KEYS)));
  if (Either.isLeft(keys)) return c.body(null, 204);
  const auth = await Effect.runPromise(Effect.either(authorizeBrowserKey(keys.right, c.req.query("key"), origin)));
  return c.body(null, 204, Either.isRight(auth) ? corsHeaders(auth.right.allowOrigin) : {});
};

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const origin = c.req.header("origin");
  let allowOrigin: string | undefined;

  const program = Effect.gen(function* () {
    const keys = yield* parseBrowserKeys(c.env.BROWSER_INGEST_KEYS);
    const auth = yield* authorizeBrowserKey(keys, c.req.query("key"), origin);
    allowOrigin = auth.allowOrigin;
    const body = yield* readBody(c, c.req.query("enc") === "gzip");
    return yield* ingestBrowserBatch({
      db: c.env.DB,
      bucket: c.env.RAW_TELEMETRY,
      auth,
      pressure: makeIngestPressureController(c.env.DB, c.env),
      governance: governanceConfigFromEnv(c.env),
      userAgent: c.req.header("user-agent"),
      country: (c.req.raw as { cf?: { country?: string } }).cf?.country,
    }, body);
  });

  const result = await Effect.runPromise(Effect.either(program));
  const headers = corsHeaders(allowOrigin);
  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode, headers);
  }
  return c.json({ accepted: result.right.accepted, replayBytes: result.right.replayBytes }, 202, headers);
};
