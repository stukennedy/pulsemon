interface LoadConfig {
  url: string;
  key: string;
  service: string;
  requests: number;
  batchSize: number;
  concurrency: number;
}

function integerEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function config(): LoadConfig {
  const url = process.env.PULSEMON_URL ?? "http://localhost:8788";
  const key = process.env.PULSEMON_KEY;
  if (!key) throw new Error("PULSEMON_KEY is required");

  return {
    url: url.endsWith("/") ? url.slice(0, -1) : url,
    key,
    service: process.env.PULSEMON_SERVICE ?? "load-test",
    requests: integerEnv("PULSEMON_LOAD_REQUESTS", 100),
    batchSize: integerEnv("PULSEMON_LOAD_BATCH_SIZE", 25),
    concurrency: integerEnv("PULSEMON_LOAD_CONCURRENCY", 5),
  };
}

function metric(index: number, service: string) {
  return {
    service,
    metric_name: "load.latency_ms",
    metric_type: "histogram",
    value: 50 + (index % 250),
    tags: { source: "load-ingest" },
  };
}

function log(index: number, service: string) {
  return {
    service,
    level: index % 50 === 0 ? "warn" : "info",
    message: `load event ${index}`,
    attributes: { source: "load-ingest" },
  };
}

async function sendBatch(cfg: LoadConfig, index: number) {
  const start = performance.now();
  const body = {
    metrics: Array.from({ length: cfg.batchSize }, (_, offset) => metric(index * cfg.batchSize + offset, cfg.service)),
    logs: Array.from({ length: cfg.batchSize }, (_, offset) => log(index * cfg.batchSize + offset, cfg.service)),
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

async function worker(cfg: LoadConfig, next: () => number | null, results: Awaited<ReturnType<typeof sendBatch>>[]) {
  while (true) {
    const index = next();
    if (index === null) return;
    results[index] = await sendBatch(cfg, index);
  }
}

async function main() {
  const cfg = config();
  let current = 0;
  const next = () => {
    if (current >= cfg.requests) return null;
    current += 1;
    return current - 1;
  };
  const results: Awaited<ReturnType<typeof sendBatch>>[] = [];
  const start = performance.now();

  await Promise.all(Array.from({ length: cfg.concurrency }, () => worker(cfg, next, results)));

  const elapsedMs = performance.now() - start;
  const failed = results.filter((result) => !result.ok);
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;

  console.log(JSON.stringify({
    url: cfg.url,
    requests: cfg.requests,
    batchSize: cfg.batchSize,
    records: cfg.requests * cfg.batchSize * 2,
    concurrency: cfg.concurrency,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Number((cfg.requests / (elapsedMs / 1000)).toFixed(2)),
    p95Ms: Math.round(p95),
    failures: failed.length,
    firstFailure: failed[0] ?? null,
  }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
