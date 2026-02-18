CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  client_id TEXT,
  session_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_ms INTEGER,
  close_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  connection_id TEXT,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  status_message TEXT,
  attributes TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  span_id TEXT,
  trace_id TEXT,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT,
  direction TEXT,
  size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  value REAL NOT NULL,
  tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_connections_service ON connections(service);
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(connection_type);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
CREATE INDEX IF NOT EXISTS idx_connections_session ON connections(session_id);
CREATE INDEX IF NOT EXISTS idx_connections_started ON connections(started_at);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_connection ON spans(connection_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service);
CREATE INDEX IF NOT EXISTS idx_spans_operation ON spans(operation);
CREATE INDEX IF NOT EXISTS idx_spans_status ON spans(status);
CREATE INDEX IF NOT EXISTS idx_spans_started ON spans(started_at);

CREATE INDEX IF NOT EXISTS idx_events_connection ON events(connection_id);
CREATE INDEX IF NOT EXISTS idx_events_span ON events(span_id);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics(service);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
