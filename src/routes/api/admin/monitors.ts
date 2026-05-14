import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { errorStatus } from "@/lib/effect/errors";
import {
  createMonitorDefinition,
  listMonitorDefinitions,
  type MonitorKind,
} from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

function monitorInput(raw: any) {
  return {
    id: typeof raw?.id === "string" ? raw.id : undefined,
    name: String(raw?.name ?? ""),
    kind: String(raw?.kind ?? "metric_avg") as MonitorKind,
    metric_name: typeof raw?.metric_name === "string" ? raw.metric_name : undefined,
    service: typeof raw?.service === "string" ? raw.service : undefined,
    threshold: Number(raw?.threshold),
    window_minutes: Number(raw?.window_minutes),
    description: typeof raw?.description === "string" ? raw.description : undefined,
    enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
  };
}

async function readJson(c: Context<{ Bindings: Env }>) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const principal = requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const result = await Effect.runPromise(Effect.either(
    listMonitorDefinitions(c.env.DB, tenantScopeFromEnv(c.env), { includeDisabled: true })
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ monitors: result.right });
};

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const principal = requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const body = await readJson(c);
  const result = await Effect.runPromise(Effect.either(
    createMonitorDefinition(c.env.DB, tenantScopeFromEnv(c.env), monitorInput(body))
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error) as ContentfulStatusCode);
  }

  return c.json({ monitor: result.right }, 201);
};
