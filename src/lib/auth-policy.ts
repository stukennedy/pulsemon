import type { Env } from "@/types";
import type { UiPrincipal } from "./auth";

export interface RoleMatcher {
  readonly emails: readonly string[];
  readonly groups: readonly string[];
}

export interface AuthPolicy {
  readonly oidc: {
    readonly issuer?: string;
    readonly clientId?: string;
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly userinfoEndpoint?: string;
    readonly configured: boolean;
  };
  readonly roles: {
    readonly admin: RoleMatcher;
    readonly viewer: RoleMatcher;
  };
}

export interface OidcClaims {
  readonly email?: unknown;
  readonly preferred_username?: unknown;
  readonly groups?: unknown;
  readonly roles?: unknown;
}

type AuthPolicyEnv = Pick<
  Env,
  | "UI_ROLE_GROUPS"
  | "OIDC_ISSUER"
  | "OIDC_CLIENT_ID"
  | "OIDC_AUTHORIZATION_ENDPOINT"
  | "OIDC_TOKEN_ENDPOINT"
  | "OIDC_USERINFO_ENDPOINT"
>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function matcher(value: unknown): RoleMatcher {
  const raw = record(value);
  return {
    emails: stringList(raw?.emails).map((email) => email.toLowerCase()),
    groups: stringList(raw?.groups),
  };
}

function rolePolicy(raw: string | undefined): AuthPolicy["roles"] {
  if (!raw) {
    return {
      admin: { emails: [], groups: [] },
      viewer: { emails: [], groups: [] },
    };
  }

  try {
    const parsed = record(JSON.parse(raw));
    return {
      admin: matcher(parsed?.admin),
      viewer: matcher(parsed?.viewer),
    };
  } catch {
    return {
      admin: { emails: [], groups: [] },
      viewer: { emails: [], groups: [] },
    };
  }
}

function envString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function authPolicyFromEnv(env: AuthPolicyEnv): AuthPolicy {
  const issuer = envString(env.OIDC_ISSUER);
  const clientId = envString(env.OIDC_CLIENT_ID);
  const authorizationEndpoint = envString(env.OIDC_AUTHORIZATION_ENDPOINT);
  const tokenEndpoint = envString(env.OIDC_TOKEN_ENDPOINT);
  const userinfoEndpoint = envString(env.OIDC_USERINFO_ENDPOINT);

  return {
    oidc: {
      issuer,
      clientId,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      configured: Boolean(issuer && clientId && authorizationEndpoint && tokenEndpoint),
    },
    roles: rolePolicy(env.UI_ROLE_GROUPS),
  };
}

function claimStrings(value: unknown): readonly string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value];
  return stringList(value);
}

function matches(matcher: RoleMatcher, email: string | undefined, groups: readonly string[]) {
  const normalizedEmail = email?.toLowerCase();
  if (normalizedEmail && matcher.emails.includes(normalizedEmail)) return true;
  return groups.some((group) => matcher.groups.includes(group));
}

export function principalFromOidcClaims(
  policy: AuthPolicy,
  claims: OidcClaims
): UiPrincipal | null {
  const email = typeof claims.email === "string" ? claims.email : undefined;
  const username = typeof claims.preferred_username === "string"
    ? claims.preferred_username
    : email;
  const groups = [...claimStrings(claims.groups), ...claimStrings(claims.roles)];

  if (!username) return null;

  if (matches(policy.roles.admin, email, groups)) {
    return { username, role: "admin" };
  }
  if (matches(policy.roles.viewer, email, groups)) {
    return { username, role: "viewer" };
  }

  return null;
}

export function publicAuthPolicy(policy: AuthPolicy) {
  return {
    oidc: {
      issuer: policy.oidc.issuer,
      client_id: policy.oidc.clientId,
      authorization_endpoint_configured: Boolean(policy.oidc.authorizationEndpoint),
      token_endpoint_configured: Boolean(policy.oidc.tokenEndpoint),
      userinfo_endpoint_configured: Boolean(policy.oidc.userinfoEndpoint),
      configured: policy.oidc.configured,
    },
    roles: policy.roles,
  };
}
