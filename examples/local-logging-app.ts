/**
 * A tiny Bun HTTP app instrumented with the one Pulsemon client,
 * `pulsemon-client` (packages/client in this repo). Run the receiver
 * (`bun run dev`, :8788) and then:
 *
 *   bun run client:build && PULSEMON_KEY=local-dev-key bun run example:logs
 *   curl http://localhost:3001/checkout
 *
 * What it shows: records BUFFER (log / span / metric are synchronous), ONE
 * `flush()` per request sends everything in a single POST /api/ingest/batch,
 * and the client never throws — a dead receiver costs a console warning, not
 * a failed checkout. That is the shape a typical producer uses.
 */
import { createPulsemonClient } from "pulsemon-client";

const pulsemonUrl = process.env.PULSEMON_URL ?? "http://localhost:8788";
const pulsemonKey = process.env.PULSEMON_KEY ?? "local-dev-key";
const service = process.env.PULSEMON_SERVICE ?? "example-checkout-api";
const port = Number(process.env.EXAMPLE_PORT ?? 3001);

const pulsemon = createPulsemonClient(
  { PULSEMON_INGEST_URL: pulsemonUrl, PULSEMON_INGEST_KEY: pulsemonKey },
  { onError: (detail) => console.warn(`[pulsemon] batch rejected: ${JSON.stringify(detail)}`) },
);

const hex = (bytes: number) => crypto.randomUUID().replaceAll("-", "").slice(0, bytes * 2);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function instrument(request: Request, handler: () => Promise<Response>) {
  const url = new URL(request.url);
  const traceId = hex(16);
  const spanId = hex(8);
  const startedAt = Date.now();
  // Route PATTERN, never the resolved path — cardinality is the client's rule.
  const operation = `${request.method} ${url.pathname}`;
  const base = { request_id: hex(8), method: request.method, path: url.pathname };
  let status = 500;

  pulsemon.log({ level: "info", service, message: "request started", traceId, spanId, attributes: base });

  try {
    const response = await handler();
    status = response.status;
    return response;
  } catch (error) {
    // Stable classification only — the client scrubs content-shaped keys, and
    // a raw error message is content.
    pulsemon.log({ level: "error", service, message: "request failed", traceId, spanId, attributes: { ...base, error_class: error instanceof Error ? error.name : "Unknown" } });
    return Response.json({ error: "simulated failure", request_id: base.request_id }, { status });
  } finally {
    const durationMs = Date.now() - startedAt;
    pulsemon.log({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      service, message: "request completed", traceId, spanId,
      attributes: { ...base, status, duration_ms: durationMs },
    });
    pulsemon.span({
      id: spanId, traceId, service, operation,
      startedAt, endedAt: Date.now(), durationMs,
      status: status >= 500 ? "error" : "ok",
      statusMessage: status >= 500 ? "request_failed" : undefined,
      attributes: { ...base, status },
    });
    pulsemon.metric({
      service, metricName: "example.http.request.duration_ms", metricType: "histogram",
      value: durationMs, unit: "ms", tags: { method: request.method, path: url.pathname, status },
    });
    // One subrequest for the whole request's telemetry; never awaited by the caller.
    void pulsemon.flush();
  }
}

async function checkout() {
  await wait(35 + Math.floor(Math.random() * 80));
  return Response.json({ ok: true, order_id: `order_${Date.now()}`, message: "checkout telemetry sent to Pulsemon" });
}

async function home() {
  return Response.json({ service, pulsemon: pulsemonUrl, routes: ["/", "/checkout", "/error"] });
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    return instrument(request, async () => {
      if (url.pathname === "/checkout") return checkout();
      if (url.pathname === "/error") throw new Error("example downstream timeout");
      return home();
    });
  },
});

pulsemon.log({ level: "info", service, message: "example app started", attributes: { port, pulsemon_url: pulsemonUrl } });
await pulsemon.flush();

console.log(`Example app: http://localhost:${port}`);
console.log(`Pulsemon:    ${pulsemonUrl}  (client enabled: ${pulsemon.enabled})`);
console.log("Try:         curl http://localhost:%s/checkout", port);
