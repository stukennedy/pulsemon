ALTER TABLE connections ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE connections ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE spans ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE spans ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE events ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE metrics ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE metrics ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE logs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE logs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE voice_turns ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE voice_turns ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE agent_tool_calls ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE agent_tool_calls ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_connections_tenant_started ON connections(workspace_id, project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_spans_tenant_trace ON spans(workspace_id, project_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_tenant_started ON spans(workspace_id, project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_events_tenant_timestamp ON events(workspace_id, project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_timestamp ON metrics(workspace_id, project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_name ON metrics(workspace_id, project_id, metric_name);
CREATE INDEX IF NOT EXISTS idx_logs_tenant_timestamp ON logs(workspace_id, project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_tenant_trace ON logs(workspace_id, project_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_voice_turns_tenant_session ON voice_turns(workspace_id, project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tenant_trace ON agent_tool_calls(workspace_id, project_id, trace_id);
