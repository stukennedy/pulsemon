import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Effect, Either } from "effect";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { SloView } from "@/components/SloTable";
import { errorStatus } from "@/lib/effect/errors";
import { createSloDefinition, evaluateAndPersistSlos } from "@/lib/effect/slos";
import { tenantScopeFromEnv } from "@/lib/tenant";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(
    evaluateAndPersistSlos(c.env.DB, tenantScopeFromEnv(c.env))
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.render(
    <main class="min-h-screen px-5 py-6 max-w-7xl mx-auto">
      <Nav active="/slos" />
      <SloView definitions={result.right.definitions} evaluations={result.right.evaluations} />
    </main>
  );
};

export const onRequestPost = async (c: Context<{ Bindings: Env }>) => {
  const principal = await requireAdminUi(c);
  if (principal instanceof Response) return principal;

  const form = await c.req.formData();
  const result = await Effect.runPromise(Effect.either(
    createSloDefinition(c.env.DB, tenantScopeFromEnv(c.env), {
      name: String(form.get("name") ?? ""),
      metric_name: String(form.get("metric_name") ?? ""),
      service: String(form.get("service") ?? ""),
      objective_percent: Number(form.get("objective_percent")),
      threshold: Number(form.get("threshold")),
      window_minutes: Number(form.get("window_minutes")),
      enabled: true,
    })
  ));

  if (Either.isLeft(result)) {
    const error = result.left;
    return c.text(error.message, errorStatus(error) as ContentfulStatusCode);
  }

  return c.redirect("/slos", 303);
};
