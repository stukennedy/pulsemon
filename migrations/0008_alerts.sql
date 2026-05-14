CREATE TABLE IF NOT EXISTS alert_incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  last_value REAL,
  threshold REAL NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_tenant_status
  ON alert_incidents(workspace_id, project_id, status);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_monitor_status
  ON alert_incidents(workspace_id, project_id, monitor_id, status);

CREATE TABLE IF NOT EXISTS alert_notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL,
  response_status INTEGER,
  error TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_incident
  ON alert_notifications(incident_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_tenant_time
  ON alert_notifications(workspace_id, project_id, sent_at);
