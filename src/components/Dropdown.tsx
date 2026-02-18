import type { FC } from "hono/jsx";
import { StatusDot } from "./StatusBadge";

export const FacetList: FC<{ facets: string[] }> = ({ facets }) => (
  <div id="dropdown-content">
    <div
      class="px-3 py-2"
      style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#334155;font-family:'IBM Plex Mono',monospace;border-bottom:1px solid rgba(255,255,255,0.05)"
    >
      Facets
    </div>
    {facets.map((f) => (
      <button
        class="dropdown-item w-full px-3 py-2.5 text-left flex items-center gap-2.5 transition-colors cursor-pointer"
        style="color:#94a3b8"
        data-facet={f}
        onclick={`selectFacet('${f}')`}
      >
        <span
          class="font-mono px-1.5 py-0.5 rounded text-[11px]"
          style="background:rgba(34,211,238,0.08);color:#22d3ee;border:1px solid rgba(34,211,238,0.15)"
        >
          {f}
        </span>
        <span style="color:#1e293b;font-size:11px">:</span>
      </button>
    ))}
  </div>
);

export const ValueList: FC<{ facet: string; values: string[] }> = ({ facet, values }) => (
  <div id="dropdown-content">
    <div
      class="px-3 py-2"
      style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#334155;font-family:'IBM Plex Mono',monospace;border-bottom:1px solid rgba(255,255,255,0.05)"
    >
      {facet} values
    </div>
    {values.map((v, i) => (
      <button
        class="dropdown-item w-full px-3 py-2.5 text-left flex items-center gap-2.5 transition-colors cursor-pointer"
        style="color:#94a3b8"
        data-value={v}
        data-index={i}
        onclick={`addTag('${facet}','${v}')`}
      >
        {facet === "status" && <StatusDot status={v} />}
        <span class="font-mono text-xs">{v}</span>
      </button>
    ))}
  </div>
);

export const NoResults: FC<{ message: string }> = ({ message }) => (
  <div id="dropdown-content">
    <div class="px-3 py-5 text-center font-mono" style="font-size:11px;color:#334155">
      {message}
    </div>
  </div>
);
