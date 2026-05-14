import type { Context } from "hono";
import { Effect } from "effect";
import type { Env } from "@/types";
import type { UiPrincipal } from "./auth";
import { authPolicyFromEnv, principalFromOidcClaims, type OidcClaims } from "./auth-policy";
import { recordAuditEvent } from "./effect/audit";
import { tenantScopeFromEnv } from "./tenant";

export const OIDC_SESSION_COOKIE = "pulsemon_session";
export const OIDC_STATE_COOKIE = "pulsemon_oidc_state";

interface SignedSession {
  readonly username: string;
  readonly role: "admin" | "viewer";
  readonly exp: number;
}

interface SignedState {
  readonly state: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly exp: number;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly id_token?: unknown;
  readonly token_type?: unknown;
  readonly error?: unknown;
  readonly error_description?: unknown;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const defaultScope = "openid email profile groups";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function sessionSecret(env: Env) {
  return env.UI_SESSION_SECRET?.trim() || env.OIDC_CLIENT_SECRET?.trim() || undefined;
}

function sessionTtlSeconds(env: Env) {
  const configured = Number(env.UI_SESSION_TTL_SECONDS ?? 8 * 60 * 60);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 8 * 60 * 60;
}

function oidcScopes(env: Env) {
  return env.OIDC_SCOPES?.trim() || defaultScope;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeJson(value: unknown) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJson(value: string) {
  return JSON.parse(textDecoder.decode(base64UrlToBytes(value))) as unknown;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function signature(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(data)));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function signPayload(payload: unknown, secret: string) {
  const encoded = encodeJson(payload);
  const signed = await signature(encoded, secret);
  return `${encoded}.${bytesToBase64Url(signed)}`;
}

async function verifyPayload<T>(value: string | undefined, secret: string): Promise<T | null> {
  if (!value) return null;
  const [encoded, encodedSignature] = value.split(".");
  if (!encoded || !encodedSignature) return null;

  try {
    const expected = await signature(encoded, secret);
    const actual = base64UrlToBytes(encodedSignature);
    if (!equalBytes(expected, actual)) return null;
    return decodeJson(encoded) as T;
  } catch {
    return null;
  }
}

function cookieValue(c: Context<{ Bindings: Env }>, name: string) {
  const cookie = c.req.header("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=");
  }
  return undefined;
}

function cookieHeader(
  c: Context<{ Bindings: Env }>,
  name: string,
  value: string,
  maxAgeSeconds: number
) {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookieHeader(c: Context<{ Bindings: Env }>, name: string) {
  return cookieHeader(c, name, "", 0);
}

function redirectUri(c: Context<{ Bindings: Env }>) {
  const configured = c.env.OIDC_REDIRECT_URI?.trim();
  if (configured) return configured;
  const url = new URL(c.req.url);
  return `${url.origin}/auth/callback`;
}

function safeReturnTo(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function decodeJwtPayload(token: string): OidcClaims & Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("id_token is missing a payload");
  const claims = decodeJson(payload);
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new Error("id_token payload is not an object");
  }
  return claims as OidcClaims & Record<string, unknown>;
}

function claimStrings(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function validateClaims(
  env: Env,
  claims: OidcClaims & Record<string, unknown>,
  nonce: string
) {
  const policy = authPolicyFromEnv(env);
  const exp = typeof claims.exp === "number" ? claims.exp : Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= nowSeconds()) {
    throw new Error("id_token is expired");
  }
  if (claims.iss !== policy.oidc.issuer) {
    throw new Error("id_token issuer does not match OIDC_ISSUER");
  }
  const audience = claimStrings(claims.aud);
  if (!policy.oidc.clientId || !audience.includes(policy.oidc.clientId)) {
    throw new Error("id_token audience does not match OIDC_CLIENT_ID");
  }
  if (claims.nonce !== nonce) {
    throw new Error("id_token nonce does not match login state");
  }
}

async function tokenRequest(c: Context<{ Bindings: Env }>, code: string) {
  const policy = authPolicyFromEnv(c.env);
  if (!policy.oidc.tokenEndpoint || !policy.oidc.clientId) {
    throw new Error("OIDC token endpoint is not configured");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(c),
    client_id: policy.oidc.clientId,
  });
  if (c.env.OIDC_CLIENT_SECRET) body.set("client_secret", c.env.OIDC_CLIENT_SECRET);

  const response = await fetch(policy.oidc.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => null) as TokenResponse | null;
  if (!response.ok) {
    const message = typeof payload?.error_description === "string"
      ? payload.error_description
      : "OIDC token exchange failed";
    throw new Error(message);
  }
  if (!payload) throw new Error("OIDC token response was not JSON");
  if (typeof payload.error === "string") throw new Error(payload.error);
  return payload;
}

async function userInfoClaims(env: Env, accessToken: unknown) {
  const endpoint = env.OIDC_USERINFO_ENDPOINT?.trim();
  if (!endpoint || typeof accessToken !== "string") return null;

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("OIDC userinfo request failed");
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? body as OidcClaims & Record<string, unknown>
    : null;
}

function authFailure(message: string, status = 400) {
  return new Response(message, { status });
}

function auditAuth(
  c: Context<{ Bindings: Env }>,
  principal: UiPrincipal | null,
  outcome: string,
  metadata?: unknown
) {
  return recordAuditEvent(c.env.DB, tenantScopeFromEnv(c.env), {
    actor: principal?.username ?? "anonymous",
    actor_role: principal?.role ?? "none",
    action: "auth.oidc",
    outcome,
    target: "ui",
    ip: c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? undefined,
    user_agent: c.req.header("User-Agent") ?? undefined,
    metadata,
  }).pipe(Effect.catchAll(() => Effect.void));
}

export function isOidcAuthConfigured(env: Env) {
  const policy = authPolicyFromEnv(env);
  return policy.oidc.configured && Boolean(sessionSecret(env));
}

export async function principalFromOidcSession(
  c: Context<{ Bindings: Env }>
): Promise<UiPrincipal | null> {
  const secret = sessionSecret(c.env);
  if (!secret) return null;
  const payload = await verifyPayload<SignedSession>(cookieValue(c, OIDC_SESSION_COOKIE), secret);
  if (!payload || payload.exp <= nowSeconds()) return null;
  if (payload.role !== "admin" && payload.role !== "viewer") return null;
  if (!payload.username) return null;
  return { username: payload.username, role: payload.role };
}

export function oidcUnauthorizedResponse(c: Context<{ Bindings: Env }>) {
  const path = new URL(c.req.url).pathname;
  if (isOidcAuthConfigured(c.env) && !path.startsWith("/api/")) {
    const returnTo = encodeURIComponent(path === "/auth/logout" ? "/" : `${path}${new URL(c.req.url).search}`);
    return c.redirect(`/auth/login?return_to=${returnTo}`, 302);
  }

  if (isOidcAuthConfigured(c.env)) {
    return c.json({ error: "Unauthorized", login_url: "/auth/login" }, 401);
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="pulsemon"' },
  });
}

export async function oidcLoginResponse(c: Context<{ Bindings: Env }>) {
  const policy = authPolicyFromEnv(c.env);
  const secret = sessionSecret(c.env);
  if (!policy.oidc.configured || !secret || !policy.oidc.authorizationEndpoint || !policy.oidc.clientId) {
    return authFailure("OIDC login is not configured", 503);
  }

  const state: SignedState = {
    state: randomToken(),
    nonce: randomToken(),
    returnTo: safeReturnTo(c.req.query("return_to") ?? null),
    exp: nowSeconds() + 10 * 60,
  };
  const signedState = await signPayload(state, secret);

  const redirect = new URL(policy.oidc.authorizationEndpoint);
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("client_id", policy.oidc.clientId);
  redirect.searchParams.set("redirect_uri", redirectUri(c));
  redirect.searchParams.set("scope", oidcScopes(c.env));
  redirect.searchParams.set("state", state.state);
  redirect.searchParams.set("nonce", state.nonce);

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect.toString(),
      "Set-Cookie": cookieHeader(c, OIDC_STATE_COOKIE, signedState, 10 * 60),
    },
  });
}

export async function oidcCallbackResponse(c: Context<{ Bindings: Env }>) {
  const secret = sessionSecret(c.env);
  if (!isOidcAuthConfigured(c.env) || !secret) {
    return authFailure("OIDC login is not configured", 503);
  }

  const state = await verifyPayload<SignedState>(cookieValue(c, OIDC_STATE_COOKIE), secret);
  if (!state || state.exp <= nowSeconds()) {
    await Effect.runPromise(auditAuth(c, null, "failed", { reason: "invalid_state" }));
    return authFailure("OIDC state is missing or expired", 400);
  }

  const requestState = c.req.query("state");
  const code = c.req.query("code");
  if (!requestState || requestState !== state.state || !code) {
    await Effect.runPromise(auditAuth(c, null, "failed", { reason: "state_or_code_mismatch" }));
    return authFailure("OIDC callback state or code is invalid", 400);
  }

  try {
    const token = await tokenRequest(c, code);
    const idTokenClaims = typeof token.id_token === "string"
      ? decodeJwtPayload(token.id_token)
      : null;
    if (idTokenClaims) validateClaims(c.env, idTokenClaims, state.nonce);

    const userInfo = await userInfoClaims(c.env, token.access_token);
    const claims = { ...(idTokenClaims ?? {}), ...(userInfo ?? {}) } as OidcClaims;
    const principal = principalFromOidcClaims(authPolicyFromEnv(c.env), claims);
    if (!principal) {
      await Effect.runPromise(auditAuth(c, null, "denied", { reason: "role_mapping_failed" }));
      return authFailure("OIDC principal is not allowed by UI_ROLE_GROUPS", 403);
    }

    const session = await signPayload({
      username: principal.username,
      role: principal.role,
      exp: nowSeconds() + sessionTtlSeconds(c.env),
    } satisfies SignedSession, secret);
    await Effect.runPromise(auditAuth(c, principal, "success"));

    return new Response(null, {
      status: 302,
      headers: [
        ["Location", state.returnTo],
        ["Set-Cookie", cookieHeader(c, OIDC_SESSION_COOKIE, session, sessionTtlSeconds(c.env))],
        ["Set-Cookie", clearCookieHeader(c, OIDC_STATE_COOKIE)],
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OIDC callback failed";
    await Effect.runPromise(auditAuth(c, null, "failed", { reason: message }));
    return authFailure(message, 400);
  }
}

export async function oidcLogoutResponse(c: Context<{ Bindings: Env }>) {
  const principal = await principalFromOidcSession(c);
  if (principal) await Effect.runPromise(auditAuth(c, principal, "logout"));
  return new Response(null, {
    status: 302,
    headers: [
      ["Location", "/"],
      ["Set-Cookie", clearCookieHeader(c, OIDC_SESSION_COOKIE)],
      ["Set-Cookie", clearCookieHeader(c, OIDC_STATE_COOKIE)],
    ],
  });
}
