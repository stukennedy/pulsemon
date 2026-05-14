import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { DatabaseError } from "@/lib/effect/errors";
import { postBatch, postConnection } from "@/lib/effect/ingest";
import type { ConnectionInsert, TelemetryRepository } from "@/lib/effect/repository";

function createRepository(overrides: Partial<TelemetryRepository> = {}): TelemetryRepository {
  return {
    insertConnection: () => Effect.void,
    updateConnection: () => Effect.void,
    insertSpan: () => Effect.void,
    updateSpan: () => Effect.void,
    insertEvents: () => Effect.void,
    insertMetrics: () => Effect.void,
    writeBatch: () => Effect.void,
    ...overrides,
  };
}

function deps(repository: TelemetryRepository) {
  return {
    repository,
    expectedApiKey: "test-key",
    authorization: "Bearer test-key",
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
});
