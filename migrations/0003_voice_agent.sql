CREATE TABLE IF NOT EXISTS voice_turns (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  session_id TEXT,
  trace_id TEXT,
  turn_index INTEGER,
  role TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_ms INTEGER,
  transcript TEXT,
  transcript_confidence REAL,
  vad_start_ms INTEGER,
  vad_end_ms INTEGER,
  interruption INTEGER NOT NULL DEFAULT 0,
  audio_latency_ms INTEGER,
  asr_latency_ms INTEGER,
  llm_latency_ms INTEGER,
  tts_latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  state TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  span_id TEXT,
  connection_id TEXT,
  session_id TEXT,
  turn_id TEXT,
  tool_name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  retry_count INTEGER NOT NULL DEFAULT 0,
  input TEXT,
  output TEXT,
  error TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_turns_connection ON voice_turns(connection_id);
CREATE INDEX IF NOT EXISTS idx_voice_turns_session ON voice_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_voice_turns_trace ON voice_turns(trace_id);
CREATE INDEX IF NOT EXISTS idx_voice_turns_started ON voice_turns(started_at);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_trace ON agent_tool_calls(trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_span ON agent_tool_calls(span_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_connection ON agent_tool_calls(connection_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_turn ON agent_tool_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tool ON agent_tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_status ON agent_tool_calls(status);
