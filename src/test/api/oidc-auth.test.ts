import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { OIDC_SESSION_COOKIE, OIDC_STATE_COOKIE } from "@/lib/oidc";
import type { Env } from "@/types";
import { createTestContext } from "../helpers";

const originalFetch = globalThis.fetch;

const oidcEnv: Partial<Env> = {
  UI_SESSION_SECRET: "session-secret",
  UI_ROLE_GROUPS: JSON.stringify({
    admin: { groups: ["platform-admins"] },
    viewer: { groups: ["engineering"] },
  }),
  OIDC_ISSUER: "https://idp.example",
  OIDC_CLIENT_ID: "pulsemon",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_AUTHORIZATION_ENDPOINT: "https://idp.example/authorize",
  OIDC_TOKEN_ENDPOINT: "https://idp.example/token",
  OIDC_USERINFO_ENDPOINT: "https://idp.example/userinfo",
};

function base64Url(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unsignedJwt(payload: Record<string, unknown>) {
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url(payload)}.`;
}

function cookiePair(setCookie: string | null, name: string) {
  const match = setCookie?.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

async function startLoginAndCompleteCallback(
  returnTo: string,
  tokenResponse: (nonce: string | null) => Response | Promise<Response>
) {
  const ctx = createTestContext({ env: oidcEnv });
  const login = await ctx.request(`/auth/login?return_to=${returnTo}`);
  const location = new URL(login.headers.get("Location") ?? "");
  const state = location.searchParams.get("state");
  const nonce = location.searchParams.get("nonce");

  globalThis.fetch = (async () => tokenResponse(nonce)) as unknown as typeof fetch;
  const callback = await ctx.request(`/auth/callback?code=code-redirect&state=${state}`, {
    headers: { Cookie: cookiePair(login.headers.get("Set-Cookie"), OIDC_STATE_COOKIE) },
  });

  return { callback, ctx };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OIDC UI auth", () => {
  it("redirects protected UI routes to OIDC login", async () => {
    const ctx = createTestContext({ env: oidcEnv });

    const res = await ctx.request("/monitors");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login?return_to=%2Fmonitors");
  });

  it("creates a signed UI session from the OIDC callback", async () => {
    const ctx = createTestContext({ env: oidcEnv });

    const login = await ctx.request("/auth/login?return_to=/api/admin/auth/policy");
    expect(login.status).toBe(302);

    const location = new URL(login.headers.get("Location") ?? "");
    const state = location.searchParams.get("state");
    const nonce = location.searchParams.get("nonce");
    expect(location.origin).toBe("https://idp.example");
    expect(location.searchParams.get("client_id")).toBe("pulsemon");
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://idp.example/token");
      expect(init?.method).toBe("POST");
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("code-1");
      expect(body.get("client_secret")).toBe("client-secret");

      return Response.json({
        id_token: unsignedJwt({
          iss: "https://idp.example",
          aud: "pulsemon",
          exp: Math.floor(Date.now() / 1000) + 600,
          nonce,
          email: "ops@example.com",
          preferred_username: "ops@example.com",
          groups: ["platform-admins"],
        }),
      });
    }) as unknown as typeof fetch;

    const callback = await ctx.request(`/auth/callback?code=code-1&state=${state}`, {
      headers: { Cookie: cookiePair(login.headers.get("Set-Cookie"), OIDC_STATE_COOKIE) },
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/api/admin/auth/policy");

    const sessionCookie = cookiePair(callback.headers.get("Set-Cookie"), OIDC_SESSION_COOKIE);
    const policy = await ctx.request("/api/admin/auth/policy", {
      headers: { Cookie: sessionCookie },
    });

    expect(policy.status).toBe(200);
    const audit = ctx.sqlite
      .prepare("SELECT actor, actor_role, outcome FROM audit_events WHERE action = ?")
      .get("auth.oidc") as any;
    expect(audit).toEqual({
      actor: "ops@example.com",
      actor_role: "admin",
      outcome: "success",
    });
  });

  for (const testCase of [
    { name: "an encoded backslash network path", returnTo: "%2F%5Cevil.example", expected: "/" },
    { name: "a double-slash network path", returnTo: "%2F%2Fevil.example", expected: "/" },
    { name: "a safe relative path", returnTo: "%2Fmonitors%3Fstatus%3Derror", expected: "/monitors?status=error" },
  ]) {
    it(`redirects ${testCase.name} to a safe same-origin location after callback`, async () => {
      const result = await startLoginAndCompleteCallback(testCase.returnTo, (nonce) => Response.json({
        id_token: unsignedJwt({
          iss: "https://idp.example",
          aud: "pulsemon",
          exp: Math.floor(Date.now() / 1000) + 600,
          nonce,
          email: "ops@example.com",
          groups: ["platform-admins"],
        }),
      }));
      expect(result.callback.status).toBe(302);
      expect(result.callback.headers.get("Location")).toBe(testCase.expected);
    });
  }

  it("does not expose an OIDC provider error description", async () => {
    const providerDetail = "PROVIDER_SENTINEL: invalid_grant for ops@example.com";
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    const { callback, ctx } = await startLoginAndCompleteCallback("%2F", () => Response.json({
      error: "invalid_grant",
      error_description: providerDetail,
    }, { status: 400 }));
    const logged = errorLog.mock.calls.flat().join(" ");
    errorLog.mockRestore();

    expect(callback.status).toBe(502);
    const responseBody = await callback.text();
    expect(responseBody).toBe("OIDC authentication failed");
    expect(responseBody).not.toContain(providerDetail);
    expect(logged).toContain("provider_token_exchange_failed");
    expect(logged).not.toContain(providerDetail);

    const audit = ctx.sqlite
      .prepare("SELECT metadata FROM audit_events WHERE action = ? AND outcome = ?")
      .get("auth.oidc", "failed") as { metadata: string };
    expect(audit.metadata).not.toContain(providerDetail);
    expect(JSON.parse(audit.metadata)).toMatchObject({ reason: "provider_token_exchange_failed" });
  });

  it("rejects OIDC users that do not match a configured role", async () => {
    const ctx = createTestContext({ env: oidcEnv });
    const login = await ctx.request("/auth/login");
    const location = new URL(login.headers.get("Location") ?? "");
    const state = location.searchParams.get("state");
    const nonce = location.searchParams.get("nonce");

    globalThis.fetch = (async () => Response.json({
      id_token: unsignedJwt({
        iss: "https://idp.example",
        aud: "pulsemon",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce,
        email: "outsider@example.com",
        groups: ["contractors"],
      }),
    })) as unknown as typeof fetch;

    const callback = await ctx.request(`/auth/callback?code=code-2&state=${state}`, {
      headers: { Cookie: cookiePair(login.headers.get("Set-Cookie"), OIDC_STATE_COOKIE) },
    });

    expect(callback.status).toBe(403);
    const audit = ctx.sqlite
      .prepare("SELECT outcome, metadata FROM audit_events WHERE action = ?")
      .get("auth.oidc") as any;
    expect(audit.outcome).toBe("denied");
    expect(JSON.parse(audit.metadata).reason).toBe("role_mapping_failed");
  });
});
