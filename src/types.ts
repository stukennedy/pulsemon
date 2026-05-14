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

export interface Env {
  DB: D1Database;
  SEARCH_SESSION: DurableObjectNamespace;
  INGEST_API_KEY?: string;
  INGEST_API_KEYS?: string;
  INGEST_MAX_BYTES?: string;
  UI_BASIC_AUTH?: string;
}
