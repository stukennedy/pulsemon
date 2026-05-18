import { Effect } from "effect";
import type { TenantScope } from "@/types";
import { authorizeIngest, type ApiKeyContext } from "./auth";
import type { IngestCardinalityController } from "./cardinality";
import {
  PayloadTooLargeError,
  ValidationError,
  type IngestError,
} from "./errors";
import {
  DEFAULT_INGEST_GOVERNANCE_CONFIG,
  governLogInsert,
  governMetricInsert,
  governSpanInsert,
  type IngestGovernanceConfig,
} from "./governance";
import {
  DEFAULT_INGEST_PRESSURE_CONFIG,
  sampleItems,
  type IngestPressureConfig,
  type IngestPressureController,
} from "./pressure";
import type {
  LogInsert,
  MetricInsert,
  SpanInsert,
  TelemetryBatchWrite,
  TelemetryRepository,
} from "./repository";

export interface OtlpDeps {
  readonly repository: TelemetryRepository;
  readonly expectedApiKey?: string;
  readonly apiKeys?: string;
  readonly authorization: string;
  readonly requiredScope: string;
  readonly defaultTenant: TenantScope;
  readonly pressure?: IngestPressureController;
  readonly governance?: IngestGovernanceConfig;
  readonly cardinality?: IngestCardinalityController;
}

type OtlpRecord = Record<string, unknown>;

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function asRecord(value: unknown): OtlpRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as OtlpRecord
    : null;
}

function preparePressure(
  deps: OtlpDeps,
  context: ApiKeyContext
): Effect.Effect<IngestPressureConfig, IngestError> {
  return deps.pressure
    ? deps.pressure.prepare(context, deps.requiredScope)
    : Effect.succeed(DEFAULT_INGEST_PRESSURE_CONFIG);
}

function governanceConfig(deps: OtlpDeps) {
  return deps.governance ?? DEFAULT_INGEST_GOVERNANCE_CONFIG;
}

function enforceCardinality(
  deps: OtlpDeps,
  context: ApiKeyContext,
  batch: TelemetryBatchWrite
): Effect.Effect<void, IngestError> {
  return deps.cardinality
    ? deps.cardinality.enforce(context, deps.requiredScope, batch)
    : Effect.void;
}

function metricCountResult(count: number, sampledOut: number) {
  return sampledOut > 0
    ? { counts: { metrics: count }, sampled_out: sampledOut }
    : { counts: { metrics: count } };
}

function logCountResult(count: number, sampledOut: number) {
  return sampledOut > 0
    ? { counts: { logs: count }, sampled_out: sampledOut }
    : { counts: { logs: count } };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function attrValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return undefined;

  if ("stringValue" in record) return record.stringValue;
  if ("boolValue" in record) return record.boolValue;
  if ("intValue" in record) return asNumber(record.intValue);
  if ("doubleValue" in record) return asNumber(record.doubleValue);
  if ("bytesValue" in record) return record.bytesValue;

  const arrayValue = asRecord(record.arrayValue);
  if (arrayValue) return asArray(arrayValue.values).map(attrValue);

  const kvListValue = asRecord(record.kvlistValue);
  if (kvListValue) return attributesToObject(asArray(kvListValue.values));

  return undefined;
}

function attributesToObject(attributes: unknown[]): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const item of attributes) {
    const record = asRecord(item);
    if (!record) continue;
    const key = asString(record.key);
    if (!key) continue;
    result[key] = attrValue(record.value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function attributeString(attributes: unknown[], key: string): string | undefined {
  const value = attributesToObject(attributes)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  const numbers = asArray(value)
    .map(asNumber)
    .filter((item): item is number => item !== undefined);
  return numbers.length > 0 ? numbers : undefined;
}

function histogramBuckets(point: OtlpRecord): Record<string, number[]> | undefined {
  const explicitBounds = numberArray(point.explicitBounds);
  const bucketCounts = numberArray(point.bucketCounts);
  if (!explicitBounds && !bucketCounts) return undefined;
  return {
    ...(explicitBounds ? { explicit_bounds: explicitBounds } : {}),
    ...(bucketCounts ? { bucket_counts: bucketCounts } : {}),
  };
}

function summaryQuantiles(point: OtlpRecord): Array<{ quantile: number; value: number }> | undefined {
  const quantiles = asArray(point.quantileValues)
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const quantile = asNumber(record.quantile);
      const value = asNumber(record.value);
      return quantile === undefined || value === undefined ? null : { quantile, value };
    })
    .filter((item): item is { quantile: number; value: number } => Boolean(item));
  return quantiles.length > 0 ? quantiles : undefined;
}

function serviceName(resource: unknown): string {
  const resourceRecord = asRecord(resource);
  const attributes = asArray(resourceRecord?.attributes);
  return attributeString(attributes, "service.name") ?? "unknown-service";
}

function unixNanoToIso(value: unknown): string {
  const raw = asString(value) ?? (typeof value === "number" ? String(Math.trunc(value)) : undefined);
  if (!raw) return now();

  try {
    const millis = BigInt(raw) / 1_000_000n;
    return new Date(Number(millis)).toISOString();
  } catch {
    return now();
  }
}

function durationMs(start: unknown, end: unknown): number | undefined {
  const startRaw = asString(start) ?? (typeof start === "number" ? String(Math.trunc(start)) : undefined);
  const endRaw = asString(end) ?? (typeof end === "number" ? String(Math.trunc(end)) : undefined);
  if (!startRaw || !endRaw) return undefined;

  try {
    const delta = (BigInt(endRaw) - BigInt(startRaw)) / 1_000_000n;
    const millis = Number(delta);
    return Number.isFinite(millis) && millis >= 0 ? millis : undefined;
  } catch {
    return undefined;
  }
}

function status(record: OtlpRecord): { status: string; status_message?: string } {
  const statusRecord = asRecord(record.status);
  const code = asNumber(statusRecord?.code);
  return {
    status: code === 2 ? "error" : "ok",
    status_message: asString(statusRecord?.message),
  };
}

function logLevel(record: OtlpRecord): string {
  const severityText = asString(record.severityText);
  if (severityText) return severityText.toLowerCase();

  const severityNumber = asNumber(record.severityNumber) ?? 9;
  if (severityNumber >= 21) return "fatal";
  if (severityNumber >= 17) return "error";
  if (severityNumber >= 13) return "warn";
  if (severityNumber >= 9) return "info";
  if (severityNumber >= 5) return "debug";
  return "trace";
}

function bodyValue(body: unknown): string {
  const value = attrValue(body);
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function emptyBatch(): TelemetryBatchWrite {
  return {
    connections: [],
    connectionUpdates: [],
    spans: [],
    spanUpdates: [],
    events: [],
    metrics: [],
    logs: [],
    voiceTurns: [],
    toolCalls: [],
  };
}

export function normalizeOtlpTraceBatch(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): TelemetryBatchWrite {
  return { ...emptyBatch(), spans: traceSpans(raw, tenant, governance) };
}

export function normalizeOtlpMetricBatch(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): TelemetryBatchWrite {
  return { ...emptyBatch(), metrics: metricRecords(raw, tenant, governance) };
}

export function normalizeOtlpLogBatch(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): TelemetryBatchWrite {
  return { ...emptyBatch(), logs: logRecords(raw, tenant, governance) };
}

function ensureBatchSize(count: number): Effect.Effect<void, ValidationError | PayloadTooLargeError> {
  if (count === 0) {
    return Effect.fail(new ValidationError({ message: "No OTLP records provided" }));
  }
  if (count > 1000) {
    return Effect.fail(new PayloadTooLargeError({ message: "Max 1000 OTLP records per request" }));
  }
  return Effect.void;
}

function traceSpans(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): SpanInsert[] {
  const root = asRecord(raw);
  const records: SpanInsert[] = [];

  for (const resourceSpan of asArray(root?.resourceSpans)) {
    const resourceSpanRecord = asRecord(resourceSpan);
    const service = serviceName(resourceSpanRecord?.resource);

    for (const scopeSpan of asArray(resourceSpanRecord?.scopeSpans)) {
      const scopeSpanRecord = asRecord(scopeSpan);
      for (const span of asArray(scopeSpanRecord?.spans)) {
        const spanRecord = asRecord(span);
        if (!spanRecord) continue;

        const id = asString(spanRecord.spanId) ?? uuid();
        const trace_id = asString(spanRecord.traceId);
        const operation = asString(spanRecord.name);
        if (!trace_id || !operation) continue;

        const spanStatus = status(spanRecord);
        records.push(governSpanInsert({
          ...tenant,
          id,
          trace_id,
          parent_span_id: asString(spanRecord.parentSpanId),
          connection_id: attributeString(asArray(spanRecord.attributes), "connection.id"),
          service,
          operation,
          started_at: unixNanoToIso(spanRecord.startTimeUnixNano),
          ended_at: spanRecord.endTimeUnixNano ? unixNanoToIso(spanRecord.endTimeUnixNano) : undefined,
          duration_ms: durationMs(spanRecord.startTimeUnixNano, spanRecord.endTimeUnixNano),
          status: spanStatus.status,
          status_message: spanStatus.status_message,
          attributes: attributesToObject(asArray(spanRecord.attributes)),
        }, governance));
      }
    }
  }

  return records;
}

function metricRecords(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): MetricInsert[] {
  const root = asRecord(raw);
  const records: MetricInsert[] = [];

  for (const resourceMetric of asArray(root?.resourceMetrics)) {
    const resourceMetricRecord = asRecord(resourceMetric);
    const service = serviceName(resourceMetricRecord?.resource);

    for (const scopeMetric of asArray(resourceMetricRecord?.scopeMetrics)) {
      const scopeMetricRecord = asRecord(scopeMetric);
      for (const metric of asArray(scopeMetricRecord?.metrics)) {
        const metricRecord = asRecord(metric);
        if (!metricRecord) continue;

        const metric_name = asString(metricRecord.name);
        if (!metric_name) continue;

        const data = asRecord(metricRecord.gauge)
          ? { type: "gauge", points: asArray(asRecord(metricRecord.gauge)?.dataPoints) }
          : asRecord(metricRecord.sum)
            ? { type: "counter", points: asArray(asRecord(metricRecord.sum)?.dataPoints) }
            : asRecord(metricRecord.histogram)
              ? { type: "histogram", points: asArray(asRecord(metricRecord.histogram)?.dataPoints) }
              : asRecord(metricRecord.summary)
                ? { type: "summary", points: asArray(asRecord(metricRecord.summary)?.dataPoints) }
              : null;
        if (!data) continue;

        for (const point of data.points) {
          const pointRecord = asRecord(point);
          if (!pointRecord) continue;

          const count = asNumber(pointRecord.count);
          const sum = asNumber(pointRecord.sum);
          const quantiles = summaryQuantiles(pointRecord);
          const value = asNumber(pointRecord.asDouble)
            ?? asNumber(pointRecord.asInt)
            ?? sum
            ?? count
            ?? quantiles?.[0]?.value;
          if (value === undefined) continue;

          records.push(governMetricInsert({
            ...tenant,
            id: uuid(),
            service,
            metric_name,
            metric_type: data.type,
            timestamp: unixNanoToIso(pointRecord.timeUnixNano),
            value,
            unit: asString(metricRecord.unit),
            count,
            sum,
            min: asNumber(pointRecord.min),
            max: asNumber(pointRecord.max),
            buckets: histogramBuckets(pointRecord),
            quantiles,
            tags: attributesToObject(asArray(pointRecord.attributes)),
          }, governance));
        }
      }
    }
  }

  return records;
}

function logRecords(
  raw: unknown,
  tenant: TenantScope,
  governance: IngestGovernanceConfig
): LogInsert[] {
  const root = asRecord(raw);
  const records: LogInsert[] = [];

  for (const resourceLog of asArray(root?.resourceLogs)) {
    const resourceLogRecord = asRecord(resourceLog);
    const service = serviceName(resourceLogRecord?.resource);

    for (const scopeLog of asArray(resourceLogRecord?.scopeLogs)) {
      const scopeLogRecord = asRecord(scopeLog);
      for (const log of asArray(scopeLogRecord?.logRecords)) {
        const logRecord = asRecord(log);
        if (!logRecord) continue;

        const message = bodyValue(logRecord.body);
        if (!message) continue;

        records.push(governLogInsert({
          ...tenant,
          id: asString(logRecord.observedTimeUnixNano) ?? uuid(),
          timestamp: unixNanoToIso(logRecord.timeUnixNano ?? logRecord.observedTimeUnixNano),
          level: logLevel(logRecord),
          service,
          message,
          trace_id: asString(logRecord.traceId),
          span_id: asString(logRecord.spanId),
          connection_id: attributeString(asArray(logRecord.attributes), "connection.id"),
          attributes: attributesToObject(asArray(logRecord.attributes)),
        }, governance));
      }
    }
  }

  return records;
}

export function postOtlpTraces(
  deps: OtlpDeps,
  raw: unknown
): Effect.Effect<{ counts: { spans: number } }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    yield* preparePressure(deps, auth);
    const batch = normalizeOtlpTraceBatch(raw, auth, governanceConfig(deps));
    yield* ensureBatchSize(batch.spans.length);
    yield* enforceCardinality(deps, auth, batch);
    yield* deps.repository.writeBatch(batch);
    return { counts: { spans: batch.spans.length } };
  });
}

export function postOtlpMetrics(
  deps: OtlpDeps,
  raw: unknown
): Effect.Effect<{ counts: { metrics: number }; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const { metrics } = normalizeOtlpMetricBatch(raw, auth, governanceConfig(deps));
    yield* ensureBatchSize(metrics.length);
    const sampled = sampleItems(metrics, pressure, (metric) => metric.id);
    if (sampled.kept.length > 0) {
      const batch = { ...emptyBatch(), metrics: sampled.kept };
      yield* enforceCardinality(deps, auth, batch);
      yield* deps.repository.writeBatch(batch);
    }
    return metricCountResult(sampled.kept.length, sampled.sampledOut);
  });
}

export function postOtlpLogs(
  deps: OtlpDeps,
  raw: unknown
): Effect.Effect<{ counts: { logs: number }; sampled_out?: number }, IngestError> {
  return Effect.gen(function* () {
    const auth = yield* authorizeIngest(deps);
    const pressure = yield* preparePressure(deps, auth);
    const { logs } = normalizeOtlpLogBatch(raw, auth, governanceConfig(deps));
    yield* ensureBatchSize(logs.length);
    const sampled = sampleItems(logs, pressure, (log) => log.id);
    if (sampled.kept.length > 0) {
      const batch = { ...emptyBatch(), logs: sampled.kept };
      yield* enforceCardinality(deps, auth, batch);
      yield* deps.repository.writeBatch(batch);
    }
    return logCountResult(sampled.kept.length, sampled.sampledOut);
  });
}
