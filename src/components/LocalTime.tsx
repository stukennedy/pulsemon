import type { FC } from "hono/jsx";

/**
 * A timestamp that renders in the VIEWER's timezone.
 *
 * Server-side we emit `<time datetime="…">` with a UTC fallback (Workers run
 * in UTC, so any string formatted here IS UTC); `public/js/localtime.js`
 * rewrites the text client-side and re-runs after HTMX/ws swaps. No-JS
 * readers see the UTC fallback, suffixed so it cannot be mistaken for local.
 */
export const LocalTime: FC<{ iso: string | null | undefined; fmt?: "time" | "datetime" | "date" }> = ({
  iso,
  fmt = "time",
}) => {
  if (!iso) return <>-</>;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return <>-</>;
  const fallback =
    fmt === "date"
      ? d.toISOString().slice(0, 10)
      : fmt === "datetime"
        ? `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`
        : `${d.toISOString().slice(11, 19)} UTC`;
  return (
    <time datetime={d.toISOString()} data-fmt={fmt}>
      {fallback}
    </time>
  );
};
