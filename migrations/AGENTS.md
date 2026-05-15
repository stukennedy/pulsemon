# Migrations Agent Guide

This repo uses Drizzle-generated SQL migrations for Cloudflare D1.

## Rules

- Update `src/db/schema.ts` first.
- Run `bun run db:generate`.
- Inspect the generated SQL before committing.
- Never edit an already-applied migration for a forward change; generate a new
  one.
- Keep SQL D1/SQLite-compatible.
- Update repositories, seed helpers, fixtures, and tests for new columns.
- Update DB-facing TypeScript through `src/db/schema.ts` inferred types instead
  of hand-maintained row interfaces.
- Run `bun run restore:check`.

## Drizzle

`migrations/0000_busy_quicksilver.sql` is the generated initial migration. The
old handwritten migration chain was removed before production use, and
`migrations/meta` is now the baseline for future diffs.

## Migration Checklist

1. Update `src/db/schema.ts`.
2. Run `bun run db:generate`.
3. Confirm the generated diff is only the intended change.
4. Backfill or default new non-null data explicitly when needed.
5. Update D1 insert/select code.
6. Run typecheck, tests, build, and restore check.
