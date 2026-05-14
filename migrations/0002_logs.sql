CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  connection_id TEXT,
  attributes TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_span ON logs(span_id);
CREATE INDEX IF NOT EXISTS idx_logs_connection ON logs(connection_id);
