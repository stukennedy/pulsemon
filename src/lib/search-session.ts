import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import type { ActiveTag, Env } from "../types";
import {
  CONNECTION_FACET_NAMES, LOG_FACET_NAMES, SPAN_FACET_NAMES,
} from "./facets";
import {
  getConnectionFacetValues as getConnectionFacetValuesEffect,
  getLogFacetValues as getLogFacetValuesEffect,
  getSpanFacetValues as getSpanFacetValuesEffect,
  makeD1TelemetryQueryRepository,
  queryConnectionStats as queryConnectionStatsEffect,
  queryConnections as queryConnectionsEffect,
  queryLogs as queryLogsEffect,
  querySpans as querySpansEffect,
  type QueryDeps,
} from "./effect/query";
import type { QueryError } from "./effect/errors";
import { jsxToString } from "./render";
import { ConnectionTable } from "@/components/ConnectionTable";
import { LogTable } from "@/components/LogTable";
import { TraceList } from "@/components/TraceWaterfall";
import { TagBar } from "@/components/TagBar";
import { ConnectionStatsBar } from "@/components/StatsBar";
import { FacetList, ValueList, NoResults } from "@/components/Dropdown";

export class SearchSession extends DurableObject<Env> {
  private tags: ActiveTag[] = [];
  private view: string = "connections";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });

    this.view = url.searchParams.get("view") || "connections";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    if (this.view === "connections") {
      const deps = this.queryDeps();
      const [{ connections, total }, stats] = await Promise.all([
        this.runQuery(queryConnectionsEffect(deps, this.tags)),
        this.runQuery(queryConnectionStatsEffect(deps, this.tags)),
      ]);
      this.sendUi(server, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })));
      this.sendUi(server, "#stats-bar", "outerHTML", await jsxToString(ConnectionStatsBar({ stats })));
    } else if (this.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), this.tags));
      this.sendUi(server, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })));
    } else if (this.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), this.tags));
      this.sendUi(server, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }

    const values = msg.values || {};
    const action = (values.action || "").trim();
    const query = (values.query || "").trim();
    const tagsStr = values.tags || "";
    const activeTags = this.parseTags(tagsStr);

    if (action === "suggest") {
      await this.handleSuggest(ws, query, activeTags, msg.request_id);
    } else if (action === "add_tag") {
      activeTags.push({ facet: values.facet || "", value: values.value || "" });
      this.tags = activeTags;
      await this.refreshAll(ws, activeTags);
    } else if (action === "remove_tag") {
      const idx = parseInt(values.removeIdx || "0", 10);
      if (idx >= 0 && idx < activeTags.length) activeTags.splice(idx, 1);
      this.tags = activeTags;
      await this.refreshAll(ws, activeTags);
    } else if (action === "refresh") {
      this.tags = activeTags;
      await this.refreshTable(ws, activeTags);
    } else if (action === "set_tags") {
      this.tags = activeTags;
      await this.refreshAll(ws, activeTags);
    }
  }

  webSocketClose() {}
  webSocketError() {}

  private sendUi(ws: WebSocket, target: string, swap: string, payload: string) {
    ws.send(JSON.stringify({ channel: "ui", format: "html", target, swap, payload }));
  }

  private getFacetNames(): string[] {
    if (this.view === "traces") return SPAN_FACET_NAMES;
    if (this.view === "logs") return LOG_FACET_NAMES;
    return CONNECTION_FACET_NAMES;
  }

  private queryDeps(): QueryDeps {
    return { repository: makeD1TelemetryQueryRepository(this.env.DB) };
  }

  private runQuery<A>(program: Effect.Effect<A, QueryError>): Promise<A> {
    return Effect.runPromise(program);
  }

  private async getFacetValues(facet: string, prefix: string, tags: ActiveTag[]): Promise<string[]> {
    if (this.view === "traces") {
      return this.runQuery(getSpanFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
    }
    if (this.view === "logs") {
      return this.runQuery(getLogFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
    }
    return this.runQuery(getConnectionFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
  }

  private async handleSuggest(ws: WebSocket, query: string, activeTags: ActiveTag[], requestId?: string) {
    const facetNames = this.getFacetNames();
    let html: string;

    if (!query) {
      html = await jsxToString(FacetList({ facets: facetNames }));
    } else {
      const colonIdx = query.indexOf(":");
      if (colonIdx > 0) {
        const facet = query.slice(0, colonIdx).toLowerCase();
        const prefix = query.slice(colonIdx + 1);
        if (!facetNames.includes(facet)) {
          html = await jsxToString(NoResults({ message: `Unknown facet: ${facet}` }));
        } else {
          const values = await this.getFacetValues(facet, prefix, activeTags);
          html = values.length === 0
            ? await jsxToString(NoResults({ message: "No matching values" }))
            : await jsxToString(ValueList({ facet, values }));
        }
      } else {
        const matching = facetNames.filter((f) => f.includes(query.toLowerCase()));
        html = matching.length === 0
          ? await jsxToString(NoResults({ message: "No matching facets" }))
          : await jsxToString(FacetList({ facets: matching }));
      }
    }

    ws.send(JSON.stringify({
      channel: "ui", format: "html",
      target: "#dropdown", swap: "innerHTML",
      payload: html, request_id: requestId,
    }));
  }

  private async refreshTable(ws: WebSocket, tags: ActiveTag[]) {
    if (this.view === "connections") {
      const { connections, total } = await this.runQuery(queryConnectionsEffect(this.queryDeps(), tags));
      this.sendUi(ws, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })));
    } else if (this.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), tags));
      this.sendUi(ws, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })));
    } else if (this.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), tags));
      this.sendUi(ws, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })));
    }
  }

  private async refreshAll(ws: WebSocket, tags: ActiveTag[]) {
    const tagsStr = tags.map((t) => `${t.facet}:${t.value}`).join("|");

    if (this.view === "connections") {
      const deps = this.queryDeps();
      const [{ connections, total }, stats] = await Promise.all([
        this.runQuery(queryConnectionsEffect(deps, tags)),
        this.runQuery(queryConnectionStatsEffect(deps, tags)),
      ]);
      this.sendUi(ws, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })));
      this.sendUi(ws, "#stats-bar", "outerHTML", await jsxToString(ConnectionStatsBar({ stats })));
    } else if (this.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), tags));
      this.sendUi(ws, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })));
    } else if (this.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), tags));
      this.sendUi(ws, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })));
    }

    this.sendUi(ws, "#tag-bar", "outerHTML", await jsxToString(TagBar({ tags })));
    this.sendUi(ws, "#dropdown", "innerHTML", "");
    ws.send(JSON.stringify({ channel: "state", tags: tagsStr, clearInput: true }));
  }

  private parseTags(tagsStr: string): ActiveTag[] {
    if (!tagsStr) return [];
    return tagsStr.split("|").map((t) => {
      const idx = t.indexOf(":");
      return idx < 0 ? null : { facet: t.slice(0, idx), value: t.slice(idx + 1) };
    }).filter(Boolean) as ActiveTag[];
  }
}
