import {
  createTraceContext,
  type LogInput,
  type SpanInput,
  PulsemonClient,
  PulsemonError,
} from "../src/sdk";

const pulsemonUrl = process.env.PULSEMON_URL ?? "http://localhost:8788";
const pulsemonKey = process.env.PULSEMON_KEY ?? "local-dev-key";
const service = process.env.PULSEMON_SERVICE ?? "example-checkout-api";
const port = Number(process.env.EXAMPLE_PORT ?? 3001);

const pulsemon = new PulsemonClient({
  endpoint: pulsemonUrl,
  apiKey: pulsemonKey,
  service,
  retries: 0,
  defaultAttributes: {
    environment: "local",
    example: "local-logging-app",
  },
});

function nowIso() {
  return new Date().toISOString();
}

function requestId() {
  return crypto.randomUUID();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelemetry(label: string, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (error) {
    const detail = error instanceof PulsemonError
      ? `${error.message}${error.status ? ` (${error.status})` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
    console.warn(`[pulsemon] ${label} failed: ${detail}`);
  }
}

async function log(input: LogInput) {
  await sendTelemetry("log", () => pulsemon.log(input));
}

async function span(input: SpanInput) {
  await sendTelemetry("span", () => pulsemon.span(input));
}

async function metric(metricName: string, value: number, tags: Record<string, unknown>) {
  await sendTelemetry("metric", () => pulsemon.metric({
    metric_name: metricName,
    metric_type: "histogram",
    value,
    unit: "ms",
    tags,
  }));
}

async function instrument(request: Request, handler: () => Promise<Response>) {
  const url = new URL(request.url);
  const id = requestId();
  const trace = createTraceContext();
  const startedAt = nowIso();
  const started = performance.now();
  let status = 500;

  await log({
    level: "info",
    message: "request started",
    trace_id: trace.traceId,
    span_id: trace.spanId,
    attributes: {
      request_id: id,
      method: request.method,
      path: url.pathname,
    },
  });

  try {
    const response = await handler();
    status = response.status;
    return response;
  } catch (error) {
    await log({
      level: "error",
      message: "request failed",
      trace_id: trace.traceId,
      span_id: trace.spanId,
      attributes: {
        request_id: id,
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    status = 500;
    return Response.json({ error: "simulated failure", request_id: id }, { status });
  } finally {
    const durationMs = Math.round(performance.now() - started);
    const attributes = {
      request_id: id,
      method: request.method,
      path: url.pathname,
      status,
    };

    await Promise.all([
      log({
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        message: "request completed",
        trace_id: trace.traceId,
        span_id: trace.spanId,
        attributes: { ...attributes, duration_ms: durationMs },
      }),
      span({
        id: trace.spanId,
        trace_id: trace.traceId,
        operation: `http.${request.method.toLowerCase()} ${url.pathname}`,
        started_at: startedAt,
        ended_at: nowIso(),
        duration_ms: durationMs,
        status: status >= 500 ? "error" : "ok",
        status_message: status >= 500 ? "request failed" : undefined,
        attributes,
      }),
      metric("example.http.request.duration_ms", durationMs, {
        method: request.method,
        path: url.pathname,
        status,
      }),
    ]);
  }
}

async function checkout() {
  await wait(35 + Math.floor(Math.random() * 80));
  return Response.json({
    ok: true,
    order_id: `order_${Date.now()}`,
    message: "checkout telemetry sent to Pulsemon",
  });
}

async function home() {
  return Response.json({
    service,
    pulsemon: pulsemonUrl,
    routes: ["/", "/checkout", "/error"],
  });
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

await log({
  level: "info",
  message: "example app started",
  attributes: {
    port,
    pulsemon_url: pulsemonUrl,
  },
});

console.log(`Example app: http://localhost:${port}`);
console.log(`Pulsemon:    ${pulsemonUrl}`);
console.log("Try:         curl http://localhost:%s/checkout", port);
