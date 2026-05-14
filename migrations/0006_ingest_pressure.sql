CREATE TABLE IF NOT EXISTS ingest_rate_limits (
  window_start TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (window_start, workspace_id, project_id, scope, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_ingest_rate_limits_window
  ON ingest_rate_limits(window_start);
