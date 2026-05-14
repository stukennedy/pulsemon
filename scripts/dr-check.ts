interface EndpointConfig {
  readonly name: string;
  readonly url: string;
  readonly key: string;
  readonly basicAuth?: string;
}

interface CheckResult {
  readonly name: string;
  readonly url: string;
  readonly ingest: {
    readonly status: number;
    readonly ok: boolean;
    readonly body?: unknown;
  };
  readonly readback: {
    readonly status: number;
    readonly ok: boolean;
    readonly points: number;
    readonly sampleCount: number;
    readonly body?: unknown;
  };
  readonly api: {
    readonly status: number;
    readonly ok: boolean;
  };
}

const metricName = process.env.PULSEMON_DR_METRIC_NAME ?? "pulsemon.dr.readiness";

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name: string, fallback?: string) {
  return process.env[name] ?? fallback;
}

function normalizeUrl(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function endpointConfig(name: "primary" | "standby"): EndpointConfig {
  const prefix = `PULSEMON_DR_${name.toUpperCase()}`;
  const fallbackUrl = name === "primary" ? process.env.PULSEMON_URL : undefined;
  const fallbackKey = process.env.PULSEMON_KEY;
  const fallbackBasicAuth = process.env.PULSEMON_BASIC_AUTH;

  return {
    name,
    url: normalizeUrl(required(`${prefix}_URL`, fallbackUrl)),
    key: required(`${prefix}_KEY`, fallbackKey),
    basicAuth: optional(`${prefix}_BASIC_AUTH`, fallbackBasicAuth),
  };
}

function readHeaders(endpoint: EndpointConfig): HeadersInit {
  return endpoint.basicAuth
    ? { Authorization: `Basic ${btoa(endpoint.basicAuth)}` }
    : {};
}

async function ingest(endpoint: EndpointConfig, runId: string) {
  const body = {
    metrics: [{
      id: `${runId}-metric`,
      service: "pulsemon-dr",
      metric_name: metricName,
      metric_type: "gauge",
      timestamp: new Date().toISOString(),
      value: 1,
      tags: { run_id: runId, endpoint: endpoint.name },
    }],
    logs: [{
      id: `${runId}-log`,
      service: "pulsemon-dr",
      level: "info",
      message: `dr readiness ${runId}`,
      attributes: { run_id: runId, endpoint: endpoint.name },
    }],
  };

  const response = await fetch(`${endpoint.url}/api/ingest/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  return {
    status: response.status,
    ok: response.ok &&
      payload?.counts?.metrics === 1 &&
      payload?.counts?.logs === 1,
    body: response.ok ? undefined : payload,
  };
}

async function readback(endpoint: EndpointConfig, from: string, to: string) {
  const response = await fetch(
    `${endpoint.url}/api/metrics/timeseries?name=${encodeURIComponent(metricName)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: readHeaders(endpoint) }
  );
  const body = await response.json().catch(() => null) as any;
  const sampleCount = Array.isArray(body?.points)
    ? body.points.reduce((total: number, point: any) => total + Number(point.count ?? 0), 0)
    : 0;

  return {
    status: response.status,
    ok: response.ok && sampleCount > 0,
    points: Array.isArray(body?.points) ? body.points.length : 0,
    sampleCount,
    body: response.ok ? undefined : body,
  };
}

async function apiCheck(endpoint: EndpointConfig) {
  const response = await fetch(`${endpoint.url}/api/connections`, {
    headers: readHeaders(endpoint),
  });
  await response.text().catch(() => "");
  return {
    status: response.status,
    ok: response.ok,
  };
}

async function checkEndpoint(endpoint: EndpointConfig): Promise<CheckResult> {
  const runId = `dr-${endpoint.name}-${Date.now()}`;
  const from = new Date(Date.now() - 10_000).toISOString();
  const ingestResult = await ingest(endpoint, runId);
  const to = new Date(Date.now() + 10_000).toISOString();

  return {
    name: endpoint.name,
    url: endpoint.url,
    ingest: ingestResult,
    readback: await readback(endpoint, from, to),
    api: await apiCheck(endpoint),
  };
}

async function main() {
  const endpoints = [endpointConfig("primary"), endpointConfig("standby")];
  const results = await Promise.all(endpoints.map(checkEndpoint));
  const failed = results.filter((result) =>
    !result.ingest.ok ||
    !result.readback.ok ||
    !result.api.ok
  );

  console.log(JSON.stringify({
    metricName,
    pass: failed.length === 0,
    results,
  }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
