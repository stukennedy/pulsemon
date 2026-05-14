import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { errorStatus } from "@/lib/effect/errors";
import {
  deleteMonitorDefinition,
  updateMonitorDefinition,
  type MonitorKind,
} from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

async function readJson(c: Context<{ Bindings: Env }>) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function monitorPatch(raw: any) {
  return {
    name: typeof raw?.name === "string" ? raw.name : undefined,
    kind: typeof raw?.kind === "string" ? raw.kind as MonitorKind : undefined,
    metric_name: raw?.metric_name === null || typeof raw?.metric_name === "string" ? raw.metric_name : undefined,
    service: raw?.service === null || typeof raw?.service === "string" ? raw.service : undefined,
    threshold: raw?.threshold === undefined ? undefined : Number(raw.threshold),
    window_minutes: raw?.window_minutes === undefined ? undefined : Number(raw.window_minutes),
    description: typeof raw?.description === "string" ? raw.description : undefined,
    enabled: raw?.enabled === undefined ? undefined : Boolean(raw.enabled),
  };
}

export const onRequestPatch = async (c: Context<{ Bindings: Env }>) => {
  const principal = await requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const result = await Effect.runPromise(Effect.either(
    updateMonitorDefinition(
      c.env.DB,
      tenantScopeFromEnv(c.env),
      c.req.param("id"),
      monitorPatch(await readJson(c))
    )
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ monitor: result.right });
};

export const onRequestDelete = async (c: Context<{ Bindings: Env }>) => {
  const principal = await requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const result = await Effect.runPromise(Effect.either(
    deleteMonitorDefinition(c.env.DB, tenantScopeFromEnv(c.env), c.req.param("id"))
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json(result.right);
};
