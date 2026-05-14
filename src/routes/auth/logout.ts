import type { Context } from "hono";
import type { Env } from "@/types";
import { oidcLogoutResponse } from "@/lib/oidc";

export const onRequestPost = (c: Context<{ Bindings: Env }>) => oidcLogoutResponse(c);
