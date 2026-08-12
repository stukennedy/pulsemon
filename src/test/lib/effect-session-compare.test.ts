import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { createTestContext } from "../helpers";
import {
  compareVoiceSessions,
  getVoiceBaselineProfile,
  getVoiceSessionProfile,
} from "@/lib/effect/session-compare";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";

describe("Effect session compare queries", () => {
  it("builds a tenant-scoped profile for one session", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "s1", llm_latency_ms: 500, cost_usd: 0.01 });
    ctx.seedVoiceTurn({ session_id: "s1", llm_latency_ms: 1500, interruption: 1, cost_usd: 0.02 });
    ctx.seedVoiceTurn({ session_id: "s2", llm_latency_ms: 9000 });
    ctx.seedVoiceTurn({
      session_id: "s1",
      llm_latency_ms: 9000,
      workspace_id: "other-workspace",
      project_id: "other-project",
    });

    const profile = await Effect.runPromise(getVoiceSessionProfile(ctx.d1, DEFAULT_TENANT_SCOPE, "s1"));

    expect(profile?.turnCount).toBe(2);
    expect(profile?.stages.llm.p95).toBe(1500);
    expect(profile?.interruptedTurns).toBe(1);
    expect(profile?.totalCostUsd).toBeCloseTo(0.03);
  });

  it("returns null for a session with no turns", async () => {
    const ctx = createTestContext();
    const profile = await Effect.runPromise(getVoiceSessionProfile(ctx.d1, DEFAULT_TENANT_SCOPE, "missing"));
    expect(profile).toBeNull();
  });

  it("excludes the candidate session and old turns from the baseline", async () => {
    const ctx = createTestContext();
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    ctx.seedVoiceTurn({ session_id: "candidate", started_at: now, llm_latency_ms: 5000 });
    ctx.seedVoiceTurn({ session_id: "other-1", started_at: now, llm_latency_ms: 1000 });
    ctx.seedVoiceTurn({ session_id: "other-2", started_at: now, llm_latency_ms: 1200 });
    ctx.seedVoiceTurn({ session_id: "ancient", started_at: old, llm_latency_ms: 60000 });

    const baseline = await Effect.runPromise(getVoiceBaselineProfile(ctx.d1, DEFAULT_TENANT_SCOPE, {
      days: 7,
      excludeSessionIds: ["candidate"],
    }));

    expect(baseline?.turnCount).toBe(2);
    expect(baseline?.stages.llm.p95).toBe(1200);
  });

  it("compares a session against the rolling baseline", async () => {
    const ctx = createTestContext();
    const now = new Date().toISOString();

    for (let i = 0; i < 5; i++) {
      ctx.seedVoiceTurn({ session_id: "slow", started_at: now, llm_latency_ms: 3000 });
      ctx.seedVoiceTurn({ session_id: "steady", started_at: now, llm_latency_ms: 1000 });
    }

    const comparison = await Effect.runPromise(compareVoiceSessions(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      "slow",
      { kind: "baseline", days: 7 }
    ));

    const p95 = comparison.rows.find((row) => row.metric === "LLM response p95");
    expect(comparison.candidate.turnCount).toBe(5);
    expect(comparison.reference?.turnCount).toBe(5);
    expect(p95?.verdict).toBe("regressed");
  });

  it("fails with NotFound for an unknown candidate", async () => {
    const ctx = createTestContext();
    const result = await Effect.runPromise(Effect.either(compareVoiceSessions(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      "missing",
      { kind: "baseline", days: 7 }
    )));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("NotFoundError");
  });

  it("rejects an out-of-range baseline window", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "s1" });

    const result = await Effect.runPromise(Effect.either(compareVoiceSessions(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      "s1",
      { kind: "baseline", days: 90 }
    )));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("ValidationError");
  });

  it("compares two concrete sessions and surfaces a missing reference", async () => {
    const ctx = createTestContext();
    ctx.seedVoiceTurn({ session_id: "a", llm_latency_ms: 900 });
    ctx.seedVoiceTurn({ session_id: "b", llm_latency_ms: 800 });

    const ok = await Effect.runPromise(compareVoiceSessions(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      "a",
      { kind: "session", session_id: "b" }
    ));
    expect(ok.reference?.key).toBe("b");

    const missing = await Effect.runPromise(Effect.either(compareVoiceSessions(
      ctx.d1,
      DEFAULT_TENANT_SCOPE,
      "a",
      { kind: "session", session_id: "nope" }
    )));
    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) expect(missing.left._tag).toBe("NotFoundError");
  });
});
