export type {
  AgentToolCall,
  Connection,
  Event,
  LogRecord,
  Metric,
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
  DEFAULT_WORKSPACE_ID?: string;
  DEFAULT_PROJECT_ID?: string;
  RETENTION_DAYS?: string;
  METRIC_ROLLUP_AFTER_MINUTES?: string;
  METRIC_ROLLUP_RETENTION_DAYS?: string;
  MAINTENANCE_API_KEY?: string;
  UI_BASIC_AUTH?: string;
}
