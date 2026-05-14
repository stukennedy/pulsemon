interface SmokeResult {
  readonly name: string;
  readonly status: number;
  readonly ok: boolean;
}

const endpoint = process.env.PULSEMON_URL ?? "http://localhost:8788";
const apiKey = process.env.PULSEMON_KEY;
const basicAuth = process.env.PULSEMON_BASIC_AUTH;
const maintenanceKey = process.env.PULSEMON_MAINTENANCE_KEY;
const runMaintenance = process.env.PULSEMON_SMOKE_MAINTENANCE === "true";

if (!apiKey) {
  console.error("PULSEMON_KEY is required");
  process.exit(1);
}

const smokeId = `smoke-${Date.now()}`;
const metricName = "pulsemon.smoke.latency_ms";
const now = new Date();
const from = new Date(now.getTime() - 60_000).toISOString();
const to = new Date(now.getTime() + 60_000).toISOString();

function url(path: string) {
  return `${endpoint.replace(/\/$/, "")}${path}`;
}

function readHeaders(): HeadersInit {
  return basicAuth
    ? { Authorization: `Basic ${btoa(basicAuth)}` }
    : {};
}

async function checkJson(
  name: string,
  path: string,
  init: RequestInit,
  validate?: (body: any) => boolean
): Promise<SmokeResult> {
  const response = await fetch(url(path), init);
  const body = await response.json().catch(() => null);
  const ok = response.ok && (validate ? validate(body) : true);
  if (!ok) {
    console.error(`${name} failed`, { status: response.status, body });
  }
  return { name, status: response.status, ok };
}

async function checkText(name: string, path: string, init: RequestInit): Promise<SmokeResult> {
  const response = await fetch(url(path), init);
  const text = await response.text().catch(() => "");
  const ok = response.ok && text.length > 0;
  if (!ok) {
    console.error(`${name} failed`, { status: response.status, text: text.slice(0, 200) });
  }
  return { name, status: response.status, ok };
}

const ingestBody = {
  connections: [{
    id: `${smokeId}-conn`,
    service: "pulsemon-smoke",
    connection_type: "smoke",
    session_id: smokeId,
    metadata: { smoke_id: smokeId },
  }],
  spans: [{
    id: `${smokeId}-span`,
    trace_id: `${smokeId}-trace`,
    connection_id: `${smokeId}-conn`,
    service: "pulsemon-smoke",
    operation: "smoke.check",
    duration_ms: 42,
    attributes: { smoke_id: smokeId },
  }],
  logs: [{
    id: `${smokeId}-log`,
    service: "pulsemon-smoke",
    level: "info",
    message: `pulsemon smoke ${smokeId}`,
    trace_id: `${smokeId}-trace`,
    connection_id: `${smokeId}-conn`,
    attributes: { smoke_id: smokeId },
  }],
  metrics: [{
    id: `${smokeId}-metric`,
    service: "pulsemon-smoke",
    metric_name: metricName,
    metric_type: "gauge",
    timestamp: now.toISOString(),
    value: 42,
    tags: { smoke_id: smokeId },
  }],
};

const results: SmokeResult[] = [];

results.push(await checkJson(
  "ingest batch",
  "/api/ingest/batch",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ingestBody),
  },
  (body) => body?.counts?.connections === 1 &&
    body?.counts?.spans === 1 &&
    body?.counts?.logs === 1 &&
    body?.counts?.metrics === 1
));

results.push(await checkJson(
  "metric query",
  `/api/metrics/timeseries?name=${encodeURIComponent(metricName)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  { headers: readHeaders() },
  (body) => Array.isArray(body?.points) && body.points.some((point: any) => Number(point.count) >= 1)
));

results.push(await checkText(
  "connections page/api",
  "/api/connections",
  { headers: readHeaders() }
));

if (runMaintenance) {
  if (!maintenanceKey) {
    console.error("PULSEMON_MAINTENANCE_KEY is required when PULSEMON_SMOKE_MAINTENANCE=true");
    process.exit(1);
  }

  results.push(await checkJson(
    "maintenance",
    "/api/admin/maintenance",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${maintenanceKey}` },
    },
    (body) => Boolean(body?.deleted && body?.rollups)
  ));
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({
  endpoint,
  smoke_id: smokeId,
  results,
}, null, 2));

if (failed.length > 0) {
  process.exit(1);
}
