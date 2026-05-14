import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers";

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

describe("GET /api/admin/auth/policy", () => {
  it("returns sanitized auth policy for admins", async () => {
    const ctx = createTestContext({
      env: {
        UI_USERS: JSON.stringify({
          admin: { password: "secret", role: "admin" },
        }),
        OIDC_ISSUER: "https://idp.example",
        OIDC_CLIENT_ID: "pulsemon",
        OIDC_AUTHORIZATION_ENDPOINT: "https://idp.example/authorize",
        OIDC_TOKEN_ENDPOINT: "https://idp.example/token",
        UI_ROLE_GROUPS: JSON.stringify({
          admin: { groups: ["platform-admins"] },
          viewer: { groups: ["engineering"] },
        }),
      },
    });

    const res = await ctx.request("/api/admin/auth/policy", {
      headers: { Authorization: basic("admin", "secret") },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.policy.oidc).toMatchObject({
      issuer: "https://idp.example",
      client_id: "pulsemon",
      configured: true,
    });
    expect(body.policy.roles.admin.groups).toEqual(["platform-admins"]);
  });
});
