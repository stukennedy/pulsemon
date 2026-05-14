import { Effect } from "effect";
import type { AuditEvent, TenantScope } from "@/types";
import { DatabaseError, ValidationError } from "./errors";

export interface AuditEventInput {
  readonly actor: string;
  readonly actor_role: string;
  readonly action: string;
  readonly outcome: string;
  readonly target?: string;
  readonly ip?: string;
  readonly user_agent?: string;
  readonly metadata?: unknown;
}

export interface AuditQuery {
  readonly limit?: number;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function boundedLimit(limit: number | undefined): Effect.Effect<number, ValidationError> {
  if (limit === undefined) return Effect.succeed(100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return Effect.fail(new ValidationError({ message: "limit must be an integer between 1 and 500" }));
  }
  return Effect.succeed(limit);
}

export function recordAuditEvent(
  db: D1Database,
  tenant: TenantScope,
  input: AuditEventInput
): Effect.Effect<void, DatabaseError> {
  return dbEffect(() => db.prepare(
    `INSERT INTO audit_events (
       id,
       workspace_id,
       project_id,
       actor,
       actor_role,
       action,
       outcome,
       target,
       ip,
       user_agent,
       metadata,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uuid(),
    tenant.workspace_id,
    tenant.project_id,
    input.actor,
    input.actor_role,
    input.action,
    input.outcome,
    input.target ?? null,
    input.ip ?? null,
    input.user_agent ?? null,
    optionalJson(input.metadata),
    now()
  ).run()).pipe(Effect.asVoid);
}

export function queryAuditEvents(
  db: D1Database,
  tenant: TenantScope,
  query: AuditQuery = {}
): Effect.Effect<readonly AuditEvent[], DatabaseError | ValidationError> {
  return Effect.gen(function* () {
    const limit = yield* boundedLimit(query.limit);
    const rows = yield* dbEffect(() => db.prepare(
      `SELECT *
       FROM audit_events
       WHERE workspace_id = ?
         AND project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(tenant.workspace_id, tenant.project_id, limit).all<AuditEvent>());

    return rows.results;
  });
}
