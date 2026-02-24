import type { Context } from "hono";
import type { Env } from "@/types";
import { checkApiKey } from "@/lib/auth";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function json400(c: Context, msg: string) {
  return c.json({ error: msg }, 400);
}

// ─── Connections ─────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/connections
 * Open (or record) a new connection.
 *
 * Body:
 * {
 *   id?: string,          // optional — generated if omitted
 *   service: string,
 *   connection_type: "ws" | "sse" | "grpc" | string,
 *   client_id?: string,
 *   session_id?: string,
 *   started_at?: string,  // ISO 8601 — defaults to now
 *   status?: string,      // defaults to "active"
 *   metadata?: object
 * }
 */
export const postConnections = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  let body: any;
  try { body = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  if (!body.service) return json400(c, "service is required");
  if (!body.connection_type) return json400(c, "connection_type is required");

  const id = body.id || uuid();
  const started_at = body.started_at || now();
  const metadata = body.metadata ? JSON.stringify(body.metadata) : null;

  await c.env.DB.prepare(
    `INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    id,
    body.service,
    body.connection_type,
    body.client_id ?? null,
    body.session_id ?? null,
    started_at,
    body.status ?? "active",
    metadata
  ).run();

  return c.json({ id }, 201);
};

/**
 * PATCH /api/ingest/connections/:id
 * Update or close an existing connection.
 *
 * Body (all optional):
 * {
 *   ended_at?: string,
 *   duration_ms?: number,
 *   close_reason?: string,
 *   status?: "active" | "closed" | "error",
 *   metadata?: object
 * }
 */
export const patchConnection = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  const id = c.req.param("id");
  let body: any;
  try { body = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(body.ended_at); }
  if (body.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(body.duration_ms); }
  if (body.close_reason !== undefined) { fields.push("close_reason = ?"); values.push(body.close_reason); }
  if (body.status !== undefined) { fields.push("status = ?"); values.push(body.status); }
  if (body.metadata !== undefined) { fields.push("metadata = ?"); values.push(JSON.stringify(body.metadata)); }

  if (fields.length === 0) return json400(c, "No fields to update");

  values.push(id);
  await c.env.DB.prepare(
    `UPDATE connections SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ id });
};

// ─── Spans ───────────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/spans
 * Create a span (start of an operation).
 *
 * Body:
 * {
 *   id?: string,
 *   trace_id: string,
 *   parent_span_id?: string,
 *   connection_id?: string,
 *   service: string,
 *   operation: string,
 *   started_at?: string,
 *   ended_at?: string,
 *   duration_ms?: number,
 *   status?: "ok" | "error",
 *   status_message?: string,
 *   attributes?: object
 * }
 */
export const postSpans = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  let body: any;
  try { body = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  if (!body.trace_id) return json400(c, "trace_id is required");
  if (!body.service) return json400(c, "service is required");
  if (!body.operation) return json400(c, "operation is required");

  const id = body.id || uuid();
  const attributes = body.attributes ? JSON.stringify(body.attributes) : null;

  await c.env.DB.prepare(
    `INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    id,
    body.trace_id,
    body.parent_span_id ?? null,
    body.connection_id ?? null,
    body.service,
    body.operation,
    body.started_at || now(),
    body.ended_at ?? null,
    body.duration_ms ?? null,
    body.status ?? "ok",
    body.status_message ?? null,
    attributes
  ).run();

  return c.json({ id }, 201);
};

/**
 * PATCH /api/ingest/spans/:id
 * Close or update a span.
 *
 * Body (all optional):
 * {
 *   ended_at?: string,
 *   duration_ms?: number,
 *   status?: "ok" | "error",
 *   status_message?: string,
 *   attributes?: object
 * }
 */
export const patchSpan = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  const id = c.req.param("id");
  let body: any;
  try { body = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  const fields: string[] = [];
  const values: any[] = [];

  if (body.ended_at !== undefined) { fields.push("ended_at = ?"); values.push(body.ended_at); }
  if (body.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(body.duration_ms); }
  if (body.status !== undefined) { fields.push("status = ?"); values.push(body.status); }
  if (body.status_message !== undefined) { fields.push("status_message = ?"); values.push(body.status_message); }
  if (body.attributes !== undefined) { fields.push("attributes = ?"); values.push(JSON.stringify(body.attributes)); }

  if (fields.length === 0) return json400(c, "No fields to update");

  values.push(id);
  await c.env.DB.prepare(
    `UPDATE spans SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ id });
};

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/events
 * Record one or more events. Accepts a single object or an array.
 *
 * Event shape:
 * {
 *   id?: string,
 *   connection_id?: string,
 *   span_id?: string,
 *   trace_id?: string,
 *   event_type: string,     // message_sent, message_received, error, state_change, metric, ...
 *   timestamp?: string,
 *   data?: object | string,
 *   direction?: "inbound" | "outbound",
 *   size_bytes?: number
 * }
 */
export const postEvents = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  let raw: any;
  try { raw = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  const items: any[] = Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) return json400(c, "No events provided");
  if (items.length > 500) return json400(c, "Max 500 events per request");

  const stmt = c.env.DB.prepare(
    `INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );

  const batch = items.map((e: any) => {
    if (!e.event_type) throw new Error("event_type is required");
    return stmt.bind(
      e.id || uuid(),
      e.connection_id ?? null,
      e.span_id ?? null,
      e.trace_id ?? null,
      e.event_type,
      e.timestamp || now(),
      e.data !== undefined ? (typeof e.data === "string" ? e.data : JSON.stringify(e.data)) : null,
      e.direction ?? null,
      e.size_bytes ?? null
    );
  });

  try {
    await c.env.DB.batch(batch);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  return c.json({ count: items.length }, 201);
};

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/metrics
 * Record one or more metrics. Accepts a single object or an array.
 *
 * Metric shape:
 * {
 *   id?: string,
 *   service: string,
 *   metric_name: string,
 *   metric_type: "gauge" | "counter" | "histogram",
 *   timestamp?: string,
 *   value: number,
 *   tags?: object
 * }
 */
export const postMetrics = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  let raw: any;
  try { raw = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  const items: any[] = Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) return json400(c, "No metrics provided");
  if (items.length > 500) return json400(c, "Max 500 metrics per request");

  const stmt = c.env.DB.prepare(
    `INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );

  const batch = items.map((m: any) => {
    if (!m.service) throw new Error("service is required");
    if (!m.metric_name) throw new Error("metric_name is required");
    if (!m.metric_type) throw new Error("metric_type is required");
    if (m.value === undefined) throw new Error("value is required");
    return stmt.bind(
      m.id || uuid(),
      m.service,
      m.metric_name,
      m.metric_type,
      m.timestamp || now(),
      m.value,
      m.tags ? JSON.stringify(m.tags) : null
    );
  });

  try {
    await c.env.DB.batch(batch);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  return c.json({ count: items.length }, 201);
};

// ─── Batch ───────────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/batch
 * Send everything in one request. Useful for SDKs that buffer and flush.
 *
 * Body:
 * {
 *   connections?: Connection[],
 *   connection_updates?: { id: string, ...fields }[],
 *   spans?: Span[],
 *   span_updates?: { id: string, ...fields }[],
 *   events?: Event[],
 *   metrics?: Metric[]
 * }
 */
export const postBatch = async (c: Context<{ Bindings: Env }>) => {
  const denied = checkApiKey(c);
  if (denied) return denied;

  let body: any;
  try { body = await c.req.json(); } catch { return json400(c, "Invalid JSON"); }

  const stmts: D1PreparedStatement[] = [];
  const counts: Record<string, number> = {};

  // Connections (inserts)
  for (const conn of (body.connections ?? [])) {
    if (!conn.service || !conn.connection_type) continue;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
      ).bind(
        conn.id || uuid(), conn.service, conn.connection_type,
        conn.client_id ?? null, conn.session_id ?? null,
        conn.started_at || now(), conn.status ?? "active",
        conn.metadata ? JSON.stringify(conn.metadata) : null
      )
    );
    counts.connections = (counts.connections ?? 0) + 1;
  }

  // Connection updates
  for (const upd of (body.connection_updates ?? [])) {
    if (!upd.id) continue;
    const fields: string[] = [];
    const vals: any[] = [];
    if (upd.ended_at !== undefined) { fields.push("ended_at = ?"); vals.push(upd.ended_at); }
    if (upd.duration_ms !== undefined) { fields.push("duration_ms = ?"); vals.push(upd.duration_ms); }
    if (upd.close_reason !== undefined) { fields.push("close_reason = ?"); vals.push(upd.close_reason); }
    if (upd.status !== undefined) { fields.push("status = ?"); vals.push(upd.status); }
    if (upd.metadata !== undefined) { fields.push("metadata = ?"); vals.push(JSON.stringify(upd.metadata)); }
    if (fields.length === 0) continue;
    vals.push(upd.id);
    stmts.push(c.env.DB.prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = ?`).bind(...vals));
    counts.connection_updates = (counts.connection_updates ?? 0) + 1;
  }

  // Spans (inserts)
  for (const span of (body.spans ?? [])) {
    if (!span.trace_id || !span.service || !span.operation) continue;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, ended_at, duration_ms, status, status_message, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
      ).bind(
        span.id || uuid(), span.trace_id, span.parent_span_id ?? null,
        span.connection_id ?? null, span.service, span.operation,
        span.started_at || now(), span.ended_at ?? null,
        span.duration_ms ?? null, span.status ?? "ok",
        span.status_message ?? null,
        span.attributes ? JSON.stringify(span.attributes) : null
      )
    );
    counts.spans = (counts.spans ?? 0) + 1;
  }

  // Span updates
  for (const upd of (body.span_updates ?? [])) {
    if (!upd.id) continue;
    const fields: string[] = [];
    const vals: any[] = [];
    if (upd.ended_at !== undefined) { fields.push("ended_at = ?"); vals.push(upd.ended_at); }
    if (upd.duration_ms !== undefined) { fields.push("duration_ms = ?"); vals.push(upd.duration_ms); }
    if (upd.status !== undefined) { fields.push("status = ?"); vals.push(upd.status); }
    if (upd.status_message !== undefined) { fields.push("status_message = ?"); vals.push(upd.status_message); }
    if (upd.attributes !== undefined) { fields.push("attributes = ?"); vals.push(JSON.stringify(upd.attributes)); }
    if (fields.length === 0) continue;
    vals.push(upd.id);
    stmts.push(c.env.DB.prepare(`UPDATE spans SET ${fields.join(", ")} WHERE id = ?`).bind(...vals));
    counts.span_updates = (counts.span_updates ?? 0) + 1;
  }

  // Events
  const evtStmt = c.env.DB.prepare(
    `INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, data, direction, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  );
  for (const e of (body.events ?? [])) {
    if (!e.event_type) continue;
    stmts.push(evtStmt.bind(
      e.id || uuid(), e.connection_id ?? null, e.span_id ?? null,
      e.trace_id ?? null, e.event_type, e.timestamp || now(),
      e.data !== undefined ? (typeof e.data === "string" ? e.data : JSON.stringify(e.data)) : null,
      e.direction ?? null, e.size_bytes ?? null
    ));
    counts.events = (counts.events ?? 0) + 1;
  }

  // Metrics
  const metStmt = c.env.DB.prepare(
    `INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  );
  for (const m of (body.metrics ?? [])) {
    if (!m.service || !m.metric_name || !m.metric_type || m.value === undefined) continue;
    stmts.push(metStmt.bind(
      m.id || uuid(), m.service, m.metric_name, m.metric_type,
      m.timestamp || now(), m.value,
      m.tags ? JSON.stringify(m.tags) : null
    ));
    counts.metrics = (counts.metrics ?? 0) + 1;
  }

  if (stmts.length === 0) return json400(c, "No valid records in batch");
  if (stmts.length > 1000) return json400(c, "Max 1000 operations per batch");

  await c.env.DB.batch(stmts);

  return c.json({ counts }, 201);
};
