import type { FC } from "hono/jsx";
import type { ActiveTag } from "@/types";

export const TagBar: FC<{ tags: ActiveTag[] }> = ({ tags }) => (
  <div
    id="tag-bar"
    role="group"
    aria-label="Active filters"
    aria-live="polite"
    class="flex items-center gap-1 pl-3 shrink-0 flex-wrap"
  >
    {tags.map((tag, i) => (
      <span class="tag-pill inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 whitespace-nowrap">
        <span class="text-cyan-500/70">{tag.facet}:</span>
        <span>{tag.value}</span>
        <button
          onclick={`removeTag(${i})`}
          class="ml-0.5 text-cyan-400/50 hover:text-cyan-300 transition-colors"
          aria-label={`Remove ${tag.facet}:${tag.value} filter`}
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </span>
    ))}
  </div>
);
