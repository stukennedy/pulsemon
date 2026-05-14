import type { Context } from "hono";
import type { Env } from "@/types";
import { oidcLoginResponse } from "@/lib/oidc";

export const onRequestGet = (c: Context<{ Bindings: Env }>) => oidcLoginResponse(c);
