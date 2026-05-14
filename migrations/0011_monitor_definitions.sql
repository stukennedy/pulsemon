CREATE TABLE IF NOT EXISTS monitor_definitions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  metric_name TEXT,
  service TEXT,
  threshold REAL NOT NULL,
  window_minutes INTEGER NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_definitions_tenant_enabled
  ON monitor_definitions(workspace_id, project_id, enabled);
