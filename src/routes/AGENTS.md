# Routes Agent Guide

Routes are thin adapters around services and components.

## Conventions

- Export Hono-compatible handlers such as `onRequestGet`, `onRequestPost`, or
  named handlers used by `src/router.ts`.
- Page routes usually return `c.render(<main>...</main>)`.
- API routes should return JSON or HTML fragments consumed by HTMX.
- Ingest routes live in `routes/api/ingest.ts` and support native JSON plus
  OTLP routes.
- Auth routes live in `routes/auth`.
- Admin routes must call `requireAdminUi` unless they use a dedicated system
  token such as maintenance.

## After Adding Routes

Run:

```bash
bun run routes
```

Then inspect `src/router.ts`. It is generated and uses its own formatting, so
do not reformat unrelated lines.

## Route Handler Shape

Keep handlers small:

```ts
export const onRequestGet = async (c: Context<{ Bindings: Env }>) => {
  const result = await Effect.runPromise(Effect.either(service(c.env.DB)));
  if (Either.isLeft(result)) {
    const error = result.left;
    return c.json({ error: error.message }, errorStatus(error));
  }
  return c.json(result.right);
};
```

Route files may parse query params, form data, headers, and environment. They
should not own complex business rules.

## UI Routes

- Use `Nav` with the active route.
- Keep first screen useful: tables, charts, or operator controls.
- Forms that mutate data should require admin auth and redirect with `303`
  after success.

## Tests

Add API/page tests under `src/test/api` or `src/test/routes.test.ts`. Use
`ctx.request` from `createTestContext`.
