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
  TELEMETRY_QUEUE?: Queue;
  RAW_TELEMETRY?: R2Bucket;
  INGEST_MODE?: string;
  RAW_TELEMETRY_REQUIRED?: string;
  RAW_TELEMETRY_PREFIX?: string;
  INGEST_API_KEY?: string;
  INGEST_API_KEYS?: string;
  INGEST_MAX_BYTES?: string;
  INGEST_QUEUE_MAX_BYTES?: string;
  INGEST_QUEUE_MAX_OPERATIONS?: string;
  INGEST_DIRECT_D1_MAX_BATCH_OPERATIONS?: string;
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
  UI_ROLE_GROUPS?: string;
  UI_SESSION_SECRET?: string;
  UI_SESSION_TTL_SECONDS?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_AUTHORIZATION_ENDPOINT?: string;
  OIDC_TOKEN_ENDPOINT?: string;
  OIDC_USERINFO_ENDPOINT?: string;
  OIDC_REDIRECT_URI?: string;
  OIDC_SCOPES?: string;
}
