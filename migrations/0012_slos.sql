CREATE TABLE IF NOT EXISTS slo_definitions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  service TEXT,
  objective_percent REAL NOT NULL,
  threshold REAL NOT NULL,
  window_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_slo_definitions_tenant_enabled
  ON slo_definitions(workspace_id, project_id, enabled);

CREATE TABLE IF NOT EXISTS slo_evaluations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective_percent REAL NOT NULL,
  attainment_percent REAL,
  error_budget_remaining_percent REAL,
  good_events INTEGER NOT NULL,
  total_events INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slo_evaluations_tenant_slo_time
  ON slo_evaluations(workspace_id, project_id, slo_id, evaluated_at DESC);
