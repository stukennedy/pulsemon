import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  service: text("service").notNull(),
  connection_type: text("connection_type").notNull(), // ws, sse, grpc
  client_id: text("client_id"),
  session_id: text("session_id"),
  started_at: text("started_at").notNull().default(sql`(datetime('now'))`),
  ended_at: text("ended_at"),
  duration_ms: integer("duration_ms"),
  close_reason: text("close_reason"),
  status: text("status").notNull().default("active"), // active, closed, error
  metadata: text("metadata"), // JSON
});

export const spans = sqliteTable("spans", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  trace_id: text("trace_id").notNull(),
  parent_span_id: text("parent_span_id"),
  connection_id: text("connection_id"),
  service: text("service").notNull(),
  operation: text("operation").notNull(),
  started_at: text("started_at").notNull().default(sql`(datetime('now'))`),
  ended_at: text("ended_at"),
  duration_ms: integer("duration_ms"),
  status: text("status").notNull().default("ok"), // ok, error
  status_message: text("status_message"),
  attributes: text("attributes"), // JSON
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  connection_id: text("connection_id"),
  span_id: text("span_id"),
  trace_id: text("trace_id"),
  event_type: text("event_type").notNull(), // message_sent, message_received, error, state_change, metric
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  data: text("data"), // JSON
  direction: text("direction"), // inbound, outbound
  size_bytes: integer("size_bytes"),
});

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  level: text("level").notNull(),
  service: text("service").notNull(),
  message: text("message").notNull(),
  trace_id: text("trace_id"),
  span_id: text("span_id"),
  connection_id: text("connection_id"),
  attributes: text("attributes"),
});

export const metrics = sqliteTable("metrics", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  service: text("service").notNull(),
  metric_name: text("metric_name").notNull(),
  metric_type: text("metric_type").notNull(), // gauge, counter, histogram
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  value: real("value").notNull(),
  tags: text("tags"), // JSON
});

export const voice_turns = sqliteTable("voice_turns", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  connection_id: text("connection_id"),
  session_id: text("session_id"),
  trace_id: text("trace_id"),
  turn_index: integer("turn_index"),
  role: text("role").notNull(),
  started_at: text("started_at").notNull().default(sql`(datetime('now'))`),
  ended_at: text("ended_at"),
  duration_ms: integer("duration_ms"),
  transcript: text("transcript"),
  transcript_confidence: real("transcript_confidence"),
  vad_start_ms: integer("vad_start_ms"),
  vad_end_ms: integer("vad_end_ms"),
  interruption: integer("interruption").notNull().default(0),
  audio_latency_ms: integer("audio_latency_ms"),
  asr_latency_ms: integer("asr_latency_ms"),
  llm_latency_ms: integer("llm_latency_ms"),
  tts_latency_ms: integer("tts_latency_ms"),
  input_tokens: integer("input_tokens"),
  output_tokens: integer("output_tokens"),
  cost_usd: real("cost_usd"),
  state: text("state"),
  metadata: text("metadata"),
});

export const agent_tool_calls = sqliteTable("agent_tool_calls", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  trace_id: text("trace_id"),
  span_id: text("span_id"),
  connection_id: text("connection_id"),
  session_id: text("session_id"),
  turn_id: text("turn_id"),
  tool_name: text("tool_name").notNull(),
  started_at: text("started_at").notNull().default(sql`(datetime('now'))`),
  ended_at: text("ended_at"),
  duration_ms: integer("duration_ms"),
  status: text("status").notNull().default("ok"),
  retry_count: integer("retry_count").notNull().default(0),
  input: text("input"),
  output: text("output"),
  error: text("error"),
  metadata: text("metadata"),
});

export const metric_rollups_1m = sqliteTable("metric_rollups_1m", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  service: text("service").notNull(),
  metric_name: text("metric_name").notNull(),
  metric_type: text("metric_type").notNull(),
  bucket_start: text("bucket_start").notNull(),
  count: integer("count").notNull(),
  avg: real("avg").notNull(),
  min: real("min").notNull(),
  max: real("max").notNull(),
  sum: real("sum").notNull(),
});

export const ingest_rate_limits = sqliteTable("ingest_rate_limits", {
  window_start: text("window_start").notNull(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  scope: text("scope").notNull(),
  token_hash: text("token_hash").notNull(),
  request_count: integer("request_count").notNull().default(0),
});

export const ingest_cardinality_values = sqliteTable("ingest_cardinality_values", {
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  scope: text("scope").notNull(),
  signal: text("signal").notNull(),
  attribute_key: text("attribute_key").notNull(),
  value_hash: text("value_hash").notNull(),
  first_seen_at: text("first_seen_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
});

export const monitor_evaluations = sqliteTable("monitor_evaluations", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  monitor_id: text("monitor_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  value: real("value"),
  threshold: real("threshold").notNull(),
  window_minutes: integer("window_minutes").notNull(),
  description: text("description").notNull(),
  evaluated_at: text("evaluated_at").notNull(),
});

export const monitor_definitions = sqliteTable("monitor_definitions", {
  id: text("id").notNull(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  metric_name: text("metric_name"),
  service: text("service"),
  threshold: real("threshold").notNull(),
  window_minutes: integer("window_minutes").notNull(),
  description: text("description").notNull(),
  enabled: integer("enabled").notNull().default(1),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspace_id, table.project_id, table.id] }),
]);

export const alert_incidents = sqliteTable("alert_incidents", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  monitor_id: text("monitor_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  started_at: text("started_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
  resolved_at: text("resolved_at"),
  last_value: real("last_value"),
  threshold: real("threshold").notNull(),
  notification_count: integer("notification_count").notNull().default(0),
});

export const alert_notifications = sqliteTable("alert_notifications", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  incident_id: text("incident_id").notNull(),
  monitor_id: text("monitor_id").notNull(),
  event_type: text("event_type").notNull(),
  target_url: text("target_url"),
  status: text("status").notNull(),
  response_status: integer("response_status"),
  error: text("error"),
  sent_at: text("sent_at").notNull(),
});

export const audit_events = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  actor: text("actor").notNull(),
  actor_role: text("actor_role").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  target: text("target"),
  ip: text("ip"),
  user_agent: text("user_agent"),
  metadata: text("metadata"),
  created_at: text("created_at").notNull(),
});

export const slo_definitions = sqliteTable("slo_definitions", {
  id: text("id").notNull(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  name: text("name").notNull(),
  metric_name: text("metric_name").notNull(),
  service: text("service"),
  objective_percent: real("objective_percent").notNull(),
  threshold: real("threshold").notNull(),
  window_minutes: integer("window_minutes").notNull(),
  enabled: integer("enabled").notNull().default(1),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspace_id, table.project_id, table.id] }),
]);

export const slo_evaluations = sqliteTable("slo_evaluations", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  slo_id: text("slo_id").notNull(),
  name: text("name").notNull(),
  objective_percent: real("objective_percent").notNull(),
  attainment_percent: real("attainment_percent"),
  error_budget_remaining_percent: real("error_budget_remaining_percent"),
  good_events: integer("good_events").notNull(),
  total_events: integer("total_events").notNull(),
  window_minutes: integer("window_minutes").notNull(),
  evaluated_at: text("evaluated_at").notNull(),
});

export type Connection = typeof connections.$inferSelect;
export type Span = typeof spans.$inferSelect;
export type Event = typeof events.$inferSelect;
export type LogRecord = typeof logs.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type VoiceTurn = typeof voice_turns.$inferSelect;
export type AgentToolCall = typeof agent_tool_calls.$inferSelect;
export type MetricRollup1m = typeof metric_rollups_1m.$inferSelect;
export type IngestRateLimit = typeof ingest_rate_limits.$inferSelect;
export type IngestCardinalityValue = typeof ingest_cardinality_values.$inferSelect;
export type MonitorEvaluationRecord = typeof monitor_evaluations.$inferSelect;
export type MonitorDefinitionRecord = typeof monitor_definitions.$inferSelect;
export type AlertIncident = typeof alert_incidents.$inferSelect;
export type AlertNotification = typeof alert_notifications.$inferSelect;
export type AuditEvent = typeof audit_events.$inferSelect;
export type SloDefinitionRecord = typeof slo_definitions.$inferSelect;
export type SloEvaluationRecord = typeof slo_evaluations.$inferSelect;
