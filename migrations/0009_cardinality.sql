CREATE TABLE IF NOT EXISTS ingest_cardinality_values (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  signal TEXT NOT NULL,
  attribute_key TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id, scope, signal, attribute_key, value_hash)
);

CREATE INDEX IF NOT EXISTS idx_ingest_cardinality_values_key
  ON ingest_cardinality_values(workspace_id, project_id, scope, signal, attribute_key);
