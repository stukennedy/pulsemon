import type { Context } from "hono";
import type { Env } from "@/types";
import {
  isOidcAuthConfigured,
  oidcUnauthorizedResponse,
  principalFromOidcSession,
} from "./oidc";

export interface UiPrincipal {
  readonly username: string;
  readonly role: "admin" | "viewer";
}

/**
 * Validates the Bearer token on ingest endpoints.
 * Returns 401 if no INGEST_API_KEY is configured (misconfigured deploy)
 * or if the token doesn't match.
 */
export function checkApiKey(c: Context<{ Bindings: Env }>): Response | null {
  const expected = c.env.INGEST_API_KEY;
  if (!expected) {
    return c.json({ error: "Ingest API not configured" }, 503);
  }
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

function isUiAuthConfigured(c: Context<{ Bindings: Env }>) {
  return Boolean(c.env.UI_USERS || c.env.UI_BASIC_AUTH || isOidcAuthConfigured(c.env));
}

function basicCredentials(c: Context<{ Bindings: Env }>): { username: string; password: string } | null {
  const auth = c.req.header("Authorization") ?? "";
  const encoded = auth.startsWith("Basic ") ? auth.slice(6).trim() : "";
  if (!encoded) return null;

  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(":");
    if (separator <= 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function roleValue(value: unknown): "admin" | "viewer" {
  return value === "admin" ? "admin" : "viewer";
}

function principalFromUiUsers(
  raw: string | undefined,
  credentials: { username: string; password: string } | null
): UiPrincipal | null {
  if (!raw || !credentials) return null;

  try {
    const users = record(JSON.parse(raw));
    const entry = record(users?.[credentials.username]);
    if (entry) {
      const password = typeof entry.password === "string" ? entry.password : "";
      if (password === credentials.password) {
        return {
          username: credentials.username,
          role: roleValue(entry.role),
        };
      }
      return null;
    }

    const legacyPassword = users?.[credentials.username];
    if (typeof legacyPassword === "string" && legacyPassword === credentials.password) {
      return { username: credentials.username, role: "viewer" };
    }
  } catch {
    return null;
  }

  return null;
}

function principalFromLegacyBasicAuth(
  expected: string | undefined,
  credentials: { username: string; password: string } | null
): UiPrincipal | null {
  if (!expected || !credentials) return null;
  return `${credentials.username}:${credentials.password}` === expected
    ? { username: credentials.username, role: "admin" }
    : null;
}

export async function uiPrincipalFromRequest(c: Context<{ Bindings: Env }>): Promise<UiPrincipal | null> {
  const oidcPrincipal = await principalFromOidcSession(c);
  if (oidcPrincipal) return oidcPrincipal;

  const credentials = basicCredentials(c);
  return principalFromUiUsers(c.env.UI_USERS, credentials)
    ?? principalFromLegacyBasicAuth(c.env.UI_BASIC_AUTH, credentials);
}

export async function requireAdminUi(c: Context<{ Bindings: Env }>): Promise<UiPrincipal | Response> {
  if (!isUiAuthConfigured(c)) {
    return c.json({ error: "Admin UI auth not configured" }, 503);
  }

  const principal = await uiPrincipalFromRequest(c);
  if (!principal) {
    return oidcUnauthorizedResponse(c);
  }

  if (principal.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  return principal;
}

export async function checkUiAuth(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  if (!isUiAuthConfigured(c)) return null;

  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/ingest")) return null;
  if (path === "/api/admin/maintenance") return null;
  if (path.startsWith("/auth/")) return null;

  if (await uiPrincipalFromRequest(c)) return null;

  return oidcUnauthorizedResponse(c);
}
