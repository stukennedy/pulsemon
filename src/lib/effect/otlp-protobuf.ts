type ProtoWireType = 0 | 1 | 2 | 5;

interface ProtoField {
  readonly number: number;
  readonly wireType: ProtoWireType;
  readonly varint?: bigint;
  readonly bytes?: Uint8Array;
}

const textDecoder = new TextDecoder();

class ProtoReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readFields(): ProtoField[] {
    const fields: ProtoField[] = [];
    while (this.offset < this.bytes.length) {
      const tag = this.readVarint();
      const number = Number(tag >> 3n);
      const wireType = Number(tag & 0x07n) as ProtoWireType;
      if (number <= 0) throw new Error("Invalid protobuf field number");

      switch (wireType) {
        case 0:
          fields.push({ number, wireType, varint: this.readVarint() });
          break;
        case 1:
          fields.push({ number, wireType, bytes: this.readBytes(8) });
          break;
        case 2: {
          const length = Number(this.readVarint());
          fields.push({ number, wireType, bytes: this.readBytes(length) });
          break;
        }
        case 5:
          fields.push({ number, wireType, bytes: this.readBytes(4) });
          break;
        default:
          throw new Error(`Unsupported protobuf wire type ${wireType}`);
      }
    }
    return fields;
  }

  readPackedVarints(): bigint[] {
    const values: bigint[] = [];
    while (this.offset < this.bytes.length) {
      values.push(this.readVarint());
    }
    return values;
  }

  private readVarint() {
    let result = 0n;
    let shift = 0n;

    for (let index = 0; index < 10; index++) {
      if (this.offset >= this.bytes.length) throw new Error("Unexpected protobuf EOF");
      const byte = this.bytes[this.offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }

    throw new Error("Invalid protobuf varint");
  }

  private readBytes(length: number) {
    if (!Number.isInteger(length) || length < 0) throw new Error("Invalid protobuf length");
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error("Unexpected protobuf EOF");
    const slice = this.bytes.slice(this.offset, end);
    this.offset = end;
    return slice;
  }
}

function fields(bytes: Uint8Array | undefined) {
  return bytes ? new ProtoReader(bytes).readFields() : [];
}

function all(input: readonly ProtoField[], number: number) {
  return input.filter((field) => field.number === number);
}

function first(input: readonly ProtoField[], number: number) {
  return input.find((field) => field.number === number);
}

function message(input: readonly ProtoField[], number: number) {
  return fields(first(input, number)?.bytes);
}

function text(input: readonly ProtoField[], number: number): string | undefined {
  const value = first(input, number)?.bytes;
  return value && value.length > 0 ? textDecoder.decode(value) : undefined;
}

function hex(input: readonly ProtoField[], number: number): string | undefined {
  const value = first(input, number)?.bytes;
  if (!value || value.length === 0) return undefined;
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bool(input: readonly ProtoField[], number: number): boolean | undefined {
  const value = first(input, number)?.varint;
  return value === undefined ? undefined : value !== 0n;
}

function enumNumber(input: readonly ProtoField[], number: number): number | undefined {
  const value = first(input, number)?.varint;
  return value === undefined ? undefined : Number(value);
}

function littleEndianBigInt(bytes: Uint8Array | undefined): bigint | undefined {
  if (!bytes) return undefined;
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) {
    result = (result << 8n) | BigInt(bytes[index]);
  }
  return result;
}

function uint64(input: readonly ProtoField[], number: number): string | undefined {
  const field = first(input, number);
  if (!field) return undefined;
  if (field.varint !== undefined) return field.varint.toString();
  return littleEndianBigInt(field.bytes)?.toString();
}

function double(input: readonly ProtoField[], number: number): number | undefined {
  const value = first(input, number)?.bytes;
  if (!value || value.length !== 8) return undefined;
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getFloat64(0, true);
}

function doubles(input: readonly ProtoField[], number: number): number[] | undefined {
  const values: number[] = [];
  for (const field of all(input, number)) {
    if (field.bytes && field.bytes.length === 8) {
      values.push(new DataView(field.bytes.buffer, field.bytes.byteOffset, field.bytes.byteLength).getFloat64(0, true));
    } else if (field.bytes && field.bytes.length % 8 === 0) {
      for (let offset = 0; offset < field.bytes.length; offset += 8) {
        values.push(new DataView(field.bytes.buffer, field.bytes.byteOffset + offset, 8).getFloat64(0, true));
      }
    }
  }
  return values.length > 0 ? values : undefined;
}

function intValue(input: readonly ProtoField[], number: number): number | string | undefined {
  const field = first(input, number);
  if (!field) return undefined;
  if (field.varint !== undefined) return Number(field.varint);
  const fixed = littleEndianBigInt(field.bytes);
  return fixed === undefined ? undefined : fixed.toString();
}

function packedVarints(bytes: Uint8Array) {
  return new ProtoReader(bytes).readPackedVarints();
}

function intValues(input: readonly ProtoField[], number: number): Array<number | string> | undefined {
  const values: Array<number | string> = [];
  for (const field of all(input, number)) {
    if (field.varint !== undefined) {
      values.push(Number(field.varint));
    } else if (field.bytes) {
      values.push(...packedVarints(field.bytes).map((value) => Number(value)));
    }
  }
  return values.length > 0 ? values : undefined;
}

function parseAnyValue(input: readonly ProtoField[]): Record<string, unknown> | undefined {
  const stringValue = text(input, 1);
  if (stringValue !== undefined) return { stringValue };

  const boolValue = bool(input, 2);
  if (boolValue !== undefined) return { boolValue };

  const int = intValue(input, 3);
  if (int !== undefined) return { intValue: int };

  const doubleValue = double(input, 4);
  if (doubleValue !== undefined) return { doubleValue };

  const arrayValue = first(input, 5);
  if (arrayValue?.bytes) {
    return {
      arrayValue: {
        values: all(fields(arrayValue.bytes), 1)
          .map((field) => parseAnyValue(fields(field.bytes)))
          .filter((value): value is Record<string, unknown> => Boolean(value)),
      },
    };
  }

  const kvlistValue = first(input, 6);
  if (kvlistValue?.bytes) {
    return { kvlistValue: { values: parseKeyValues(fields(kvlistValue.bytes), 1) } };
  }

  const bytesValue = first(input, 7)?.bytes;
  if (bytesValue) return { bytesValue: hex([{ number: 7, wireType: 2, bytes: bytesValue }], 7) };

  return undefined;
}

function parseKeyValue(input: readonly ProtoField[]) {
  const key = text(input, 1);
  const value = parseAnyValue(message(input, 2));
  return key && value ? { key, value } : undefined;
}

function parseKeyValues(input: readonly ProtoField[], number: number) {
  return all(input, number)
    .map((field) => parseKeyValue(fields(field.bytes)))
    .filter((value): value is { key: string; value: Record<string, unknown> } => Boolean(value));
}

function parseResource(input: readonly ProtoField[]) {
  return { attributes: parseKeyValues(input, 1) };
}

function serviceResource(input: readonly ProtoField[]) {
  return parseResource(input);
}

function parseStatus(input: readonly ProtoField[]) {
  if (input.length === 0) return undefined;
  return {
    message: text(input, 2),
    code: enumNumber(input, 3),
  };
}

function parseSpan(input: readonly ProtoField[]) {
  return {
    traceId: hex(input, 1),
    spanId: hex(input, 2),
    parentSpanId: hex(input, 4),
    name: text(input, 5),
    startTimeUnixNano: uint64(input, 7),
    endTimeUnixNano: uint64(input, 8),
    attributes: parseKeyValues(input, 9),
    status: parseStatus(message(input, 15)),
  };
}

function parseScopeSpans(input: readonly ProtoField[]) {
  return {
    spans: all(input, 2).map((field) => parseSpan(fields(field.bytes))),
  };
}

function parseResourceSpans(input: readonly ProtoField[]) {
  return {
    resource: serviceResource(message(input, 1)),
    scopeSpans: all(input, 2).map((field) => parseScopeSpans(fields(field.bytes))),
  };
}

function parseNumberDataPoint(input: readonly ProtoField[]) {
  return {
    attributes: parseKeyValues(input, 7),
    timeUnixNano: uint64(input, 3),
    asDouble: double(input, 4),
    asInt: intValue(input, 6),
  };
}

function parseHistogramDataPoint(input: readonly ProtoField[]) {
  return {
    attributes: parseKeyValues(input, 9),
    timeUnixNano: uint64(input, 3),
    count: intValue(input, 4),
    sum: double(input, 5),
    explicitBounds: doubles(input, 6),
    bucketCounts: intValues(input, 7),
    min: double(input, 11),
    max: double(input, 12),
  };
}

function parseValueAtQuantile(input: readonly ProtoField[]) {
  return {
    quantile: double(input, 1),
    value: double(input, 2),
  };
}

function parseSummaryDataPoint(input: readonly ProtoField[]) {
  return {
    attributes: parseKeyValues(input, 7),
    timeUnixNano: uint64(input, 3),
    count: intValue(input, 4),
    sum: double(input, 5),
    quantileValues: all(input, 6).map((field) => parseValueAtQuantile(fields(field.bytes))),
  };
}

function parseMetric(input: readonly ProtoField[]) {
  const metric: Record<string, unknown> = {
    name: text(input, 1),
    description: text(input, 2),
    unit: text(input, 3),
  };

  const gauge = first(input, 5);
  if (gauge?.bytes) {
    metric.gauge = {
      dataPoints: all(fields(gauge.bytes), 1)
        .map((field) => parseNumberDataPoint(fields(field.bytes))),
    };
  }

  const sum = first(input, 7);
  if (sum?.bytes) {
    metric.sum = {
      dataPoints: all(fields(sum.bytes), 1)
        .map((field) => parseNumberDataPoint(fields(field.bytes))),
    };
  }

  const histogram = first(input, 9);
  if (histogram?.bytes) {
    metric.histogram = {
      dataPoints: all(fields(histogram.bytes), 1)
        .map((field) => parseHistogramDataPoint(fields(field.bytes))),
    };
  }

  const summary = first(input, 11);
  if (summary?.bytes) {
    metric.summary = {
      dataPoints: all(fields(summary.bytes), 1)
        .map((field) => parseSummaryDataPoint(fields(field.bytes))),
    };
  }

  return metric;
}

function parseScopeMetrics(input: readonly ProtoField[]) {
  return {
    metrics: all(input, 2).map((field) => parseMetric(fields(field.bytes))),
  };
}

function parseResourceMetrics(input: readonly ProtoField[]) {
  return {
    resource: serviceResource(message(input, 1)),
    scopeMetrics: all(input, 2).map((field) => parseScopeMetrics(fields(field.bytes))),
  };
}

function parseLogRecord(input: readonly ProtoField[]) {
  return {
    timeUnixNano: uint64(input, 1),
    severityNumber: enumNumber(input, 2),
    severityText: text(input, 3),
    body: parseAnyValue(message(input, 5)),
    attributes: parseKeyValues(input, 6),
    traceId: hex(input, 9),
    spanId: hex(input, 10),
    observedTimeUnixNano: uint64(input, 11),
  };
}

function parseScopeLogs(input: readonly ProtoField[]) {
  return {
    logRecords: all(input, 2).map((field) => parseLogRecord(fields(field.bytes))),
  };
}

function parseResourceLogs(input: readonly ProtoField[]) {
  return {
    resource: serviceResource(message(input, 1)),
    scopeLogs: all(input, 2).map((field) => parseScopeLogs(fields(field.bytes))),
  };
}

function bytesFrom(input: Uint8Array | ArrayBuffer) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function decodeOtlpTracesProtobuf(input: Uint8Array | ArrayBuffer) {
  const root = fields(bytesFrom(input));
  return {
    resourceSpans: all(root, 1).map((field) => parseResourceSpans(fields(field.bytes))),
  };
}

export function decodeOtlpMetricsProtobuf(input: Uint8Array | ArrayBuffer) {
  const root = fields(bytesFrom(input));
  return {
    resourceMetrics: all(root, 1).map((field) => parseResourceMetrics(fields(field.bytes))),
  };
}

export function decodeOtlpLogsProtobuf(input: Uint8Array | ArrayBuffer) {
  const root = fields(bytesFrom(input));
  return {
    resourceLogs: all(root, 1).map((field) => parseResourceLogs(fields(field.bytes))),
  };
}
