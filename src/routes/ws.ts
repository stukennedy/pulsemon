import type { Context } from "hono";
import type { Env, TenantScope } from "@/types";
import { tenantKey, tenantScopeFromEnv } from "@/lib/tenant";

const SEARCH_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

function browserSessionId(raw: string | undefined) {
  const value = raw?.trim();
  if (value && SEARCH_SESSION_ID_PATTERN.test(value)) return value;
  return `ephemeral-${crypto.randomUUID()}`;
}

function searchSessionObjectName(tenant: TenantScope, sessionId: string) {
  return `${tenantKey(tenant)}:search:${sessionId}`;
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  const view = c.req.query("view") || "connections";
  const tenant = tenantScopeFromEnv(c.env);
  const sessionId = browserSessionId(c.req.query("sid"));
  const id = c.env.SEARCH_SESSION.idFromName(searchSessionObjectName(tenant, sessionId));
  const stub = c.env.SEARCH_SESSION.get(id);

  const url = new URL("/ws", c.req.url);
  url.searchParams.set("view", view);
  return stub.fetch(new Request(url, { headers: c.req.raw.headers }));
};
