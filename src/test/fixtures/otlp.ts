export const OTLP_SERVICE_NAME = "voice-gateway";
export const OTLP_TRACE_ID = "11111111111111111111111111111111";
export const OTLP_SPAN_ID = "2222222222222222";
export const OTLP_PARENT_SPAN_ID = "3333333333333333";
export const OTLP_CONNECTION_ID = "conn-otlp-fixture";
export const OTLP_SESSION_ID = "session-voice-agent-1";
export const OTLP_TIMESTAMP_NANOS = "1800000000000000000";
export const OTLP_END_TIMESTAMP_NANOS = "1800000000500000000";
export const OTLP_TRACE_OPERATION = "voice.turn";
export const OTLP_METRIC_NAME = "voice.latency_ms";
export const OTLP_METRIC_VALUE = 123.4;
export const OTLP_LOG_MESSAGE = "provider timeout";

export const otlpJsonTraceRequest = {
  resourceSpans: [{
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: OTLP_SERVICE_NAME } },
        { key: "service.namespace", value: { stringValue: "realtime" } },
      ],
    },
    scopeSpans: [{
      spans: [{
        traceId: OTLP_TRACE_ID,
        spanId: OTLP_SPAN_ID,
        parentSpanId: OTLP_PARENT_SPAN_ID,
        name: OTLP_TRACE_OPERATION,
        startTimeUnixNano: OTLP_TIMESTAMP_NANOS,
        endTimeUnixNano: OTLP_END_TIMESTAMP_NANOS,
        status: { code: 2, message: "provider failed" },
        attributes: [
          { key: "connection.id", value: { stringValue: OTLP_CONNECTION_ID } },
          { key: "session.id", value: { stringValue: OTLP_SESSION_ID } },
          { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
          { key: "gen_ai.system", value: { stringValue: "openai" } },
          { key: "voice.pipeline.stage", value: { stringValue: "turn" } },
        ],
      }],
    }],
  }],
} as const;

export const otlpJsonMetricRequest = {
  resourceMetrics: [{
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: OTLP_SERVICE_NAME } },
        { key: "service.namespace", value: { stringValue: "realtime" } },
      ],
    },
    scopeMetrics: [{
      metrics: [{
        name: OTLP_METRIC_NAME,
        unit: "ms",
        gauge: {
          dataPoints: [{
            timeUnixNano: OTLP_TIMESTAMP_NANOS,
            asDouble: OTLP_METRIC_VALUE,
            attributes: [
              { key: "provider", value: { stringValue: "asr" } },
              { key: "session.id", value: { stringValue: OTLP_SESSION_ID } },
              { key: "gen_ai.request.model", value: { stringValue: "gpt-realtime" } },
              { key: "voice.provider", value: { stringValue: "asr" } },
            ],
          }],
        },
      }],
    }],
  }],
} as const;

export const otlpJsonLogRequest = {
  resourceLogs: [{
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: OTLP_SERVICE_NAME } },
        { key: "service.namespace", value: { stringValue: "realtime" } },
      ],
    },
    scopeLogs: [{
      logRecords: [{
        timeUnixNano: OTLP_TIMESTAMP_NANOS,
        severityNumber: 17,
        severityText: "ERROR",
        body: { stringValue: OTLP_LOG_MESSAGE },
        traceId: OTLP_TRACE_ID,
        spanId: OTLP_SPAN_ID,
        attributes: [
          { key: "connection.id", value: { stringValue: OTLP_CONNECTION_ID } },
          { key: "session.id", value: { stringValue: OTLP_SESSION_ID } },
          { key: "event.name", value: { stringValue: "voice.provider.timeout" } },
          { key: "gen_ai.system", value: { stringValue: "openai" } },
        ],
      }],
    }],
  }],
} as const;

function concat(parts: readonly Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function varint(value: number | bigint) {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return new Uint8Array(bytes);
}

function fieldTag(number: number, wireType: number) {
  return varint((number << 3) | wireType);
}

function bytesField(number: number, bytes: Uint8Array) {
  return concat([fieldTag(number, 2), varint(bytes.length), bytes]);
}

function messageField(number: number, parts: readonly Uint8Array[]) {
  return bytesField(number, concat(parts));
}

function stringField(number: number, value: string) {
  return bytesField(number, new TextEncoder().encode(value));
}

function varintField(number: number, value: number | bigint) {
  return concat([fieldTag(number, 0), varint(value)]);
}

function fixed64Field(number: number, value: bigint) {
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return concat([fieldTag(number, 1), bytes]);
}

function doubleField(number: number, value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return concat([fieldTag(number, 1), bytes]);
}

function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function stringAnyValue(value: string) {
  return [stringField(1, value)];
}

function keyValueField(number: number, key: string, value: readonly Uint8Array[]) {
  return messageField(number, [
    stringField(1, key),
    messageField(2, value),
  ]);
}

function keyValue(key: string, value: readonly Uint8Array[]) {
  return keyValueField(1, key, value);
}

function resource(service: string) {
  return messageField(1, [
    keyValue("service.name", stringAnyValue(service)),
    keyValue("service.namespace", stringAnyValue("realtime")),
  ]);
}

const timestampNanos = BigInt(OTLP_TIMESTAMP_NANOS);
const endTimestampNanos = BigInt(OTLP_END_TIMESTAMP_NANOS);

export const otlpProtobufTraceRequest = messageField(1, [
  resource(OTLP_SERVICE_NAME),
  messageField(2, [
    messageField(2, [
      bytesField(1, hexBytes(OTLP_TRACE_ID)),
      bytesField(2, hexBytes(OTLP_SPAN_ID)),
      bytesField(4, hexBytes(OTLP_PARENT_SPAN_ID)),
      stringField(5, OTLP_TRACE_OPERATION),
      fixed64Field(7, timestampNanos),
      fixed64Field(8, endTimestampNanos),
      keyValueField(9, "connection.id", stringAnyValue(OTLP_CONNECTION_ID)),
      keyValueField(9, "session.id", stringAnyValue(OTLP_SESSION_ID)),
      keyValueField(9, "gen_ai.operation.name", stringAnyValue("chat")),
      keyValueField(9, "gen_ai.system", stringAnyValue("openai")),
      keyValueField(9, "voice.pipeline.stage", stringAnyValue("turn")),
      messageField(15, [
        stringField(2, "provider failed"),
        varintField(3, 2),
      ]),
    ]),
  ]),
]);

export const otlpProtobufMetricRequest = messageField(1, [
  resource(OTLP_SERVICE_NAME),
  messageField(2, [
    messageField(2, [
      stringField(1, OTLP_METRIC_NAME),
      stringField(3, "ms"),
      messageField(5, [
        messageField(1, [
          fixed64Field(3, timestampNanos),
          doubleField(4, OTLP_METRIC_VALUE),
          keyValueField(7, "provider", stringAnyValue("asr")),
          keyValueField(7, "session.id", stringAnyValue(OTLP_SESSION_ID)),
          keyValueField(7, "gen_ai.request.model", stringAnyValue("gpt-realtime")),
          keyValueField(7, "voice.provider", stringAnyValue("asr")),
        ]),
      ]),
    ]),
  ]),
]);

export const otlpProtobufLogRequest = messageField(1, [
  resource(OTLP_SERVICE_NAME),
  messageField(2, [
    messageField(2, [
      fixed64Field(1, timestampNanos),
      varintField(2, 17),
      stringField(3, "ERROR"),
      messageField(5, stringAnyValue(OTLP_LOG_MESSAGE)),
      keyValueField(6, "connection.id", stringAnyValue(OTLP_CONNECTION_ID)),
      keyValueField(6, "session.id", stringAnyValue(OTLP_SESSION_ID)),
      keyValueField(6, "event.name", stringAnyValue("voice.provider.timeout")),
      keyValueField(6, "gen_ai.system", stringAnyValue("openai")),
      bytesField(9, hexBytes(OTLP_TRACE_ID)),
      bytesField(10, hexBytes(OTLP_SPAN_ID)),
    ]),
  ]),
]);
