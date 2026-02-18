/**
 * Generate realistic seed data for Pulsemon.
 * Run: bun scripts/generate-seed.ts > seed.sql
 */

const SERVICES = ["asr-service", "llm-service", "tts-service", "voice-gateway", "session-manager"];
const CONN_TYPES = ["ws", "sse", "grpc"];

function id() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isoDate(offset_hours: number): string {
  const d = new Date(Date.now() - offset_hours * 3600 * 1000 - randInt(0, 3600000));
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function esc(s: string) {
  return s.replace(/'/g, "''");
}

const lines: string[] = [];

lines.push("-- Pulsemon Seed Data");
lines.push("-- Generated: " + new Date().toISOString());
lines.push("");

// Generate 50 sessions, each with connections, spans, and events
for (let session = 0; session < 50; session++) {
  const sessionId = id();
  const clientId = `client-${randInt(1, 20)}`;
  const hoursAgo = randInt(0, 336); // up to 14 days
  const isError = Math.random() < 0.12;

  // Connection: client → voice-gateway (WebSocket)
  const connId = id();
  const connDuration = isError ? randInt(100, 5000) : randInt(5000, 120000);
  const connStatus = isError ? "error" : Math.random() < 0.3 ? "active" : "closed";
  const connStart = isoDate(hoursAgo);
  const connEnd = connStatus === "active" ? "NULL" : `'${isoDate(hoursAgo - 0.01)}'`;
  const closeReason = isError ? `'${randChoice(["timeout", "connection_reset", "server_error"])}'` : connStatus === "closed" ? "'normal_closure'" : "NULL";

  lines.push(`INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, ended_at, duration_ms, close_reason, status, metadata) VALUES ('${connId}', 'voice-gateway', 'ws', '${clientId}', '${sessionId}', '${connStart}', ${connEnd}, ${connDuration}, ${closeReason}, '${connStatus}', '${esc(JSON.stringify({ user_agent: "PulsemonSDK/1.0" }))}');`);

  // Internal gRPC connections
  for (const svc of ["asr-service", "llm-service", "tts-service"]) {
    const intConnId = id();
    const intDuration = randInt(200, 60000);
    lines.push(`INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, ended_at, duration_ms, status) VALUES ('${intConnId}', '${svc}', 'grpc', 'voice-gateway', '${sessionId}', '${connStart}', '${isoDate(hoursAgo - 0.005)}', ${intDuration}, '${isError && svc === randChoice(["asr-service", "llm-service"]) ? "error" : "closed"}');`);
  }

  // SSE connection: gateway → client
  const sseConnId = id();
  lines.push(`INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, ended_at, duration_ms, status) VALUES ('${sseConnId}', 'voice-gateway', 'sse', '${clientId}', '${sessionId}', '${connStart}', ${connEnd}, ${connDuration}, '${connStatus}');`);

  // Trace: full voice pipeline
  const traceId = id();

  // Root span: session.handle
  const rootSpanId = id();
  const rootDuration = randInt(800, 5000);
  lines.push(`INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, attributes) VALUES ('${rootSpanId}', '${traceId}', NULL, '${connId}', 'session-manager', 'session.handle', '${connStart}', '${isoDate(hoursAgo - 0.001)}', ${rootDuration}, '${isError ? "error" : "ok"}', '${esc(JSON.stringify({ session_id: sessionId }))}');`);

  // ASR span
  const asrSpanId = id();
  const asrDuration = randInt(200, 800);
  const asrStatus = isError && Math.random() < 0.3 ? "error" : "ok";
  lines.push(`INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes) VALUES ('${asrSpanId}', '${traceId}', '${rootSpanId}', '${connId}', 'asr-service', 'asr.transcribe', '${connStart}', '${isoDate(hoursAgo - 0.0002)}', ${asrDuration}, '${asrStatus}', ${asrStatus === "error" ? "'ASR timeout'" : "NULL"}, '${esc(JSON.stringify({ model: "whisper-large-v3", language: "en", provider: "openai" }))}');`);

  // LLM span
  const llmSpanId = id();
  const llmDuration = randInt(300, 2000);
  const llmStatus = isError && Math.random() < 0.4 ? "error" : "ok";
  const llmTokens = randInt(50, 500);
  lines.push(`INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes) VALUES ('${llmSpanId}', '${traceId}', '${rootSpanId}', '${connId}', 'llm-service', 'llm.generate', '${isoDate(hoursAgo - 0.0002)}', '${isoDate(hoursAgo - 0.0005)}', ${llmDuration}, '${llmStatus}', ${llmStatus === "error" ? `'${randChoice(["model_overloaded", "context_length_exceeded", "rate_limited"])}'` : "NULL"}, '${esc(JSON.stringify({ model: randChoice(["gpt-4o", "claude-sonnet-4-20250514", "gemini-pro"]), tokens: llmTokens, provider: randChoice(["openai", "anthropic", "google"]) }))}');`);

  // TTS span
  const ttsSpanId = id();
  const ttsDuration = randInt(100, 500);
  lines.push(`INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, attributes) VALUES ('${ttsSpanId}', '${traceId}', '${rootSpanId}', '${connId}', 'tts-service', 'tts.synthesize', '${isoDate(hoursAgo - 0.0005)}', '${isoDate(hoursAgo - 0.0007)}', ${ttsDuration}, 'ok', '${esc(JSON.stringify({ voice: randChoice(["alloy", "nova", "shimmer"]), model: "tts-1-hd", provider: "elevenlabs" }))}');`);

  // Events for the connection
  const eventTypes = ["message_received", "message_sent", "state_change"];
  const numEvents = randInt(3, 15);
  for (let e = 0; e < numEvents; e++) {
    const eventId = id();
    const eventType = randChoice(eventTypes);
    const direction = eventType === "message_received" ? "inbound" : eventType === "message_sent" ? "outbound" : null;
    const sizeBytes = direction ? randInt(50, 5000) : null;
    lines.push(`INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes) VALUES ('${eventId}', '${connId}', ${Math.random() < 0.5 ? `'${asrSpanId}'` : "NULL"}, '${traceId}', '${eventType}', '${isoDate(hoursAgo - e * 0.0001)}', '${esc(JSON.stringify({ type: eventType }))}', ${direction ? `'${direction}'` : "NULL"}, ${sizeBytes ?? "NULL"});`);
  }

  // Error event if session errored
  if (isError) {
    lines.push(`INSERT INTO events (id, connection_id, trace_id, event_type, timestamp, data) VALUES ('${id()}', '${connId}', '${traceId}', 'error', '${isoDate(hoursAgo - 0.001)}', '${esc(JSON.stringify({ error: randChoice(["timeout", "connection_reset", "model_error"]), message: "Operation failed" }))}');`);
  }

  // Metrics
  for (const [name, val] of [
    ["asr.latency_ms", asrDuration],
    ["llm.latency_ms", llmDuration],
    ["tts.latency_ms", ttsDuration],
    ["connection.duration_ms", connDuration],
  ]) {
    lines.push(`INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags) VALUES ('${id()}', '${name.toString().split(".")[0] === "connection" ? "voice-gateway" : name.toString().split(".")[0] + "-service"}', '${name}', '${name.toString().includes("latency") ? "histogram" : "gauge"}', '${connStart}', ${val}, '${esc(JSON.stringify({ session_id: sessionId }))}');`);
  }
}

console.log(lines.join("\n"));
