import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { loadRoutes } from "@/router";
import { loadLayouts } from "@/layouts";
import { checkUiAuth } from "@/lib/auth";
import type { Env } from "@/types";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../migrations");

function createD1Shim(sqlite: Database): D1Database {
  return {
    prepare(query: string) {
      return {
        _query: query,
        _bindings: [] as any[],
        bind(...args: any[]) {
          this._bindings = args;
          return this;
        },
        async all<T = any>() {
          const stmt = sqlite.prepare(this._query);
          const rows = stmt.all(...this._bindings);
          return { results: rows as T[], success: true, meta: {} };
        },
        async first<T = any>(col?: string) {
          const stmt = sqlite.prepare(this._query);
          const row = stmt.get(...this._bindings) as any;
          if (col && row) return row[col] as T;
          return (row ?? null) as T;
        },
        async run() {
          const stmt = sqlite.prepare(this._query);
          const info = stmt.run(...this._bindings);
          return { results: [], success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
        async raw<T = any>() {
          const stmt = sqlite.prepare(this._query);
          const rows = stmt.all(...this._bindings);
          return rows.map((r: any) => Object.values(r)) as T[];
        },
      } as any;
    },
    async dump() { return new ArrayBuffer(0); },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s: any) => s.all())); },
    async exec(query: string) { sqlite.exec(query); return { count: 0, duration: 0 }; },
  } as any;
}

export interface TestContext {
  app: Hono<{ Bindings: Env }>;
  sqlite: Database;
  d1: D1Database;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  seedConnection: (overrides?: Partial<{
    id: string; service: string; connection_type: string; client_id: string;
    session_id: string; started_at: string; duration_ms: number; status: string;
    close_reason: string;
  }>) => void;
  seedSpan: (overrides?: Partial<{
    id: string; trace_id: string; parent_span_id: string; connection_id: string;
    service: string; operation: string; started_at: string; duration_ms: number;
    status: string; status_message: string; attributes: string;
  }>) => void;
  seedEvent: (overrides?: Partial<{
    id: string; connection_id: string; span_id: string; trace_id: string;
    event_type: string; timestamp: string; direction: string; size_bytes: number;
  }>) => void;
  seedLog: (overrides?: Partial<{
    id: string; timestamp: string; level: string; service: string; message: string;
    trace_id: string; span_id: string; connection_id: string; attributes: string;
  }>) => void;
  seedMetric: (overrides?: Partial<{
    id: string; service: string; metric_name: string; metric_type: string;
    timestamp: string; value: number; tags: string;
  }>) => void;
}

export interface TestContextOptions {
  env?: Partial<Env>;
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");

  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8"));
  }

  const d1 = createD1Shim(sqlite);
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (c, next) => {
    (c.env as any) = {
      ...c.env,
      DB: d1,
      INGEST_API_KEY: "test-key",
      SEARCH_SESSION: {
        idFromName: () => ({ toString: () => "test-id" }),
        get: () => ({ fetch: () => new Response("ws mock", { status: 101 }) }),
      },
      ...options.env,
    };
    await next();
  });

  app.use("*", async (c, next) => {
    const authResponse = checkUiAuth(c);
    if (authResponse) return authResponse;
    await next();
  });

  loadLayouts(app);
  loadRoutes(app);

  let seq = 0;

  const seedConnection = (overrides?: any) => {
    seq++;
    sqlite.prepare(`
      INSERT INTO connections (id, service, connection_type, client_id, session_id, started_at, duration_ms, status, close_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides?.id ?? `conn-${seq}`,
      overrides?.service ?? "voice-gateway",
      overrides?.connection_type ?? "ws",
      overrides?.client_id ?? `client-${seq}`,
      overrides?.session_id ?? `session-${seq}`,
      overrides?.started_at ?? new Date(Date.now() - seq * 60000).toISOString(),
      overrides?.duration_ms ?? 5000 + seq * 100,
      overrides?.status ?? "closed",
      overrides?.close_reason ?? null,
    );
  };

  const seedSpan = (overrides?: any) => {
    seq++;
    sqlite.prepare(`
      INSERT INTO spans (id, trace_id, parent_span_id, connection_id, service, operation, started_at, duration_ms, status, status_message, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides?.id ?? `span-${seq}`,
      overrides?.trace_id ?? `trace-${seq}`,
      overrides?.parent_span_id ?? null,
      overrides?.connection_id ?? null,
      overrides?.service ?? "asr-service",
      overrides?.operation ?? "asr.transcribe",
      overrides?.started_at ?? new Date(Date.now() - seq * 1000).toISOString(),
      overrides?.duration_ms ?? 400,
      overrides?.status ?? "ok",
      overrides?.status_message ?? null,
      overrides?.attributes ?? null,
    );
  };

  const seedEvent = (overrides?: any) => {
    seq++;
    sqlite.prepare(`
      INSERT INTO events (id, connection_id, span_id, trace_id, event_type, timestamp, direction, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides?.id ?? `event-${seq}`,
      overrides?.connection_id ?? null,
      overrides?.span_id ?? null,
      overrides?.trace_id ?? null,
      overrides?.event_type ?? "message_received",
      overrides?.timestamp ?? new Date(Date.now() - seq * 1000).toISOString(),
      overrides?.direction ?? "inbound",
      overrides?.size_bytes ?? 256,
    );
  };

  const seedLog = (overrides?: any) => {
    seq++;
    sqlite.prepare(`
      INSERT INTO logs (id, timestamp, level, service, message, trace_id, span_id, connection_id, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides?.id ?? `log-${seq}`,
      overrides?.timestamp ?? new Date(Date.now() - seq * 1000).toISOString(),
      overrides?.level ?? "info",
      overrides?.service ?? "voice-gateway",
      overrides?.message ?? "session event",
      overrides?.trace_id ?? null,
      overrides?.span_id ?? null,
      overrides?.connection_id ?? null,
      overrides?.attributes ?? null,
    );
  };

  const seedMetric = (overrides?: any) => {
    seq++;
    sqlite.prepare(`
      INSERT INTO metrics (id, service, metric_name, metric_type, timestamp, value, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides?.id ?? `metric-${seq}`,
      overrides?.service ?? "voice-gateway",
      overrides?.metric_name ?? "voice.latency_ms",
      overrides?.metric_type ?? "histogram",
      overrides?.timestamp ?? new Date(Date.now() - seq * 1000).toISOString(),
      overrides?.value ?? 100 + seq,
      overrides?.tags ?? null,
    );
  };

  const request = async (path: string, init?: RequestInit) => app.request(path, init);

  return { app, sqlite, d1, request, seedConnection, seedSpan, seedEvent, seedLog, seedMetric };
}
