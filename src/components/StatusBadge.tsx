import type { FC } from "hono/jsx";

const TYPE_COLORS: Record<string, string> = {
  ws: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  sse: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  grpc: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

export const TypeBadge: FC<{ type: string }> = ({ type }) => (
  <span
    class={`px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase ${TYPE_COLORS[type] || "bg-gray-500/15 text-gray-400 border-gray-500/20"}`}
  >
    {type}
  </span>
);

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  closed: "text-gray-400",
  error: "text-red-400",
  ok: "text-emerald-400",
};

export const StatusDot: FC<{ status: string }> = ({ status }) => {
  const color = status === "active" || status === "ok"
    ? "bg-emerald-400"
    : status === "error"
    ? "bg-red-400"
    : "bg-gray-400";
  return <span class={`w-1.5 h-1.5 rounded-full inline-block ${color}`} />;
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] || "text-gray-400";
}

export function durationColor(ms: number | null): string {
  if (ms == null) return "text-gray-500";
  if (ms < 500) return "text-emerald-400";
  if (ms < 2000) return "text-amber-400";
  return "text-red-400";
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
