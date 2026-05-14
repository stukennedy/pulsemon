CREATE TABLE IF NOT EXISTS monitor_evaluations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  value REAL,
  threshold REAL NOT NULL,
  window_minutes INTEGER NOT NULL,
  description TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_evaluations_tenant_time
  ON monitor_evaluations(workspace_id, project_id, evaluated_at);

CREATE INDEX IF NOT EXISTS idx_monitor_evaluations_monitor_time
  ON monitor_evaluations(workspace_id, project_id, monitor_id, evaluated_at);
