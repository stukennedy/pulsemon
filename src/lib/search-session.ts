import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import type { ActiveTag, Env } from "../types";
import {
  CONNECTION_FACET_NAMES, LOG_FACET_NAMES, METRIC_FACET_NAMES, SPAN_FACET_NAMES,
} from "./facets";
import {
  getConnectionFacetValues as getConnectionFacetValuesEffect,
  getLogFacetValues as getLogFacetValuesEffect,
  getMetricFacetValues as getMetricFacetValuesEffect,
  getSpanFacetValues as getSpanFacetValuesEffect,
  makeD1TelemetryQueryRepository,
  queryConnectionStats as queryConnectionStatsEffect,
  queryConnections as queryConnectionsEffect,
  queryLogs as queryLogsEffect,
  queryMetricOverview as queryMetricOverviewEffect,
  querySpans as querySpansEffect,
  type QueryDeps,
} from "./effect/query";
import type { QueryError } from "./effect/errors";
import { jsxToString } from "./render";
import { tenantScopeFromEnv } from "./tenant";
import { ConnectionTable } from "@/components/ConnectionTable";
import { LogTable } from "@/components/LogTable";
import { MetricTable } from "@/components/MetricTable";
import { TraceList } from "@/components/TraceWaterfall";
import { TagBar } from "@/components/TagBar";
import { ConnectionStatsBar } from "@/components/StatsBar";
import { FacetList, ValueList, NoResults } from "@/components/Dropdown";

interface SearchSocketState {
  view: string;
  tags: ActiveTag[];
  fallbackSeq: number;
  dropdownSeq: number;
  resultsSeq: number;
}

interface WsPayload {
  request_id?: unknown;
  client_seq?: unknown;
  values?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export class SearchSession extends DurableObject<Env> {
  private socketState = new WeakMap<WebSocket, SearchSocketState>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });

    const state: SearchSocketState = {
      view: url.searchParams.get("view") || "connections",
      tags: [],
      fallbackSeq: 0,
      dropdownSeq: 0,
      resultsSeq: 0,
    };

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.socketState.set(server, state);

    if (state.view === "connections") {
      const deps = this.queryDeps();
      const [{ connections, total }, stats] = await Promise.all([
        this.runQuery(queryConnectionsEffect(deps, state.tags)),
        this.runQuery(queryConnectionStatsEffect(deps, state.tags)),
      ]);
      this.sendUi(server, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })));
      this.sendUi(server, "#stats-bar", "outerHTML", await jsxToString(ConnectionStatsBar({ stats })));
    } else if (state.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), state.tags));
      this.sendUi(server, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })));
    } else if (state.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), state.tags));
      this.sendUi(server, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })));
    } else if (state.view === "metrics") {
      const { metrics, summaries, total } = await this.runQuery(queryMetricOverviewEffect(this.queryDeps(), state.tags));
      this.sendUi(server, "#metric-table", "outerHTML", await jsxToString(MetricTable({ metrics, summaries, total })));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    const state = this.socketState.get(ws);
    if (!state) return;

    let msg: WsPayload;
    try {
      const parsed = JSON.parse(message) as unknown;
      if (!isRecord(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }

    const values = isRecord(msg.values) ? msg.values : {};
    const action = stringValue(values.action).trim();
    const query = stringValue(values.query).trim();
    const tagsStr = stringValue(values.tags);
    const activeTags = this.parseTags(tagsStr);
    const requestId = stringValue(msg.request_id) || undefined;
    const seq = this.requestSequence(state, msg.client_seq ?? values.client_seq);

    if (action === "suggest") {
      if (!this.beginDropdownRequest(state, seq)) return;
      await this.handleSuggest(ws, state, query, activeTags, requestId, seq);
    } else if (action === "add_tag") {
      activeTags.push({ facet: stringValue(values.facet), value: stringValue(values.value) });
      await this.refreshAll(ws, state, activeTags, requestId, seq);
    } else if (action === "remove_tag") {
      const idx = parseInt(stringValue(values.removeIdx) || "0", 10);
      if (idx >= 0 && idx < activeTags.length) activeTags.splice(idx, 1);
      await this.refreshAll(ws, state, activeTags, requestId, seq);
    } else if (action === "refresh") {
      await this.refreshTable(ws, state, activeTags, requestId, seq);
    } else if (action === "set_tags") {
      await this.refreshAll(ws, state, activeTags, requestId, seq);
    }
  }

  webSocketClose(ws: WebSocket) {
    this.socketState.delete(ws);
  }

  webSocketError(ws: WebSocket) {
    this.socketState.delete(ws);
  }

  private sendUi(ws: WebSocket, target: string, swap: string, payload: string, requestId?: string) {
    const message: Record<string, string> = { channel: "ui", format: "html", target, swap, payload };
    if (requestId) message.request_id = requestId;
    ws.send(JSON.stringify(message));
  }

  private getFacetNames(view: string): string[] {
    if (view === "traces") return SPAN_FACET_NAMES;
    if (view === "logs") return LOG_FACET_NAMES;
    if (view === "metrics") return METRIC_FACET_NAMES;
    return CONNECTION_FACET_NAMES;
  }

  private queryDeps(): QueryDeps {
    return { repository: makeD1TelemetryQueryRepository(this.env.DB, tenantScopeFromEnv(this.env)) };
  }

  private runQuery<A>(program: Effect.Effect<A, QueryError>): Promise<A> {
    return Effect.runPromise(program);
  }

  private requestSequence(state: SearchSocketState, raw: unknown): number {
    const seq = typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
    if (Number.isSafeInteger(seq) && seq > 0) {
      state.fallbackSeq = Math.max(state.fallbackSeq, seq);
      return seq;
    }

    state.fallbackSeq += 1;
    return state.fallbackSeq;
  }

  private beginDropdownRequest(state: SearchSocketState, seq: number) {
    if (seq < state.dropdownSeq) return false;
    state.dropdownSeq = seq;
    return true;
  }

  private beginResultsRequest(state: SearchSocketState, seq: number, clearsDropdown: boolean) {
    if (seq < state.resultsSeq) return false;
    state.resultsSeq = seq;
    if (clearsDropdown && seq > state.dropdownSeq) state.dropdownSeq = seq;
    return true;
  }

  private isCurrentDropdownRequest(state: SearchSocketState, seq: number) {
    return seq === state.dropdownSeq;
  }

  private isCurrentResultsRequest(state: SearchSocketState, seq: number) {
    return seq === state.resultsSeq;
  }

  private async getFacetValues(view: string, facet: string, prefix: string, tags: ActiveTag[]): Promise<string[]> {
    if (view === "traces") {
      return this.runQuery(getSpanFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
    }
    if (view === "logs") {
      return this.runQuery(getLogFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
    }
    if (view === "metrics") {
      return this.runQuery(getMetricFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
    }
    return this.runQuery(getConnectionFacetValuesEffect(this.queryDeps(), facet, prefix, tags));
  }

  private async handleSuggest(
    ws: WebSocket,
    state: SearchSocketState,
    query: string,
    activeTags: ActiveTag[],
    requestId: string | undefined,
    seq: number
  ) {
    const facetNames = this.getFacetNames(state.view);
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
          const values = await this.getFacetValues(state.view, facet, prefix, activeTags);
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

    if (!this.isCurrentDropdownRequest(state, seq)) return;
    this.sendUi(ws, "#dropdown", "innerHTML", html, requestId);
  }

  private async refreshTable(
    ws: WebSocket,
    state: SearchSocketState,
    tags: ActiveTag[],
    requestId: string | undefined,
    seq: number
  ) {
    if (!this.beginResultsRequest(state, seq, false)) return;
    state.tags = tags;

    if (state.view === "connections") {
      const { connections, total } = await this.runQuery(queryConnectionsEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })), requestId);
    } else if (state.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })), requestId);
    } else if (state.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })), requestId);
    } else if (state.view === "metrics") {
      const { metrics, summaries, total } = await this.runQuery(queryMetricOverviewEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#metric-table", "outerHTML", await jsxToString(MetricTable({ metrics, summaries, total })), requestId);
    }
  }

  private async refreshAll(
    ws: WebSocket,
    state: SearchSocketState,
    tags: ActiveTag[],
    requestId: string | undefined,
    seq: number
  ) {
    if (!this.beginResultsRequest(state, seq, true)) return;
    state.tags = tags;

    const tagsStr = tags.map((t) => `${t.facet}:${t.value}`).join("|");

    if (state.view === "connections") {
      const deps = this.queryDeps();
      const [{ connections, total }, stats] = await Promise.all([
        this.runQuery(queryConnectionsEffect(deps, tags)),
        this.runQuery(queryConnectionStatsEffect(deps, tags)),
      ]);
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#connection-table", "outerHTML", await jsxToString(ConnectionTable({ connections, total })), requestId);
      this.sendUi(ws, "#stats-bar", "outerHTML", await jsxToString(ConnectionStatsBar({ stats })));
    } else if (state.view === "traces") {
      const { spans, total } = await this.runQuery(querySpansEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#trace-table", "outerHTML", await jsxToString(TraceList({ spans, total })), requestId);
    } else if (state.view === "logs") {
      const { logs, total } = await this.runQuery(queryLogsEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#log-table", "outerHTML", await jsxToString(LogTable({ logs, total })), requestId);
    } else if (state.view === "metrics") {
      const { metrics, summaries, total } = await this.runQuery(queryMetricOverviewEffect(this.queryDeps(), tags));
      if (!this.isCurrentResultsRequest(state, seq)) return;
      this.sendUi(ws, "#metric-table", "outerHTML", await jsxToString(MetricTable({ metrics, summaries, total })), requestId);
    }

    if (!this.isCurrentResultsRequest(state, seq)) return;
    this.sendUi(ws, "#tag-bar", "outerHTML", await jsxToString(TagBar({ tags })));
    const clearInput = this.isCurrentDropdownRequest(state, seq);
    if (clearInput) this.sendUi(ws, "#dropdown", "innerHTML", "");
    ws.send(JSON.stringify({ channel: "state", tags: tagsStr, clearInput }));
  }

  private parseTags(tagsStr: string): ActiveTag[] {
    if (!tagsStr) return [];
    return tagsStr.split("|").map((t) => {
      const idx = t.indexOf(":");
      return idx < 0 ? null : { facet: t.slice(0, idx), value: t.slice(idx + 1) };
    }).filter(Boolean) as ActiveTag[];
  }
}
