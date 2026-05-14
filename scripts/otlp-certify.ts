import {
  otlpJsonHistogramMetricRequest,
  otlpJsonLogRequest,
  otlpJsonMetricRequest,
  otlpJsonSummaryMetricRequest,
  otlpJsonTraceRequest,
  otlpProtobufHistogramMetricRequest,
  otlpProtobufLogRequest,
  otlpProtobufMetricRequest,
  otlpProtobufSummaryMetricRequest,
  otlpProtobufTraceRequest,
} from "../src/test/fixtures/otlp";

interface FixtureCase {
  readonly name: string;
  readonly path: string;
  readonly contentType: string;
  readonly encoding?: string;
  readonly body: BodyInit;
  readonly expect: Record<string, number>;
}

const endpoint = (process.env.PULSEMON_URL ?? "http://localhost:8788").replace(/\/$/, "");
const apiKey = process.env.PULSEMON_KEY;

if (!apiKey) {
  console.error("PULSEMON_KEY is required");
  process.exit(1);
}

function jsonBody(value: unknown) {
  return JSON.stringify(value);
}

function gzipJsonBody(value: unknown) {
  return Bun.gzipSync(Buffer.from(JSON.stringify(value)));
}

const cases: FixtureCase[] = [
  {
    name: "json traces",
    path: "/api/ingest/otlp/v1/traces",
    contentType: "application/json",
    body: jsonBody(otlpJsonTraceRequest),
    expect: { spans: 1 },
  },
  {
    name: "json gauge metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/json",
    body: jsonBody(otlpJsonMetricRequest),
    expect: { metrics: 1 },
  },
  {
    name: "json histogram metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/json",
    body: jsonBody(otlpJsonHistogramMetricRequest),
    expect: { metrics: 1 },
  },
  {
    name: "json summary metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/json",
    body: jsonBody(otlpJsonSummaryMetricRequest),
    expect: { metrics: 1 },
  },
  {
    name: "json logs",
    path: "/api/ingest/otlp/v1/logs",
    contentType: "application/json",
    body: jsonBody(otlpJsonLogRequest),
    expect: { logs: 1 },
  },
  {
    name: "gzip json logs",
    path: "/api/ingest/otlp/v1/logs",
    contentType: "application/json",
    encoding: "gzip",
    body: gzipJsonBody(otlpJsonLogRequest),
    expect: { logs: 1 },
  },
  {
    name: "protobuf traces",
    path: "/api/ingest/otlp/v1/traces",
    contentType: "application/x-protobuf",
    body: otlpProtobufTraceRequest,
    expect: { spans: 1 },
  },
  {
    name: "protobuf gauge metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/x-protobuf",
    body: otlpProtobufMetricRequest,
    expect: { metrics: 1 },
  },
  {
    name: "protobuf histogram metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/x-protobuf",
    body: otlpProtobufHistogramMetricRequest,
    expect: { metrics: 1 },
  },
  {
    name: "protobuf summary metrics",
    path: "/api/ingest/otlp/v1/metrics",
    contentType: "application/x-protobuf",
    body: otlpProtobufSummaryMetricRequest,
    expect: { metrics: 1 },
  },
  {
    name: "protobuf logs",
    path: "/api/ingest/otlp/v1/logs",
    contentType: "application/x-protobuf",
    body: otlpProtobufLogRequest,
    expect: { logs: 1 },
  },
];

async function runFixture(fixture: FixtureCase) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": fixture.contentType,
  };
  if (fixture.encoding) headers["Content-Encoding"] = fixture.encoding;

  const response = await fetch(`${endpoint}${fixture.path}`, {
    method: "POST",
    headers,
    body: fixture.body,
  });
  const body = await response.json().catch(() => null) as any;
  const counts = body?.counts ?? {};
  const matches = Object.entries(fixture.expect)
    .every(([key, value]) => counts[key] === value);

  return {
    name: fixture.name,
    path: fixture.path,
    status: response.status,
    ok: response.ok && matches,
    expected: fixture.expect,
    counts,
    body: response.ok ? undefined : body,
  };
}

async function main() {
  const results = [];
  for (const fixture of cases) {
    results.push(await runFixture(fixture));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    endpoint,
    metadata: {
      sdk: process.env.PULSEMON_OTEL_SDK ?? null,
      sdkVersion: process.env.PULSEMON_OTEL_SDK_VERSION ?? null,
      collectorVersion: process.env.PULSEMON_OTEL_COLLECTOR_VERSION ?? null,
      protocol: process.env.PULSEMON_OTEL_PROTOCOL ?? "otlphttp",
      compression: process.env.PULSEMON_OTEL_COMPRESSION ?? "mixed",
    },
    pass: failed.length === 0,
    results,
  }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
