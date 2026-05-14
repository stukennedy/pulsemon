export type {
  AgentToolCall,
  AuditEvent,
  Connection,
  Event,
  LogRecord,
  Metric,
  MonitorDefinitionRecord,
  SloDefinitionRecord,
  SloEvaluationRecord,
  Span,
  VoiceTurn,
} from "@/db/schema";

export interface Facet {
  name: string;
  field: string;
}

export interface ActiveTag {
  facet: string;
  value: string;
}

export interface TenantScope {
  workspace_id: string;
  project_id: string;
}

export interface Env {
  DB: D1Database;
  SEARCH_SESSION: DurableObjectNamespace;
  INGEST_API_KEY?: string;
  INGEST_API_KEYS?: string;
  INGEST_MAX_BYTES?: string;
  INGEST_REDACTION_DISABLED?: string;
  INGEST_REDACT_TEXT?: string;
  INGEST_REDACT_KEYS?: string;
  INGEST_ATTRIBUTE_ALLOW_KEYS?: string;
  INGEST_ATTRIBUTE_DENY_KEYS?: string;
  INGEST_MAX_ATTRIBUTE_KEYS?: string;
  INGEST_MAX_ATTRIBUTE_VALUE_LENGTH?: string;
  DEFAULT_WORKSPACE_ID?: string;
  DEFAULT_PROJECT_ID?: string;
  RETENTION_DAYS?: string;
  METRIC_ROLLUP_AFTER_MINUTES?: string;
  METRIC_ROLLUP_RETENTION_DAYS?: string;
  INGEST_RATE_LIMIT_PER_MINUTE?: string;
  INGEST_SAMPLE_RATE?: string;
  INGEST_CARDINALITY_MAX_VALUES_PER_KEY?: string;
  MAINTENANCE_API_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_WEBHOOK_SECRET?: string;
  ALERT_SLACK_WEBHOOK_URL?: string;
  ALERT_PAGERDUTY_ROUTING_KEY?: string;
  ALERT_EMAIL_WEBHOOK_URL?: string;
  UI_BASIC_AUTH?: string;
  UI_USERS?: string;
}
