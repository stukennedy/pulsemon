CREATE TABLE `browser_batches` (
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`received_at` text NOT NULL,
	`replay_key` text,
	`replay_bytes` integer DEFAULT 0 NOT NULL,
	`first_event_at` integer,
	`last_event_at` integer,
	PRIMARY KEY(`workspace_id`, `project_id`, `session_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `idx_browser_batches_tenant_received` ON `browser_batches` (`workspace_id`,`project_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `browser_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`type` text NOT NULL,
	`path` text NOT NULL,
	`device` text NOT NULL,
	`selector` text,
	`x` real,
	`y` real,
	`viewport_w` integer,
	`viewport_h` integer,
	`doc_h` integer,
	`depth` real,
	`message` text,
	`source` text,
	`name` text,
	`props` text
);
--> statement-breakpoint
CREATE INDEX `idx_browser_events_tenant_path_type` ON `browser_events` (`workspace_id`,`project_id`,`path`,`type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_browser_events_tenant_session` ON `browser_events` (`workspace_id`,`project_id`,`session_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_browser_events_tenant_timestamp` ON `browser_events` (`workspace_id`,`project_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `browser_sessions` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`started_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`user_id` text,
	`entry_path` text NOT NULL,
	`exit_path` text NOT NULL,
	`device` text NOT NULL,
	`viewport_w` integer NOT NULL,
	`viewport_h` integer NOT NULL,
	`user_agent` text,
	`country` text,
	`page_views` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`rage_clicks` integer DEFAULT 0 NOT NULL,
	`dead_clicks` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`replay_chunks` integer DEFAULT 0 NOT NULL,
	`replay_bytes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `project_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_browser_sessions_tenant_last_seen` ON `browser_sessions` (`workspace_id`,`project_id`,`last_seen_at`);