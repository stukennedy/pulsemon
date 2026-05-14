import type { Env, TenantScope } from "@/types";

export const DEFAULT_TENANT_SCOPE: TenantScope = {
  workspace_id: "default",
  project_id: "default",
};

function configured(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function tenantScopeFromEnv(env: Pick<Env, "DEFAULT_WORKSPACE_ID" | "DEFAULT_PROJECT_ID">): TenantScope {
  return {
    workspace_id: configured(env.DEFAULT_WORKSPACE_ID, DEFAULT_TENANT_SCOPE.workspace_id),
    project_id: configured(env.DEFAULT_PROJECT_ID, DEFAULT_TENANT_SCOPE.project_id),
  };
}

export function tenantKey(scope: TenantScope) {
  return `${scope.workspace_id}:${scope.project_id}`;
}
