import { describe, expect, it } from "bun:test";
import { authPolicyFromEnv, principalFromOidcClaims } from "@/lib/auth-policy";

describe("auth policy", () => {
  it("maps OIDC emails and groups to UI roles", () => {
    const policy = authPolicyFromEnv({
      OIDC_ISSUER: "https://idp.example",
      OIDC_CLIENT_ID: "pulsemon",
      OIDC_AUTHORIZATION_ENDPOINT: "https://idp.example/authorize",
      OIDC_TOKEN_ENDPOINT: "https://idp.example/token",
      UI_ROLE_GROUPS: JSON.stringify({
        admin: { groups: ["platform-admins"] },
        viewer: { emails: ["viewer@example.com"], groups: ["engineering"] },
      }),
    });

    expect(policy.oidc.configured).toBe(true);
    expect(principalFromOidcClaims(policy, {
      email: "ops@example.com",
      groups: ["platform-admins"],
    })).toEqual({ username: "ops@example.com", role: "admin" });
    expect(principalFromOidcClaims(policy, {
      email: "viewer@example.com",
      groups: [],
    })).toEqual({ username: "viewer@example.com", role: "viewer" });
    expect(principalFromOidcClaims(policy, {
      email: "unknown@example.com",
      groups: ["other"],
    })).toBeNull();
  });
});
