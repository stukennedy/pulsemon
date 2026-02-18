import type { Context } from "hono";
import type { ActiveTag, Env } from "@/types";
import { queryConnections } from "@/lib/facets";
import { ConnectionTable } from "@/components/ConnectionTable";

function parseTags(s: string): ActiveTag[] {
  if (!s) return [];
  return s.split("|").map((t) => {
    const i = t.indexOf(":");
    return i < 0 ? null : { facet: t.slice(0, i), value: t.slice(i + 1) };
  }).filter(Boolean) as ActiveTag[];
}

export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const tags = parseTags(c.req.query("tags") || "");
  const { connections, total } = await queryConnections(c.env.DB, tags);
  return c.html(<ConnectionTable connections={connections} total={total} />);
};
