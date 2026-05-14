import type { Context } from "hono";
import type { Env } from "@/types";
import { requireAdminUi } from "@/lib/auth";
import { authPolicyFromEnv, publicAuthPolicy } from "@/lib/auth-policy";

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const principal = await requireAdminUi(c);
  if (principal instanceof Response) return principal;

  return c.json({ policy: publicAuthPolicy(authPolicyFromEnv(c.env)) });
};
