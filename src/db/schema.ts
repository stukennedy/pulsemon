import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
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
}, (table) => [
  index("idx_connections_service").on(table.service),
  index("idx_connections_type").on(table.connection_type),
  index("idx_connections_status").on(table.status),
  index("idx_connections_session").on(table.session_id),
  index("idx_connections_started").on(table.started_at),
  index("idx_connections_tenant_started").on(table.workspace_id, table.project_id, table.started_at),
]);

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
}, (table) => [
  index("idx_spans_trace").on(table.trace_id),
  index("idx_spans_connection").on(table.connection_id),
  index("idx_spans_service").on(table.service),
  index("idx_spans_operation").on(table.operation),
  index("idx_spans_status").on(table.status),
  index("idx_spans_started").on(table.started_at),
  index("idx_spans_tenant_trace").on(table.workspace_id, table.project_id, table.trace_id),
  index("idx_spans_tenant_started").on(table.workspace_id, table.project_id, table.started_at),
]);

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
}, (table) => [
  index("idx_events_connection").on(table.connection_id),
  index("idx_events_span").on(table.span_id),
  index("idx_events_trace").on(table.trace_id),
  index("idx_events_type").on(table.event_type),
  index("idx_events_timestamp").on(table.timestamp),
  index("idx_events_tenant_timestamp").on(table.workspace_id, table.project_id, table.timestamp),
]);

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
}, (table) => [
  index("idx_logs_timestamp").on(table.timestamp),
  index("idx_logs_level").on(table.level),
  index("idx_logs_service").on(table.service),
  index("idx_logs_trace").on(table.trace_id),
  index("idx_logs_span").on(table.span_id),
  index("idx_logs_connection").on(table.connection_id),
  index("idx_logs_tenant_timestamp").on(table.workspace_id, table.project_id, table.timestamp),
  index("idx_logs_tenant_trace").on(table.workspace_id, table.project_id, table.trace_id),
]);

export const metrics = sqliteTable("metrics", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").notNull().default("default"),
  project_id: text("project_id").notNull().default("default"),
  service: text("service").notNull(),
  metric_name: text("metric_name").notNull(),
  metric_type: text("metric_type").notNull(), // gauge, counter, histogram
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  value: real("value").notNull(),
  unit: text("unit"),
  count: real("count"),
  sum: real("sum"),
  min: real("min"),
  max: real("max"),
  buckets: text("buckets"), // JSON
  quantiles: text("quantiles"), // JSON
  tags: text("tags"), // JSON
}, (table) => [
  index("idx_metrics_service").on(table.service),
  index("idx_metrics_name").on(table.metric_name),
  index("idx_metrics_timestamp").on(table.timestamp),
  index("idx_metrics_tenant_timestamp").on(table.workspace_id, table.project_id, table.timestamp),
  index("idx_metrics_tenant_name").on(table.workspace_id, table.project_id, table.metric_name),
]);

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
}, (table) => [
  index("idx_voice_turns_connection").on(table.connection_id),
  index("idx_voice_turns_session").on(table.session_id),
  index("idx_voice_turns_trace").on(table.trace_id),
  index("idx_voice_turns_started").on(table.started_at),
  index("idx_voice_turns_tenant_session").on(table.workspace_id, table.project_id, table.session_id),
  // Recent-turns feeds, stage percentiles, SLO/monitor evaluations, and
  // baseline queries all scan by tenant and recency.
  index("idx_voice_turns_tenant_started").on(table.workspace_id, table.project_id, table.started_at),
]);

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
}, (table) => [
  index("idx_agent_tool_calls_trace").on(table.trace_id),
  index("idx_agent_tool_calls_span").on(table.span_id),
  index("idx_agent_tool_calls_connection").on(table.connection_id),
  index("idx_agent_tool_calls_turn").on(table.turn_id),
  index("idx_agent_tool_calls_tool").on(table.tool_name),
  index("idx_agent_tool_calls_status").on(table.status),
  index("idx_agent_tool_calls_tenant_trace").on(table.workspace_id, table.project_id, table.trace_id),
  // Same recency pattern as voice_turns: tool error-rate SLO/monitor windows.
  index("idx_agent_tool_calls_tenant_started").on(table.workspace_id, table.project_id, table.started_at),
]);

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
}, (table) => [
  uniqueIndex("idx_metric_rollups_1m_key").on(
    table.workspace_id,
    table.project_id,
    table.service,
    table.metric_name,
    table.metric_type,
    table.bucket_start
  ),
  index("idx_metric_rollups_1m_tenant_bucket").on(table.workspace_id, table.project_id, table.bucket_start),
]);

export const ingest_rate_limits = sqliteTable("ingest_rate_limits", {
  window_start: text("window_start").notNull(),
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  scope: text("scope").notNull(),
  token_hash: text("token_hash").notNull(),
  request_count: integer("request_count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.window_start, table.workspace_id, table.project_id, table.scope, table.token_hash] }),
  index("idx_ingest_rate_limits_window").on(table.window_start),
]);

export const ingest_cardinality_values = sqliteTable("ingest_cardinality_values", {
  workspace_id: text("workspace_id").notNull(),
  project_id: text("project_id").notNull(),
  scope: text("scope").notNull(),
  signal: text("signal").notNull(),
  attribute_key: text("attribute_key").notNull(),
  value_hash: text("value_hash").notNull(),
  first_seen_at: text("first_seen_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
}, (table) => [
  primaryKey({
    columns: [
      table.workspace_id,
      table.project_id,
      table.scope,
      table.signal,
      table.attribute_key,
      table.value_hash,
    ],
  }),
  index("idx_ingest_cardinality_values_key").on(
    table.workspace_id,
    table.project_id,
    table.scope,
    table.signal,
    table.attribute_key
  ),
]);

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
}, (table) => [
  index("idx_monitor_evaluations_tenant_time").on(table.workspace_id, table.project_id, table.evaluated_at),
  index("idx_monitor_evaluations_monitor_time").on(table.workspace_id, table.project_id, table.monitor_id, table.evaluated_at),
]);

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
  index("idx_monitor_definitions_tenant_enabled").on(table.workspace_id, table.project_id, table.enabled),
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
}, (table) => [
  index("idx_alert_incidents_tenant_status").on(table.workspace_id, table.project_id, table.status),
  index("idx_alert_incidents_monitor_status").on(table.workspace_id, table.project_id, table.monitor_id, table.status),
]);

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
}, (table) => [
  index("idx_alert_notifications_incident").on(table.incident_id, table.sent_at),
  index("idx_alert_notifications_tenant_time").on(table.workspace_id, table.project_id, table.sent_at),
]);

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
}, (table) => [
  index("idx_audit_events_tenant_created").on(table.workspace_id, table.project_id, table.created_at),
]);

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
  index("idx_slo_definitions_tenant_enabled").on(table.workspace_id, table.project_id, table.enabled),
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
}, (table) => [
  index("idx_slo_evaluations_tenant_slo_time").on(table.workspace_id, table.project_id, table.slo_id, table.evaluated_at),
]);

export type Connection = typeof connections.$inferSelect;
export type ConnectionInsert = typeof connections.$inferInsert;
export type Span = typeof spans.$inferSelect;
export type SpanInsert = typeof spans.$inferInsert;
export type Event = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;
export type LogRecord = typeof logs.$inferSelect;
export type LogInsert = typeof logs.$inferInsert;
export type Metric = typeof metrics.$inferSelect;
export type MetricInsert = typeof metrics.$inferInsert;
export type VoiceTurn = typeof voice_turns.$inferSelect;
export type VoiceTurnInsert = typeof voice_turns.$inferInsert;
export type AgentToolCall = typeof agent_tool_calls.$inferSelect;
export type AgentToolCallInsert = typeof agent_tool_calls.$inferInsert;
export type MetricRollup1m = typeof metric_rollups_1m.$inferSelect;
export type MetricRollup1mInsert = typeof metric_rollups_1m.$inferInsert;
export type IngestRateLimit = typeof ingest_rate_limits.$inferSelect;
export type IngestRateLimitInsert = typeof ingest_rate_limits.$inferInsert;
export type IngestCardinalityValue = typeof ingest_cardinality_values.$inferSelect;
export type IngestCardinalityValueInsert = typeof ingest_cardinality_values.$inferInsert;
export type MonitorEvaluationRecord = typeof monitor_evaluations.$inferSelect;
export type MonitorEvaluationInsert = typeof monitor_evaluations.$inferInsert;
export type MonitorDefinitionRecord = typeof monitor_definitions.$inferSelect;
export type MonitorDefinitionInsert = typeof monitor_definitions.$inferInsert;
export type AlertIncident = typeof alert_incidents.$inferSelect;
export type AlertIncidentInsert = typeof alert_incidents.$inferInsert;
export type AlertNotification = typeof alert_notifications.$inferSelect;
export type AlertNotificationInsert = typeof alert_notifications.$inferInsert;
export type AuditEvent = typeof audit_events.$inferSelect;
export type AuditEventInsert = typeof audit_events.$inferInsert;
export type SloDefinitionRecord = typeof slo_definitions.$inferSelect;
export type SloDefinitionInsert = typeof slo_definitions.$inferInsert;
export type SloEvaluationRecord = typeof slo_evaluations.$inferSelect;
export type SloEvaluationInsert = typeof slo_evaluations.$inferInsert;
