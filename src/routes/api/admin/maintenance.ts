import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { uiPrincipalFromRequest } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/effect/audit";
import { errorStatus } from "@/lib/effect/errors";
import { runMaintenanceFromEnv } from "@/lib/effect/maintenance";
import { tenantScopeFromEnv } from "@/lib/tenant";

type MaintenanceAuthResult =
  | { ok: true; actor: string; role: string }
  | { ok: false; response: Response; actor: string; role: string; outcome: "denied" | "misconfigured" };

function bearerToken(c: Context<{ Bindings: Env }>) {
  const auth = c.req.header("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function maintenanceAuth(c: Context<{ Bindings: Env }>): MaintenanceAuthResult {
  const expected = c.env.MAINTENANCE_API_KEY;
  const token = bearerToken(c);
  if (expected && token === expected) {
    return { ok: true, actor: "maintenance-token", role: "system" };
  }

  const principal = uiPrincipalFromRequest(c);
  if (principal?.role === "admin") {
    return { ok: true, actor: principal.username, role: principal.role };
  }
  if (principal) {
    return {
      ok: false,
      response: c.json({ error: "Forbidden" }, 403),
      actor: principal.username,
      role: principal.role,
      outcome: "denied",
    };
  }

  if (!expected) {
    return {
      ok: false,
      response: c.json({ error: "Maintenance API not configured" }, 503),
      actor: "anonymous",
      role: "none",
      outcome: "misconfigured",
    };
  }

  return {
    ok: false,
    response: c.json({ error: "Unauthorized" }, 401),
    actor: "anonymous",
    role: "none",
    outcome: "denied",
  };
}

function auditMetadata(c: Context<{ Bindings: Env }>) {
  return {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  };
}

function auditMaintenance(
  c: Context<{ Bindings: Env }>,
  actor: string,
  role: string,
  outcome: string,
  metadata?: unknown
) {
  const tenant = tenantScopeFromEnv(c.env);
  return recordAuditEvent(c.env.DB, tenant, {
    actor,
    actor_role: role,
    action: "maintenance.run",
    outcome,
    target: "maintenance",
    ip: c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? undefined,
    user_agent: c.req.header("User-Agent") ?? undefined,
    metadata: metadata ?? auditMetadata(c),
  }).pipe(Effect.catchAll(() => Effect.void));
}

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const auth = maintenanceAuth(c);
  if (!auth.ok) {
    await Effect.runPromise(auditMaintenance(c, auth.actor, auth.role, auth.outcome));
    return auth.response;
  }

  const result = await Effect.runPromise(Effect.either(runMaintenanceFromEnv(c.env)));
  if (Either.isLeft(result)) {
    const error = result.left;
    await Effect.runPromise(auditMaintenance(c, auth.actor, auth.role, "failed", {
      ...auditMetadata(c),
      error: error.message,
    }));
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  await Effect.runPromise(auditMaintenance(c, auth.actor, auth.role, "success", {
    ...auditMetadata(c),
    result: result.right,
  }));
  return c.json(result.right);
};
