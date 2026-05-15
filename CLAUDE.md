# Claude Code Entry Point

Read `AGENTS.md` first. It is the canonical agent steering document for this
repo, and nested `AGENTS.md` files add local context for specific directories.

The shortest safe loop is:

```bash
bun run typecheck
bun test
bun run build
bun run restore:check
```

Use `docs/getting-started.md` for onboarding and `docs/patterns.md` for common
implementation patterns.
