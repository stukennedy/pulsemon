import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import type { Connection } from "@/db/schema";
import { DatabaseError } from "@/lib/effect/errors";
import {
  queryConnections,
  querySpans,
  type NormalizedPagination,
  type TelemetryQueryRepository,
} from "@/lib/effect/query";
import type { ActiveTag } from "@/types";

const connection: Connection = {
  id: "conn-1",
  service: "voice-gateway",
  connection_type: "ws",
  client_id: null,
  session_id: null,
  started_at: "2026-05-14T00:00:00.000Z",
  ended_at: null,
  duration_ms: null,
  close_reason: null,
  status: "active",
  metadata: null,
};

function unimplemented<A>(): Effect.Effect<A, DatabaseError> {
  return Effect.fail(new DatabaseError({ message: "unimplemented query repository method" }));
}

function createRepository(overrides: Partial<TelemetryQueryRepository> = {}): TelemetryQueryRepository {
  return {
    queryConnections: () => unimplemented(),
    getConnectionDetail: () => unimplemented(),
    querySpans: () => unimplemented(),
    queryLogs: () => unimplemented(),
    getTraceSpans: () => unimplemented(),
    getConnectionFacetValues: () => unimplemented(),
    getSpanFacetValues: () => unimplemented(),
    getLogFacetValues: () => unimplemented(),
    queryDashboardStats: () => unimplemented(),
    queryConnectionStats: () => unimplemented(),
    ...overrides,
  };
}

describe("Effect query service", () => {
  it("injects the query repository and normalizes pagination", async () => {
    let received: {
      tags: readonly ActiveTag[];
      pagination: NormalizedPagination;
    } | undefined;

    const repository = createRepository({
      queryConnections: (tags, pagination) => Effect.sync(() => {
        received = { tags, pagination };
        return { connections: [connection], total: 1 };
      }),
    });

    const result = await Effect.runPromise(queryConnections(
      { repository },
      [{ facet: "service", value: "voice-gateway" }],
      { limit: 25, offset: 50 }
    ));

    expect(result.total).toBe(1);
    expect(result.connections).toEqual([connection]);
    expect(received).toEqual({
      tags: [{ facet: "service", value: "voice-gateway" }],
      pagination: { limit: 25, offset: 50 },
    });
  });

  it("rejects invalid pagination before calling the repository", async () => {
    let calls = 0;
    const repository = createRepository({
      queryConnections: () => Effect.sync(() => {
        calls += 1;
        return { connections: [], total: 0 };
      }),
    });

    const result = await Effect.runPromise(Effect.either(queryConnections(
      { repository },
      [],
      { limit: 0 }
    )));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ValidationError");
      expect(result.left.message).toContain("limit");
    }
    expect(calls).toBe(0);
  });

  it("propagates repository database errors as query errors", async () => {
    const repository = createRepository({
      querySpans: () => Effect.fail(new DatabaseError({ message: "read failed" })),
    });

    const result = await Effect.runPromise(Effect.either(querySpans(
      { repository },
      [],
      { limit: 10 }
    )));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DatabaseError");
      expect(result.left.message).toBe("read failed");
    }
  });
});
