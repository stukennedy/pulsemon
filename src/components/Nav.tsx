import type { FC } from "hono/jsx";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "◉" },
  { href: "/connections", label: "Connections", icon: "⇌" },
  { href: "/logs", label: "Logs", icon: "≡" },
  { href: "/metrics", label: "Metrics", icon: "▥" },
  { href: "/monitors", label: "Monitors", icon: "!" },
  { href: "/slos", label: "SLOs", icon: "%" },
  { href: "/traces", label: "Traces", icon: "⋮" },
  { href: "/voice", label: "Voice", icon: "◎" },
];

export const Nav: FC<{ active: string }> = ({ active }) => (
  <header class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="live-ring w-2 h-2 rounded-full shrink-0" style="background:#10b981" aria-hidden="true" />
      <h1 class="text-sm font-semibold text-white tracking-tight" style="font-family:'IBM Plex Mono',monospace">
        pulsemon
      </h1>
      <span class="text-gray-700 text-xs hidden sm:inline" style="font-family:'IBM Plex Mono',monospace">
        / realtime observability
      </span>
    </div>
    <nav class="flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.href;
        return (
          <a
            href={item.href}
            class={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              isActive
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
            style={isActive ? "background:rgba(255,255,255,0.06)" : ""}
          >
            <span class="text-[10px]">{item.icon}</span>
            <span style="font-family:'IBM Plex Mono',monospace">{item.label}</span>
          </a>
        );
      })}
    </nav>
  </header>
);
