import { Effect } from "effect";
import type { TenantScope } from "@/types";
import { MissingConfigError, UnauthorizedError } from "./errors";

export interface ApiKeyContext extends TenantScope {
  readonly scopes: readonly string[];
}

export interface ApiKeyDeps {
  readonly expectedApiKey?: string;
  readonly apiKeys?: string;
  readonly authorization: string;
  readonly requiredScope: string;
  readonly defaultTenant: TenantScope;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function tenantFromRecord(entry: Record<string, unknown> | null, fallback: TenantScope): TenantScope {
  return {
    workspace_id: stringValue(entry?.workspace_id) ?? stringValue(entry?.workspaceId) ?? fallback.workspace_id,
    project_id: stringValue(entry?.project_id) ?? stringValue(entry?.projectId) ?? fallback.project_id,
  };
}

function contextForToken(
  raw: string,
  token: string,
  fallback: TenantScope
): Effect.Effect<ApiKeyContext | null, MissingConfigError> {
  try {
    const parsed = record(JSON.parse(raw));
    if (!parsed) {
      return Effect.fail(new MissingConfigError({ message: "Ingest API keys misconfigured" }));
    }

    const entry = parsed[token];
    if (Array.isArray(entry)) {
      return Effect.succeed({
        ...fallback,
        scopes: entry.filter((scope): scope is string => typeof scope === "string"),
      });
    }

    const entryRecord = record(entry);
    const scopes = entryRecord?.scopes;
    if (Array.isArray(scopes)) {
      return Effect.succeed({
        ...tenantFromRecord(entryRecord, fallback),
        scopes: scopes.filter((scope): scope is string => typeof scope === "string"),
      });
    }

    return Effect.succeed(null);
  } catch {
    return Effect.fail(new MissingConfigError({ message: "Ingest API keys misconfigured" }));
  }
}

function hasScope(context: ApiKeyContext, requiredScope: string) {
  return context.scopes.includes("*") || context.scopes.includes(requiredScope);
}

export function authorizeIngest(
  deps: ApiKeyDeps
): Effect.Effect<ApiKeyContext, MissingConfigError | UnauthorizedError> {
  const expected = deps.expectedApiKey;
  const token = deps.authorization.startsWith("Bearer ")
    ? deps.authorization.slice(7).trim()
    : "";

  if (!token) {
    return Effect.fail(new UnauthorizedError({ message: "Unauthorized" }));
  }

  if (deps.apiKeys) {
    return Effect.gen(function* () {
      const context = yield* contextForToken(deps.apiKeys!, token, deps.defaultTenant);
      if (!context || !hasScope(context, deps.requiredScope)) {
        return yield* Effect.fail(new UnauthorizedError({ message: "Unauthorized" }));
      }
      return context;
    });
  }

  if (!expected) {
    return Effect.fail(new MissingConfigError({ message: "Ingest API not configured" }));
  }

  return token === expected
    ? Effect.succeed({ ...deps.defaultTenant, scopes: ["*"] })
    : Effect.fail(new UnauthorizedError({ message: "Unauthorized" }));
}
