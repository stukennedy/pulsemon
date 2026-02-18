import type { Hono, Env } from "hono";
import { PulsemonLayout } from "./LogBrowserLayout";

export const loadLayouts = <T extends Env>(app: Hono<T>) => {
  app.use("/*", PulsemonLayout);
};
