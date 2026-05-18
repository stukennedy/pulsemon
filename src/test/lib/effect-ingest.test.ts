import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { DatabaseError } from "@/lib/effect/errors";
import { DEFAULT_INGEST_GOVERNANCE_CONFIG, type IngestGovernanceConfig } from "@/lib/effect/governance";
import { postBatch, postConnection, postLogs } from "@/lib/effect/ingest";
import type { ConnectionInsert, TelemetryBatchWrite, TelemetryRepository } from "@/lib/effect/repository";

function createRepository(overrides: Partial<TelemetryRepository> = {}): TelemetryRepository {
  return {
    insertConnection: () => Effect.void,
    updateConnection: () => Effect.void,
    insertSpan: () => Effect.void,
    updateSpan: () => Effect.void,
    insertEvents: () => Effect.void,
    insertMetrics: () => Effect.void,
    insertLogs: () => Effect.void,
    insertVoiceTurns: () => Effect.void,
    insertAgentToolCalls: () => Effect.void,
    writeBatch: () => Effect.void,
    ...overrides,
  };
}

function deps(repository: TelemetryRepository, governance?: IngestGovernanceConfig) {
  return {
    repository,
    expectedApiKey: "test-key",
    authorization: "Bearer test-key",
    requiredScope: "*",
    defaultTenant: { workspace_id: "default", project_id: "default" },
    governance,
  };
}

describe("Effect ingest service", () => {
  it("injects the repository dependency and enriches connection records", async () => {
    const inserted: ConnectionInsert[] = [];
    const repository = createRepository({
      insertConnection: (input) => Effect.sync(() => {
        inserted.push(input);
      }),
    });

    const result = await Effect.runPromise(postConnection(deps(repository), {
      id: "conn-effect-unit",
      service: "voice-gateway",
      connection_type: "ws",
      client_id: "client-1",
    }));

    expect(result).toEqual({ id: "conn-effect-unit" });
    expect(inserted).toHaveLength(1);

    const record = inserted[0];
    expect(record).toMatchObject({
      id: "conn-effect-unit",
      service: "voice-gateway",
      connection_type: "ws",
      client_id: "client-1",
      status: "active",
      workspace_id: "default",
      project_id: "default",
    });
    expect(record.started_at.length).toBeGreaterThan(0);
  });

  it("does not call the repository when schema validation fails", async () => {
    let calls = 0;
    const repository = createRepository({
      insertConnection: () => Effect.sync(() => {
        calls += 1;
      }),
    });

    const result = await Effect.runPromise(Effect.either(
      postConnection(deps(repository), { connection_type: "ws" })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toContain("service");
    }
    expect(calls).toBe(0);
  });

  it("propagates repository database errors through the ingest program", async () => {
    const repository = createRepository({
      insertConnection: () => Effect.fail(new DatabaseError({ message: "db down" })),
    });

    const result = await Effect.runPromise(Effect.either(
      postConnection(deps(repository), {
        service: "voice-gateway",
        connection_type: "ws",
      })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DatabaseError");
      expect(result.left.message).toBe("db down");
    }
  });

  it("does not call batch persistence when a batch has no writeable operations", async () => {
    let calls = 0;
    const repository = createRepository({
      writeBatch: () => Effect.sync(() => {
        calls += 1;
      }),
    });

    const result = await Effect.runPromise(Effect.either(
      postBatch(deps(repository), {
        connection_updates: [{ id: "conn-with-no-fields" }],
      })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toBe("No valid records in batch");
    }
    expect(calls).toBe(0);
  });

  it("rejects direct D1 batches above the configured operation limit", async () => {
    let calls = 0;
    const repository = createRepository({
      writeBatch: () => Effect.sync(() => {
        calls += 1;
      }),
    });

    const result = await Effect.runPromise(Effect.either(
      postBatch({ ...deps(repository), maxBatchOperations: 1 }, {
        logs: [
          { service: "voice-gateway", level: "info", message: "first" },
          { service: "voice-gateway", level: "info", message: "second" },
        ],
      })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PayloadTooLargeError");
      expect(result.left.message).toBe("Max 1 operations per batch");
    }
    expect(calls).toBe(0);
  });

  it("defaults direct D1 batches to a limit below the D1 per-invocation query cap", async () => {
    let calls = 0;
    const repository = createRepository({
      writeBatch: () => Effect.sync(() => {
        calls += 1;
      }),
    });

    const logs = Array.from({ length: 251 }, (_, index) => ({
      service: "voice-gateway",
      level: "info",
      message: `log ${index}`,
    }));

    const result = await Effect.runPromise(Effect.either(
      postBatch(deps(repository), { logs })
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PayloadTooLargeError");
      expect(result.left.message).toBe("Max 250 operations per batch");
    }
    expect(calls).toBe(0);
  });

  it("applies the direct D1 operation limit to signal array writes", async () => {
    let calls = 0;
    const repository = createRepository({
      insertLogs: () => Effect.sync(() => {
        calls += 1;
      }),
    });

    const result = await Effect.runPromise(Effect.either(
      postLogs({ ...deps(repository), requiredScope: "logs", maxBatchOperations: 1 }, [
        { service: "voice-gateway", level: "info", message: "first" },
        { service: "voice-gateway", level: "info", message: "second" },
      ])
    ));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PayloadTooLargeError");
      expect(result.left.message).toBe("Max 1 operations per batch");
    }
    expect(calls).toBe(0);
  });

  it("applies ingest governance before batch persistence", async () => {
    let captured: TelemetryBatchWrite | undefined;
    const repository = createRepository({
      writeBatch: (input) => Effect.sync(() => {
        captured = input;
      }),
    });

    const result = await Effect.runPromise(postBatch(deps(repository, {
      ...DEFAULT_INGEST_GOVERNANCE_CONFIG,
      denyKeys: ["debug_payload"],
    }), {
      logs: [{
        service: "voice-gateway",
        level: "info",
        message: "customer user@example.com sent Bearer abc123",
        attributes: {
          authorization: "Bearer abc123",
          debug_payload: "drop me",
          provider: "asr",
        },
      }],
      voice_turns: [{
        role: "user",
        transcript: "my email is user@example.com",
        metadata: {
          password: "secret",
          provider: "web",
        },
      }],
      tool_calls: [{
        tool_name: "lookup_account",
        input: {
          api_key: "secret-key",
          account_id: "acct_123",
        },
        error: "token=abc123",
      }],
    }));

    expect(result.counts).toEqual({ logs: 1, voice_turns: 1, tool_calls: 1 });
    expect(captured?.logs[0].message).toBe("customer [REDACTED_EMAIL] sent Bearer [REDACTED]");
    expect(captured?.logs[0].attributes).toEqual({
      authorization: "[REDACTED]",
      provider: "asr",
    });
    expect(captured?.voiceTurns[0].transcript).toBe("my email is [REDACTED_EMAIL]");
    expect(captured?.voiceTurns[0].metadata).toEqual({
      password: "[REDACTED]",
      provider: "web",
    });
    expect(captured?.toolCalls[0].input).toEqual({
      api_key: "[REDACTED]",
      account_id: "acct_123",
    });
    expect(captured?.toolCalls[0].error).toBe("token=[REDACTED]");
  });
});
