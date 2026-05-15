# Scripts Agent Guide

Scripts are Bun entrypoints for local and deployment operations. They may use
Node/Bun APIs; Worker source paths may not.

## Current Scripts

- `generate-seed.ts`: emits demo SQL seed data.
- `smoke.ts`: writes and reads a small deployment smoke payload.
- `load-ingest.ts`: configurable ingest load test.
- `capacity-check.ts`: gated ingest/readback capacity check.
- `restore-check.ts`: local migration and SQL export validation.
- `dr-check.ts`: primary/standby readiness check.
- `otlp-certify.ts`: live OTLP fixture replay with certification metadata.

## Standards

- Read configuration from environment variables.
- Print JSON summaries so CI and humans can parse the output.
- Exit non-zero when a gate fails.
- Do not bake production secrets into scripts or docs.
- For live scripts, make endpoint/key env vars explicit and document them in
  README or `specs/operations-readiness.md`.

## Verification

Scripts that require live services should at least compile:

```bash
bun build scripts/<script>.ts --target=bun --outfile=/private/tmp/<name>.js
```

Scripts that run locally without credentials, such as `restore-check.ts`, should
also be executed in verification.
