import type { Context } from "hono";
import type { Env } from "@/types";
import { oidcCallbackResponse } from "@/lib/oidc";

export const onRequestGet = (c: Context<{ Bindings: Env }>) => oidcCallbackResponse(c);
