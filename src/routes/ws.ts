import type { Context } from "hono";
import type { Env } from "@/types";
import { tenantKey, tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }
  const view = c.req.query("view") || "connections";
  const tenant = tenantScopeFromEnv(c.env);
  const id = c.env.SEARCH_SESSION.idFromName(
    `${tenantKey(tenant)}:${c.req.header("CF-Connecting-IP") || "anonymous"}:${view}`
  );
  const stub = c.env.SEARCH_SESSION.get(id);
  return stub.fetch(
    new Request(new URL(`/ws?view=${view}`, c.req.url), { headers: c.req.raw.headers })
  );
};
