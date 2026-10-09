import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { createRawTelemetryBucketHarness, createTestContext } from "../helpers";
import { deviceClass, replayKey } from "@/lib/effect/browser";
import { scrollReach } from "@/lib/effect/browser-query";
import { runMaintenance } from "@/lib/effect/maintenance";

const ORIGIN = "https://app.example.com";
const KEYS = JSON.stringify({
  pk_test: { origins: [ORIGIN], workspace_id: "default", project_id: "default" },
  pk_any: { origins: ["*"] },
});
const T0 = Date.parse("2026-10-01T10:00:00.000Z");

function batch(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    sid: "sess_abcdef12",
    seq: 0,
    uid: "user-42",
    page: { url: `${ORIGIN}/checkout`, path: "/checkout", vw: 1440, vh: 900 },
    rrweb: [
      { type: 4, timestamp: T0, data: { href: `${ORIGIN}/checkout`, width: 1440, height: 900 } },
      { type: 2, timestamp: T0 + 5, data: { node: {}, initialOffset: { top: 0, left: 0 } } },
    ],
    events: [
      { t: T0, type: "pageview", path: "/checkout", vw: 1440, vh: 900, dh: 2400 },
      { t: T0 + 1000, type: "click", path: "/checkout", sel: "button#pay", x: 700, y: 1200, vw: 1440, vh: 900, dh: 2400 },
      { t: T0 + 1200, type: "rage_click", path: "/checkout", sel: "button#pay", x: 702, y: 1201, vw: 1440, vh: 900, dh: 2400 },
      { t: T0 + 3000, type: "dead_click", path: "/checkout", sel: "div.hero", x: 200, y: 300, vw: 1440, vh: 900, dh: 2400 },
      { t: T0 + 4000, type: "error", path: "/checkout", msg: "TypeError: x is undefined (mail bob@example.com)", src: "app.js:10:4" },
      { t: T0 + 5000, type: "custom", path: "/checkout", name: "coupon_applied", props: { code: "SAVE10", amount: 10 } },
      { t: T0 + 9000, type: "scroll", path: "/checkout", depth: 62.5, vw: 1440, dh: 2400 },
    ],
    ...overrides,
  };
}

function setup(env: Record<string, unknown> = {}) {
  const replay = createRawTelemetryBucketHarness();
  const ctx = createTestContext({ env: { BROWSER_INGEST_KEYS: KEYS, RAW_TELEMETRY: replay.bucket, ...env } as any });
  const send = (body: unknown, { key = "pk_test", origin = ORIGIN, query = "" } = {}) =>
    ctx.request(`/api/ingest/browser?key=${key}${query}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: origin },
      body: typeof body === "string" || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body),
    });
  return { ctx, replay, send };
}

describe("POST /api/ingest/browser", () => {
  it("is unavailable until browser keys are configured", async () => {
    const { send } = setup({ BROWSER_INGEST_KEYS: undefined });
    const res = await send(batch());
    expect(res.status).toBe(503);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects unknown keys and origins outside the key's allowlist", async () => {
    const { send } = setup();
    expect((await send(batch(), { key: "pk_nope" })).status).toBe(401);
    const wrongOrigin = await send(batch(), { origin: "https://evil.example" });
    expect(wrongOrigin.status).toBe(401);
    expect(wrongOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers CORS preflight only for an allowed origin", async () => {
    const { ctx } = setup();
    const allowed = await ctx.request("/api/ingest/browser?key=pk_test", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const denied = await ctx.request("/api/ingest/browser?key=pk_test", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("stores the replay chunk in R2 and indexes the session and events in D1", async () => {
    const { ctx, replay, send } = setup();
    const res = await send(batch());

    expect(res.status).toBe(202);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const body = await res.json() as { accepted: number; replayBytes: number };
    expect(body.accepted).toBe(7);
    expect(body.replayBytes).toBeGreaterThan(0);

    expect(replay.objects.map((object) => object.key)).toEqual([
      "browser-replay/workspace=default/project=default/session=sess_abcdef12/000000.json",
    ]);
    expect(JSON.parse(replay.objects[0]!.body)).toHaveLength(2);

    const session = ctx.sqlite.prepare("SELECT * FROM browser_sessions WHERE id = 'sess_abcdef12'").get() as any;
    expect(session).toMatchObject({
      user_id: "user-42",
      entry_path: "/checkout",
      exit_path: "/checkout",
      device: "desktop",
      page_views: 1,
      clicks: 3,
      rage_clicks: 1,
      dead_clicks: 1,
      errors: 1,
      replay_chunks: 1,
      duration_ms: 9000,
    });

    const error = ctx.sqlite.prepare("SELECT message, source FROM browser_events WHERE type = 'error'").get() as any;
    expect(error.message).toContain("[REDACTED_EMAIL]");
    expect(error.source).toBe("app.js:10:4");
    const custom = ctx.sqlite.prepare("SELECT name, props FROM browser_events WHERE type = 'custom'").get() as any;
    expect(custom.name).toBe("coupon_applied");
    expect(JSON.parse(custom.props)).toEqual({ code: "SAVE10", amount: 10 });
  });

  it("treats a retried sequence number as a no-op", async () => {
    const { ctx, send } = setup();
    expect((await send(batch())).status).toBe(202);
    const retry = await send(batch());
    expect(retry.status).toBe(202);
    expect((await retry.json() as any).accepted).toBe(0);

    const counts = ctx.sqlite.prepare("SELECT clicks, page_views FROM browser_sessions").get() as any;
    expect(counts).toEqual({ clicks: 3, page_views: 1 });
    expect((ctx.sqlite.prepare("SELECT count(*) AS n FROM browser_events").get() as any).n).toBe(7);
  });

  it("extends the session across batches and tracks the exit page", async () => {
    const { ctx, send } = setup();
    await send(batch());
    await send(batch({
      seq: 1,
      rrweb: undefined,
      page: { url: `${ORIGIN}/thanks`, path: "/thanks", vw: 1440, vh: 900 },
      events: [{ t: T0 + 60_000, type: "pageview", path: "/thanks", vw: 1440, vh: 900, dh: 900 }],
    }));

    const session = ctx.sqlite.prepare("SELECT * FROM browser_sessions").get() as any;
    expect(session.page_views).toBe(2);
    expect(session.exit_path).toBe("/thanks");
    expect(session.entry_path).toBe("/checkout");
    expect(session.duration_ms).toBe(60_000);
    expect(session.replay_chunks).toBe(1);
  });

  it("accepts gzip bodies flagged with enc=gzip", async () => {
    const { send } = setup();
    const gzipped = Bun.gzipSync(new TextEncoder().encode(JSON.stringify(batch())));
    const res = await send(gzipped, { query: "&enc=gzip" });
    expect(res.status).toBe(202);
  });

  it("allows any origin for a wildcard key", async () => {
    const { send } = setup();
    const res = await send(batch(), { key: "pk_any", origin: "http://localhost:5173" });
    expect(res.status).toBe(202);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("rejects malformed JSON, schema violations and oversized event lists", async () => {
    const { send } = setup();
    expect((await send("{nope")).status).toBe(400);
    expect((await send(batch({ sid: "bad id!" }))).status).toBe(422);
    const many = Array.from({ length: 501 }, (_, i) => ({ t: T0 + i, type: "pageview", path: "/", vw: 1, vh: 1, dh: 1 }));
    expect((await send(batch({ events: many }))).status).toBe(422);
  });

  it("refuses replay data when no bucket is bound", async () => {
    const { send } = setup({ RAW_TELEMETRY: undefined });
    expect((await send(batch())).status).toBe(503);
    expect((await send(batch({ rrweb: undefined }))).status).toBe(202);
  });
});

describe("replay and heatmap UI", () => {
  it("lists sessions, filters by frustration and path, and renders the detail page", async () => {
    const { ctx, send } = setup();
    await send(batch());
    await send(batch({ sid: "sess_calm0001", rrweb: undefined, events: [batch().events[0]] }));

    const list = await (await ctx.request("/replays")).text();
    expect(list).toContain("sess_abcdef1");
    expect(list).toContain("sess_calm000");

    const frustrated = await (await ctx.request("/replays?frustrated=1")).text();
    expect(frustrated).toContain("sess_abcdef1");
    expect(frustrated).not.toContain("sess_calm000");

    const byPath = await (await ctx.request("/replays?path=/nowhere")).text();
    expect(byPath).not.toContain("sess_abcdef1");

    const detail = await ctx.request("/replays/sess_abcdef12");
    expect(detail.status).toBe(200);
    const html = await detail.text();
    expect(html).toContain("replay-root");
    expect(html).toContain("rage click");
    expect((await ctx.request("/replays/sess_missing00")).status).toBe(404);
  });

  it("streams every stored chunk as one rrweb event array", async () => {
    const { ctx, send } = setup();
    await send(batch());
    await send(batch({ seq: 1, events: [], rrweb: [{ type: 3, timestamp: T0 + 2000, data: { source: 1 } }] }));

    const res = await ctx.request("/api/replays/sess_abcdef12/events");
    expect(res.status).toBe(200);
    const events = await res.json() as { timestamp: number }[];
    expect(events.map((event) => event.timestamp)).toEqual([T0, T0 + 5, T0 + 2000]);

    const empty = await ctx.request("/api/replays/sess_missing00/events");
    expect(await empty.json() as unknown[]).toEqual([]);
  });

  it("requires UI auth for replay data", async () => {
    const { ctx } = setup();
    const res = await ctx.app.request("/api/replays/sess_abcdef12/events");
    expect(res.status).toBe(401);
  });

  it("serves heatmap points and the scroll map for a page", async () => {
    const { ctx, send } = setup();
    await send(batch({ events: batch().events.map((event: any) => ({ ...event, t: Date.now() - 1000 })) }));

    const res = await ctx.request("/api/heatmaps?path=/checkout&device=desktop&type=click&days=7");
    const body = await res.json() as any;
    expect(body.points).toHaveLength(3);
    expect(body.points[0]).toMatchObject({ vw: 1440 });
    expect(body.scroll.views).toBe(1);
    expect(body.scroll.reach.find((r: any) => r.depth === 60).percent).toBe(100);
    expect(body.scroll.reach.find((r: any) => r.depth === 65).percent).toBe(0);

    const rage = await (await ctx.request("/api/heatmaps?path=/checkout&type=rage_click")).json() as any;
    expect(rage.points).toHaveLength(1);

    const page = await (await ctx.request("/heatmaps?path=/checkout")).text();
    expect(page).toContain("heatmap-root");
    expect(page).toContain("/api/replays/sess_abcdef12/events");
  });
});

describe("browser analytics helpers", () => {
  it("classifies devices by viewport width", () => {
    expect(deviceClass(375)).toBe("mobile");
    expect(deviceClass(800)).toBe("tablet");
    expect(deviceClass(1280)).toBe("desktop");
  });

  it("computes the share of views reaching each depth", () => {
    const reach = scrollReach([10, 50, 100, 100]);
    expect(reach.find((r) => r.depth === 0)?.percent).toBe(100);
    expect(reach.find((r) => r.depth === 50)?.percent).toBe(75);
    expect(reach.find((r) => r.depth === 100)?.percent).toBe(50);
  });

  it("expires old browser sessions, events and replay objects", async () => {
    const { ctx, replay, send } = setup();
    await send(batch());
    ctx.sqlite.exec("UPDATE browser_batches SET received_at = '2000-01-01T00:00:00.000Z'");
    ctx.sqlite.exec("UPDATE browser_sessions SET last_seen_at = '2000-01-01T00:00:00.000Z'");
    ctx.sqlite.exec("UPDATE browser_events SET timestamp = '2000-01-01T00:00:00.000Z'");

    const result = await Effect.runPromise(runMaintenance(ctx.d1, {
      retentionDays: 30,
      metricRollupAfterMinutes: 60,
      metricRollupRetentionDays: 90,
      deleteChunkSize: 500,
      deleteMaxChunksPerTable: 10,
    }, replay.bucket));

    expect(result.deleted).toMatchObject({ browser_events: 7, browser_sessions: 1, browser_batches: 1 });
    expect(replay.objects).toHaveLength(0);
    expect(replayKey({ workspace_id: "w", project_id: "p" }, "s", 3)).toBe("browser-replay/workspace=w/project=p/session=s/000003.json");
  });
});
