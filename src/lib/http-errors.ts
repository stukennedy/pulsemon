import type { Context } from "hono";
import type { Env } from "@/types";

export function unexpectedErrorResponse(
  _error: Error,
  c: Context<{ Bindings: Env }>
): Response {
  console.error(JSON.stringify({
    event: "pulsemon.unexpected_request_error",
    error_type: "Error",
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: 500,
  }));
  return c.json({ error: "Internal server error" }, 500);
}
