import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { MonitorTable } from "@/components/MonitorTable";
import { alertConfigFromEnv, processMonitorAlerts } from "@/lib/effect/alerts";
import { errorStatus } from "@/lib/effect/errors";
import {
  createMonitorDefinition,
  evaluateAndPersistRealtimeMonitors,
  listMonitorDefinitions,
  type MonitorKind,
} from "@/lib/effect/monitors";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tenant = tenantScopeFromEnv(c.env);
  const result = await Effect.runPromise(Effect.either(Effect.gen(function* () {
    const monitors = yield* evaluateAndPersistRealtimeMonitors(c.env.DB, tenant);
    const definitions = yield* listMonitorDefinitions(c.env.DB, tenant, { includeDisabled: true });
    yield* processMonitorAlerts(c.env.DB, tenant, monitors, alertConfigFromEnv(c.env));
    return { monitors, definitions };
  })));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/monitors" />
      <MonitorTable evaluations={result.right.monitors} definitions={result.right.definitions} />
    </main>
  );
};

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const principal = await requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const form = await c.req.formData();
  const result = await Effect.runPromise(Effect.either(
    createMonitorDefinition(c.env.DB, tenantScopeFromEnv(c.env), {
      name: String(form.get("name") ?? ""),
      kind: String(form.get("kind") ?? "metric_avg") as MonitorKind,
      metric_name: String(form.get("metric_name") ?? ""),
      service: String(form.get("service") ?? ""),
      threshold: Number(form.get("threshold")),
      window_minutes: Number(form.get("window_minutes")),
      description: String(form.get("description") ?? ""),
      enabled: true,
    })
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.redirect("/monitors", 303);
};
