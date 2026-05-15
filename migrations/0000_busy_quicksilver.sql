CREATE TABLE `agent_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`trace_id` text,
	`span_id` text,
	`connection_id` text,
	`session_id` text,
	`turn_id` text,
	`tool_name` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`status` text DEFAULT 'ok' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_trace` ON `agent_tool_calls` (`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_span` ON `agent_tool_calls` (`span_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_connection` ON `agent_tool_calls` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_turn` ON `agent_tool_calls` (`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_tool` ON `agent_tool_calls` (`tool_name`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_status` ON `agent_tool_calls` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_tool_calls_tenant_trace` ON `agent_tool_calls` (`workspace_id`,`project_id`,`trace_id`);--> statement-breakpoint
CREATE TABLE `alert_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`resolved_at` text,
	`last_value` real,
	`threshold` real NOT NULL,
	`notification_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_alert_incidents_tenant_status` ON `alert_incidents` (`workspace_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_alert_incidents_monitor_status` ON `alert_incidents` (`workspace_id`,`project_id`,`monitor_id`,`status`);--> statement-breakpoint
CREATE TABLE `alert_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`target_url` text,
	`status` text NOT NULL,
	`response_status` integer,
	`error` text,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_alert_notifications_incident` ON `alert_notifications` (`incident_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `idx_alert_notifications_tenant_time` ON `alert_notifications` (`workspace_id`,`project_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`actor` text NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`target` text,
	`ip` text,
	`user_agent` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_tenant_created` ON `audit_events` (`workspace_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`service` text NOT NULL,
	`connection_type` text NOT NULL,
	`client_id` text,
	`session_id` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`close_reason` text,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_connections_service` ON `connections` (`service`);--> statement-breakpoint
CREATE INDEX `idx_connections_type` ON `connections` (`connection_type`);--> statement-breakpoint
CREATE INDEX `idx_connections_status` ON `connections` (`status`);--> statement-breakpoint
CREATE INDEX `idx_connections_session` ON `connections` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_connections_started` ON `connections` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_connections_tenant_started` ON `connections` (`workspace_id`,`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`connection_id` text,
	`span_id` text,
	`trace_id` text,
	`event_type` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`data` text,
	`direction` text,
	`size_bytes` integer
);
--> statement-breakpoint
CREATE INDEX `idx_events_connection` ON `events` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_events_span` ON `events` (`span_id`);--> statement-breakpoint
CREATE INDEX `idx_events_trace` ON `events` (`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_tenant_timestamp` ON `events` (`workspace_id`,`project_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `ingest_cardinality_values` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`signal` text NOT NULL,
	`attribute_key` text NOT NULL,
	`value_hash` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `scope`, `signal`, `attribute_key`, `value_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_ingest_cardinality_values_key` ON `ingest_cardinality_values` (`workspace_id`,`project_id`,`scope`,`signal`,`attribute_key`);--> statement-breakpoint
CREATE TABLE `ingest_rate_limits` (
	`window_start` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`token_hash` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`window_start`, `workspace_id`, `project_id`, `scope`, `token_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_ingest_rate_limits_window` ON `ingest_rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`level` text NOT NULL,
	`service` text NOT NULL,
	`message` text NOT NULL,
	`trace_id` text,
	`span_id` text,
	`connection_id` text,
	`attributes` text
);
--> statement-breakpoint
CREATE INDEX `idx_logs_timestamp` ON `logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_logs_level` ON `logs` (`level`);--> statement-breakpoint
CREATE INDEX `idx_logs_service` ON `logs` (`service`);--> statement-breakpoint
CREATE INDEX `idx_logs_trace` ON `logs` (`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_span` ON `logs` (`span_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_connection` ON `logs` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_tenant_timestamp` ON `logs` (`workspace_id`,`project_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_logs_tenant_trace` ON `logs` (`workspace_id`,`project_id`,`trace_id`);--> statement-breakpoint
CREATE TABLE `metric_rollups_1m` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`service` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_type` text NOT NULL,
	`bucket_start` text NOT NULL,
	`count` integer NOT NULL,
	`avg` real NOT NULL,
	`min` real NOT NULL,
	`max` real NOT NULL,
	`sum` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_metric_rollups_1m_key` ON `metric_rollups_1m` (`workspace_id`,`project_id`,`service`,`metric_name`,`metric_type`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `idx_metric_rollups_1m_tenant_bucket` ON `metric_rollups_1m` (`workspace_id`,`project_id`,`bucket_start`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`service` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_type` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`count` real,
	`sum` real,
	`min` real,
	`max` real,
	`buckets` text,
	`quantiles` text,
	`tags` text
);
--> statement-breakpoint
CREATE INDEX `idx_metrics_service` ON `metrics` (`service`);--> statement-breakpoint
CREATE INDEX `idx_metrics_name` ON `metrics` (`metric_name`);--> statement-breakpoint
CREATE INDEX `idx_metrics_timestamp` ON `metrics` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_metrics_tenant_timestamp` ON `metrics` (`workspace_id`,`project_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_metrics_tenant_name` ON `metrics` (`workspace_id`,`project_id`,`metric_name`);--> statement-breakpoint
CREATE TABLE `monitor_definitions` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`metric_name` text,
	`service` text,
	`threshold` real NOT NULL,
	`window_minutes` integer NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_monitor_definitions_tenant_enabled` ON `monitor_definitions` (`workspace_id`,`project_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `monitor_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`value` real,
	`threshold` real NOT NULL,
	`window_minutes` integer NOT NULL,
	`description` text NOT NULL,
	`evaluated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_monitor_evaluations_tenant_time` ON `monitor_evaluations` (`workspace_id`,`project_id`,`evaluated_at`);--> statement-breakpoint
CREATE INDEX `idx_monitor_evaluations_monitor_time` ON `monitor_evaluations` (`workspace_id`,`project_id`,`monitor_id`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `slo_definitions` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`metric_name` text NOT NULL,
	`service` text,
	`objective_percent` real NOT NULL,
	`threshold` real NOT NULL,
	`window_minutes` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_slo_definitions_tenant_enabled` ON `slo_definitions` (`workspace_id`,`project_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `slo_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`slo_id` text NOT NULL,
	`name` text NOT NULL,
	`objective_percent` real NOT NULL,
	`attainment_percent` real,
	`error_budget_remaining_percent` real,
	`good_events` integer NOT NULL,
	`total_events` integer NOT NULL,
	`window_minutes` integer NOT NULL,
	`evaluated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_slo_evaluations_tenant_slo_time` ON `slo_evaluations` (`workspace_id`,`project_id`,`slo_id`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `spans` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`trace_id` text NOT NULL,
	`parent_span_id` text,
	`connection_id` text,
	`service` text NOT NULL,
	`operation` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`status` text DEFAULT 'ok' NOT NULL,
	`status_message` text,
	`attributes` text
);
--> statement-breakpoint
CREATE INDEX `idx_spans_trace` ON `spans` (`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_spans_connection` ON `spans` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_spans_service` ON `spans` (`service`);--> statement-breakpoint
CREATE INDEX `idx_spans_operation` ON `spans` (`operation`);--> statement-breakpoint
CREATE INDEX `idx_spans_status` ON `spans` (`status`);--> statement-breakpoint
CREATE INDEX `idx_spans_started` ON `spans` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_spans_tenant_trace` ON `spans` (`workspace_id`,`project_id`,`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_spans_tenant_started` ON `spans` (`workspace_id`,`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `voice_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`connection_id` text,
	`session_id` text,
	`trace_id` text,
	`turn_index` integer,
	`role` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`transcript` text,
	`transcript_confidence` real,
	`vad_start_ms` integer,
	`vad_end_ms` integer,
	`interruption` integer DEFAULT 0 NOT NULL,
	`audio_latency_ms` integer,
	`asr_latency_ms` integer,
	`llm_latency_ms` integer,
	`tts_latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`state` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_voice_turns_connection` ON `voice_turns` (`connection_id`);--> statement-breakpoint
CREATE INDEX `idx_voice_turns_session` ON `voice_turns` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_voice_turns_trace` ON `voice_turns` (`trace_id`);--> statement-breakpoint
CREATE INDEX `idx_voice_turns_started` ON `voice_turns` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_voice_turns_tenant_session` ON `voice_turns` (`workspace_id`,`project_id`,`session_id`);