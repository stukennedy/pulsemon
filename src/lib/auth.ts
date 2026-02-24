import type { Context } from "hono";
import type { Env } from "@/types";

/**
 * Validates the Bearer token on ingest endpoints.
 * Returns 401 if no INGEST_API_KEY is configured (misconfigured deploy)
 * or if the token doesn't match.
 */
export function checkApiKey(c: Context<{ Bindings: Env }>): Response | null {
  const expected = c.env.INGEST_API_KEY;
  if (!expected) {
    return c.json({ error: "Ingest API not configured" }, 503);
  }
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}
