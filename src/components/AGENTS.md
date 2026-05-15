# Components Agent Guide

Components are server-rendered Hono JSX used by page routes and HTMX fragment
updates.

## UI Style

- Compact, dark, operator-focused interfaces.
- Prefer tables, dense summaries, small charts, and clear controls.
- Avoid marketing hero layouts.
- Do not nest cards inside cards.
- Keep repeated cards at modest radius and predictable spacing.
- Text must fit within buttons, table cells, badges, and compact panels.

## Data Handling

- Components should receive already-shaped data.
- Do not query D1 or call Effect services from components.
- Keep formatting helpers local when they are only presentational.
- Escape/format JSON carefully; do not render raw untrusted HTML.

## Interaction Pattern

- HTMX/websocket fragments replace table/chart containers.
- Search/filter state is handled by `SearchBar`, `TagBar`, and websocket search
  sessions.
- Forms post back to route handlers; domain validation belongs in Effect
  services.

## Testing

Most component coverage is through route/API tests. Add direct rendering tests
only when a component has non-trivial conditional rendering or formatting.
