interface CapacityConfig {
  readonly url: string;
  readonly key: string;
  readonly basicAuth?: string;
  readonly service: string;
  readonly metricName: string;
  readonly requests: number;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly maxFailureRate: number;
  readonly maxP95Ms?: number;
  readonly minRequestsPerSecond?: number;
  readonly readback: boolean;
}

type BatchResult = Awaited<ReturnType<typeof sendBatch>>;

function integerEnvWithFallback(name: string, fallbackName: string, fallback: number) {
  const value = process.env[name] ?? process.env[fallbackName];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} or ${fallbackName} must be a positive integer`);
  }
  return parsed;
}

function numberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function optionalNumberEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function config(): CapacityConfig {
  const url = process.env.PULSEMON_URL ?? "http://localhost:8788";
  const key = process.env.PULSEMON_KEY;
  if (!key) throw new Error("PULSEMON_KEY is required");

  return {
    url: url.endsWith("/") ? url.slice(0, -1) : url,
    key,
    basicAuth: process.env.PULSEMON_BASIC_AUTH,
    service: process.env.PULSEMON_CAPACITY_SERVICE ?? "capacity-check",
    metricName: process.env.PULSEMON_CAPACITY_METRIC_NAME ?? "capacity.latency_ms",
    requests: integerEnvWithFallback("PULSEMON_CAPACITY_REQUESTS", "PULSEMON_LOAD_REQUESTS", 100),
    batchSize: integerEnvWithFallback("PULSEMON_CAPACITY_BATCH_SIZE", "PULSEMON_LOAD_BATCH_SIZE", 25),
    concurrency: integerEnvWithFallback("PULSEMON_CAPACITY_CONCURRENCY", "PULSEMON_LOAD_CONCURRENCY", 5),
    maxFailureRate: numberEnv("PULSEMON_CAPACITY_MAX_FAILURE_RATE", 0),
    maxP95Ms: optionalNumberEnv("PULSEMON_CAPACITY_MAX_P95_MS"),
    minRequestsPerSecond: optionalNumberEnv("PULSEMON_CAPACITY_MIN_RPS"),
    readback: booleanEnv("PULSEMON_CAPACITY_READBACK", true),
  };
}

function metric(runId: string, index: number, service: string, metricName: string) {
  return {
    id: `${runId}-metric-${index}`,
    service,
    metric_name: metricName,
    metric_type: "histogram",
    timestamp: new Date().toISOString(),
    value: 50 + (index % 250),
    tags: { source: "capacity-check", run_id: runId },
  };
}

function log(runId: string, index: number, service: string) {
  return {
    id: `${runId}-log-${index}`,
    service,
    level: index % 50 === 0 ? "warn" : "info",
    message: `capacity event ${index}`,
    attributes: { source: "capacity-check", run_id: runId },
  };
}

async function sendBatch(cfg: CapacityConfig, runId: string, index: number) {
  const start = performance.now();
  const body = {
    metrics: Array.from({ length: cfg.batchSize }, (_, offset) =>
      metric(runId, index * cfg.batchSize + offset, cfg.service, cfg.metricName)
    ),
    logs: Array.from({ length: cfg.batchSize }, (_, offset) =>
      log(runId, index * cfg.batchSize + offset, cfg.service)
    ),
  };

  const response = await fetch(`${cfg.url}/api/ingest/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const durationMs = performance.now() - start;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      durationMs,
      body: await response.text(),
    };
  }

  return {
    ok: true,
    status: response.status,
    durationMs,
    body: await response.json(),
  };
}

async function worker(
  cfg: CapacityConfig,
  runId: string,
  next: () => number | null,
  results: BatchResult[]
) {
  while (true) {
    const index = next();
    if (index === null) return;
    results[index] = await sendBatch(cfg, runId, index);
  }
}

function percentile(sorted: readonly number[], fraction: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function readHeaders(cfg: CapacityConfig): HeadersInit {
  return cfg.basicAuth
    ? { Authorization: `Basic ${btoa(cfg.basicAuth)}` }
    : {};
}

async function readback(cfg: CapacityConfig, from: string, to: string) {
  const response = await fetch(
    `${cfg.url}/api/metrics/timeseries?name=${encodeURIComponent(cfg.metricName)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: readHeaders(cfg) }
  );
  const body = await response.json().catch(() => null) as any;
  const sampleCount = Array.isArray(body?.points)
    ? body.points.reduce((total: number, point: any) => total + Number(point.count ?? 0), 0)
    : 0;

  return {
    ok: response.ok && sampleCount > 0,
    status: response.status,
    points: Array.isArray(body?.points) ? body.points.length : 0,
    sampleCount,
    body: response.ok ? undefined : body,
  };
}

function statusCounts(results: readonly BatchResult[]) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[String(result.status)] = (counts[String(result.status)] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const cfg = config();
  const runId = `capacity-${Date.now()}`;
  const from = new Date(Date.now() - 10_000).toISOString();
  let current = 0;
  const next = () => {
    if (current >= cfg.requests) return null;
    current += 1;
    return current - 1;
  };
  const results: BatchResult[] = [];
  const start = performance.now();

  await Promise.all(
    Array.from({ length: cfg.concurrency }, () => worker(cfg, runId, next, results))
  );

  const elapsedMs = performance.now() - start;
  const to = new Date(Date.now() + 10_000).toISOString();
  const failed = results.filter((result) => !result.ok);
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const requestsPerSecond = cfg.requests / (elapsedMs / 1000);
  const readbackResult = cfg.readback ? await readback(cfg, from, to) : null;

  const summary = {
    url: cfg.url,
    runId,
    requests: cfg.requests,
    batchSize: cfg.batchSize,
    records: cfg.requests * cfg.batchSize * 2,
    concurrency: cfg.concurrency,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Number(requestsPerSecond.toFixed(2)),
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    failures: failed.length,
    failureRate: Number((failed.length / cfg.requests).toFixed(4)),
    statusCounts: statusCounts(results),
    firstFailure: failed[0] ?? null,
    readback: readbackResult,
  };

  const failureReasons = [];
  if (summary.failureRate > cfg.maxFailureRate) {
    failureReasons.push(`failure rate ${summary.failureRate} exceeded ${cfg.maxFailureRate}`);
  }
  if (cfg.maxP95Ms !== undefined && summary.p95Ms > cfg.maxP95Ms) {
    failureReasons.push(`p95 ${summary.p95Ms}ms exceeded ${cfg.maxP95Ms}ms`);
  }
  if (cfg.minRequestsPerSecond !== undefined && summary.requestsPerSecond < cfg.minRequestsPerSecond) {
    failureReasons.push(`rps ${summary.requestsPerSecond} below ${cfg.minRequestsPerSecond}`);
  }
  if (cfg.readback && !readbackResult?.ok) {
    failureReasons.push("metric readback failed");
  }

  console.log(JSON.stringify({
    ...summary,
    gate: {
      pass: failureReasons.length === 0,
      failureReasons,
      thresholds: {
        maxFailureRate: cfg.maxFailureRate,
        maxP95Ms: cfg.maxP95Ms ?? null,
        minRequestsPerSecond: cfg.minRequestsPerSecond ?? null,
        readback: cfg.readback,
      },
    },
  }, null, 2));

  if (failureReasons.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
