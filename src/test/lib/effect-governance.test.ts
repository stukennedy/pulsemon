import { describe, expect, it } from "bun:test";
import {
  DEFAULT_INGEST_GOVERNANCE_CONFIG,
  governanceConfigFromEnv,
  governText,
  governValue,
} from "@/lib/effect/governance";

describe("ingest governance", () => {
  it("redacts sensitive keys and common text PII", () => {
    const governed = governValue({
      authorization: "Bearer secret-token",
      nested: {
        email: "user@example.com",
        note: "contact user@example.com with card 4242 4242 4242 4242",
      },
      keep: "ok",
    }, DEFAULT_INGEST_GOVERNANCE_CONFIG);

    expect(governed).toEqual({
      authorization: "[REDACTED]",
      nested: {
        email: "[REDACTED_EMAIL]",
        note: "contact [REDACTED_EMAIL] with card [REDACTED_CARD]",
      },
      keep: "ok",
    });
  });

  it("supports attribute allow and deny lists", () => {
    const config = {
      ...DEFAULT_INGEST_GOVERNANCE_CONFIG,
      allowKeys: ["keep", "nested"],
      denyKeys: ["drop"],
    };

    const governed = governValue({
      keep: "ok",
      drop: "no",
      noisy: "no",
      nested: {
        keep: "nested ok",
        drop: "nested no",
      },
    }, config);

    expect(governed).toEqual({
      keep: "ok",
      nested: {
        keep: "nested ok",
      },
    });
  });

  it("builds config from environment", () => {
    const config = governanceConfigFromEnv({
      INGEST_REDACT_TEXT: "false",
      INGEST_REDACT_KEYS: "secret,credential",
      INGEST_ATTRIBUTE_DENY_KEYS: "debug",
      INGEST_MAX_ATTRIBUTE_KEYS: "2",
      INGEST_MAX_ATTRIBUTE_VALUE_LENGTH: "8",
    });

    expect(config.redactionEnabled).toBe(true);
    expect(config.redactText).toBe(false);
    expect(config.redactKeys).toEqual(["secret", "credential"]);
    expect(config.denyKeys).toEqual(["debug"]);
    expect(config.maxObjectKeys).toBe(2);
    expect(config.maxStringLength).toBe(8);
    expect(governText("longer than eight", config)).toBe("longer t...[TRUNCATED]");
  });
});
