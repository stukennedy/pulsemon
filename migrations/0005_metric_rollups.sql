CREATE TABLE IF NOT EXISTS metric_rollups_1m (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  project_id TEXT NOT NULL DEFAULT 'default',
  service TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  bucket_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  avg REAL NOT NULL,
  min REAL NOT NULL,
  max REAL NOT NULL,
  sum REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_rollups_1m_key
  ON metric_rollups_1m(workspace_id, project_id, service, metric_name, metric_type, bucket_start);

CREATE INDEX IF NOT EXISTS idx_metric_rollups_1m_tenant_bucket
  ON metric_rollups_1m(workspace_id, project_id, bucket_start);
