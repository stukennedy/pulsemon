import type { Env } from "@/types";
import type { TenantScope } from "@/types";
import type {
  AgentToolCallInsert,
  ConnectionInsert,
  ConnectionUpdate,
  EventInsert,
  LogInsert,
  MetricInsert,
  SpanInsert,
  SpanUpdate,
  TelemetryBatchWrite,
  VoiceTurnInsert,
} from "./repository";

export interface IngestGovernanceConfig {
  readonly redactionEnabled: boolean;
  readonly redactText: boolean;
  readonly redactedValue: string;
  readonly redactKeys: readonly string[];
  readonly allowKeys?: readonly string[];
  readonly denyKeys: readonly string[];
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

type GovernanceEnv = Pick<
  Env,
  | "INGEST_REDACTION_DISABLED"
  | "INGEST_REDACT_TEXT"
  | "INGEST_REDACT_KEYS"
  | "INGEST_ATTRIBUTE_ALLOW_KEYS"
  | "INGEST_ATTRIBUTE_DENY_KEYS"
  | "INGEST_MAX_ATTRIBUTE_KEYS"
  | "INGEST_MAX_ATTRIBUTE_VALUE_LENGTH"
>;

const DEFAULT_REDACT_KEYS = [
  "authorization",
  "cookie",
  "set_cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "client_secret",
  "private_key",
  "session_token",
];

export const DEFAULT_INGEST_GOVERNANCE_CONFIG: IngestGovernanceConfig = {
  redactionEnabled: true,
  redactText: true,
  redactedValue: "[REDACTED]",
  redactKeys: DEFAULT_REDACT_KEYS,
  denyKeys: [],
  maxObjectKeys: 100,
  maxStringLength: 4096,
};

function boolEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function integerEnv(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function listEnv(value: string | undefined, fallback?: readonly string[]) {
  if (value === undefined) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function keySet(keys: readonly string[] | undefined) {
  return new Set((keys ?? []).map(normalizeKey));
}

export function governanceConfigFromEnv(env: GovernanceEnv): IngestGovernanceConfig {
  const redactionDisabled = boolEnv(env.INGEST_REDACTION_DISABLED, false);
  return {
    redactionEnabled: !redactionDisabled,
    redactText: boolEnv(env.INGEST_REDACT_TEXT, true),
    redactedValue: DEFAULT_INGEST_GOVERNANCE_CONFIG.redactedValue,
    redactKeys: listEnv(env.INGEST_REDACT_KEYS, DEFAULT_REDACT_KEYS) ?? [],
    allowKeys: listEnv(env.INGEST_ATTRIBUTE_ALLOW_KEYS),
    denyKeys: listEnv(env.INGEST_ATTRIBUTE_DENY_KEYS, []) ?? [],
    maxObjectKeys: integerEnv(
      env.INGEST_MAX_ATTRIBUTE_KEYS,
      DEFAULT_INGEST_GOVERNANCE_CONFIG.maxObjectKeys
    ),
    maxStringLength: integerEnv(
      env.INGEST_MAX_ATTRIBUTE_VALUE_LENGTH,
      DEFAULT_INGEST_GOVERNANCE_CONFIG.maxStringLength
    ),
  };
}

function truncateString(value: string, config: IngestGovernanceConfig) {
  return config.maxStringLength > 0 && value.length > config.maxStringLength
    ? `${value.slice(0, config.maxStringLength)}...[TRUNCATED]`
    : value;
}

function luhnValid(digits: string) {
  let sum = 0;
  let doubleNext = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (doubleNext) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleNext = !doubleNext;
  }
  return sum > 0 && sum % 10 === 0;
}

function redactPaymentCards(value: string) {
  return value.replace(/\b(?:\d[ -]*?){13,19}\b/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
      ? "[REDACTED_CARD]"
      : candidate;
  });
}

function redactText(value: string, config: IngestGovernanceConfig) {
  if (!config.redactionEnabled || !config.redactText) {
    return truncateString(value, config);
  }

  const redacted = redactPaymentCards(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");

  return truncateString(redacted, config);
}

function shouldDropKey(
  key: string,
  allowKeys: Set<string> | undefined,
  denyKeys: Set<string>
) {
  const normalized = normalizeKey(key);
  if (denyKeys.has(normalized)) return true;
  return allowKeys !== undefined && !allowKeys.has(normalized);
}

function governValueInternal(
  value: unknown,
  config: IngestGovernanceConfig,
  depth: number
): unknown {
  if (typeof value === "string") return redactText(value, config);
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (depth > 8) return "[MAX_DEPTH]";

  if (Array.isArray(value)) {
    return value.map((item) => governValueInternal(item, config, depth + 1));
  }

  const allowKeys = config.allowKeys ? keySet(config.allowKeys) : undefined;
  const denyKeys = keySet(config.denyKeys);
  const redactKeys = keySet(config.redactKeys);
  const result: Record<string, unknown> = {};
  let kept = 0;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (shouldDropKey(key, allowKeys, denyKeys)) continue;

    const normalized = normalizeKey(key);
    result[key] = config.redactionEnabled && redactKeys.has(normalized)
      ? config.redactedValue
      : governValueInternal(item, config, depth + 1);

    kept += 1;
    if (config.maxObjectKeys > 0 && kept >= config.maxObjectKeys) break;
  }

  return result;
}

export function governValue(value: unknown, config: IngestGovernanceConfig): unknown {
  return governValueInternal(value, config, 0);
}

export function governText(value: string | null | undefined, config: IngestGovernanceConfig): string | null | undefined {
  return value === undefined || value === null ? value : redactText(value, config);
}

export function governConnectionInsert(
  input: ConnectionInsert,
  config: IngestGovernanceConfig
): ConnectionInsert {
  return { ...input, metadata: governValue(input.metadata, config) };
}

export function governConnectionUpdate<T extends ConnectionUpdate | (TenantScope & { readonly metadata?: unknown })>(
  input: T,
  config: IngestGovernanceConfig
): T {
  return input.metadata === undefined
    ? input
    : { ...input, metadata: governValue(input.metadata, config) };
}

export function governSpanInsert(input: SpanInsert, config: IngestGovernanceConfig): SpanInsert {
  return {
    ...input,
    status_message: governText(input.status_message, config),
    attributes: governValue(input.attributes, config),
  };
}

export function governSpanUpdate<T extends SpanUpdate | (TenantScope & {
  readonly status_message?: string;
  readonly attributes?: unknown;
})>(input: T, config: IngestGovernanceConfig): T {
  return {
    ...input,
    status_message: governText(input.status_message, config),
    attributes: input.attributes === undefined ? undefined : governValue(input.attributes, config),
  };
}

export function governEventInsert(input: EventInsert, config: IngestGovernanceConfig): EventInsert {
  return { ...input, data: governValue(input.data, config) };
}

export function governMetricInsert(input: MetricInsert, config: IngestGovernanceConfig): MetricInsert {
  return {
    ...input,
    buckets: governValue(input.buckets, config),
    quantiles: governValue(input.quantiles, config),
    tags: governValue(input.tags, config),
  };
}

export function governLogInsert(input: LogInsert, config: IngestGovernanceConfig): LogInsert {
  return {
    ...input,
    message: redactText(input.message, config),
    attributes: governValue(input.attributes, config),
  };
}

export function governVoiceTurnInsert(
  input: VoiceTurnInsert,
  config: IngestGovernanceConfig
): VoiceTurnInsert {
  return {
    ...input,
    transcript: governText(input.transcript, config),
    state: governText(input.state, config),
    metadata: governValue(input.metadata, config),
  };
}

export function governAgentToolCallInsert(
  input: AgentToolCallInsert,
  config: IngestGovernanceConfig
): AgentToolCallInsert {
  return {
    ...input,
    input: governValue(input.input, config),
    output: governValue(input.output, config),
    error: governText(input.error, config),
    metadata: governValue(input.metadata, config),
  };
}

export function governBatch(
  input: TelemetryBatchWrite,
  config: IngestGovernanceConfig
): TelemetryBatchWrite {
  return {
    connections: input.connections.map((item) => governConnectionInsert(item, config)),
    connectionUpdates: input.connectionUpdates.map((item) => governConnectionUpdate(item, config)),
    spans: input.spans.map((item) => governSpanInsert(item, config)),
    spanUpdates: input.spanUpdates.map((item) => governSpanUpdate(item, config)),
    events: input.events.map((item) => governEventInsert(item, config)),
    metrics: input.metrics.map((item) => governMetricInsert(item, config)),
    logs: input.logs.map((item) => governLogInsert(item, config)),
    voiceTurns: input.voiceTurns.map((item) => governVoiceTurnInsert(item, config)),
    toolCalls: input.toolCalls.map((item) => governAgentToolCallInsert(item, config)),
  };
}
