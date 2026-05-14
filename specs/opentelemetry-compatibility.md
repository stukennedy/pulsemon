# OpenTelemetry Compatibility

Pulsemon accepts OTLP over HTTP on the standard signal-specific paths and
translates export requests into its native D1-backed observability model.

## Ingest Matrix

| Signal | Route | JSON | Protobuf | Gzip | Native record |
| --- | --- | --- | --- | --- | --- |
| Traces | `POST /api/ingest/otlp/v1/traces` | Yes | Yes | Yes | `spans` |
| Metrics | `POST /api/ingest/otlp/v1/metrics` | Yes | Yes | Yes | `metrics` |
| Logs | `POST /api/ingest/otlp/v1/logs` | Yes | Yes | Yes | `logs` |

Supported content types:

- `application/json`, `text/json`, and `+json` variants.
- `application/x-protobuf` and `application/protobuf`.
- `Content-Encoding: gzip` for JSON and protobuf bodies.

Collector configuration should use an OTLP HTTP exporter with
`endpoint: https://pulsemon.example.com/api/ingest/otlp`. The exporter appends
`/v1/traces`, `/v1/metrics`, and `/v1/logs`.

## Fixture Coverage

The compatibility fixtures live in `src/test/fixtures/otlp.ts` and are ingested
by `src/test/api/otlp.test.ts`.

| Fixture | Coverage |
| --- | --- |
| JSON trace export | `resourceSpans`, `scopeSpans`, trace/span IDs, parent span ID, operation name, start/end timestamps, status, attributes |
| JSON metric export | `resourceMetrics`, `scopeMetrics`, gauge datapoint, `asDouble`, datapoint attributes |
| JSON log export | `resourceLogs`, `scopeLogs`, severity text/number, body, trace/span IDs, attributes |
| Protobuf trace export | Same trace fields as JSON using OTLP protobuf wire encoding |
| Protobuf metric export | Same metric fields as JSON using OTLP protobuf wire encoding |
| Protobuf log export | Same log fields as JSON using OTLP protobuf wire encoding |
| Gzip request | Compressed JSON log export |

## Semantic Mapping

| OTLP field | Pulsemon behavior |
| --- | --- |
| Resource `service.name` | Stored as native `service`; defaults to `unknown-service` when absent |
| Span `traceId` / `spanId` / `parentSpanId` | Stored as native trace/span identifiers |
| Span `name` | Stored as native operation |
| Span status code `2` | Stored as native `error`; all other codes are `ok` |
| Span/log `connection.id` attribute | Lifted into native `connection_id` for realtime correlation |
| Log `traceId` / `spanId` | Stored as native trace/span correlation |
| Log body | Stored as native message; non-string values are JSON stringified |
| Metric gauge/sum/histogram datapoints | Stored as native metric samples |
| Other attributes | Preserved in span attributes, metric tags, or log attributes |

The fixtures intentionally include realtime voice and agentic attributes such
as `session.id`, `gen_ai.operation.name`, `gen_ai.request.model`,
`gen_ai.system`, and `voice.pipeline.stage`. Pulsemon preserves these for
searching, session timelines, and downstream SLO/monitor workflows.

## Known Limits

- OTLP/gRPC is not implemented; deploy an OpenTelemetry Collector or SDK
  exporter using OTLP HTTP.
- Histogram support currently stores representative `sum` or `count` values as
  metric samples. Explicit buckets, exemplars, and exponential histograms are
  not yet modeled as native first-class records.
- Summary metrics are not translated.
- Protobuf decoding covers the export request fields represented by the
  fixtures. Unknown fields are ignored by design.
- Live SDK and Collector version certification should be recorded per platform
  rollout. The repo-owned fixtures provide a deterministic baseline; staging
  certification should add rows for the exact SDK/Collector versions in use.

## Certification Checklist

For each platform rollout:

- Run `bun test src/test/api/otlp.test.ts`.
- Send trace, metric, and log exports through the target SDK or Collector to a
  staging Pulsemon instance.
- Confirm `service.name`, trace IDs, span IDs, log correlation, metric tags,
  `connection.id`, and `session.id` appear in the UI/API.
- Record the SDK language, SDK version, Collector version if used, exporter
  protocol, compression setting, and any unsupported instruments.
