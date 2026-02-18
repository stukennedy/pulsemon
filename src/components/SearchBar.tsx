import type { FC } from "hono/jsx";

export const SearchBar: FC<{ placeholder?: string }> = ({ placeholder }) => (
  <div class="relative mb-4" id="search-container" role="search">
    <div
      class="flex items-center rounded-lg transition-all"
      style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)"
      id="search-inner"
    >
      <div id="tag-bar" role="group" aria-label="Active filters" aria-live="polite" class="flex items-center gap-1 pl-3 shrink-0 flex-wrap" />
      <div class="pl-3 pr-1" aria-hidden="true" style="color:#334155">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        id="search-input"
        class="search-input flex-1 bg-transparent text-sm py-2.5 pr-3 min-w-[180px]"
        style="color:#e2e8f0;font-family:'IBM Plex Mono',monospace;font-size:13px"
        placeholder={placeholder || "Filter… service:voice-gateway  type:ws  status:error"}
        aria-label="Filter by facet"
        aria-autocomplete="list"
        aria-controls="dropdown"
        autocomplete="off"
      />
    </div>
    <div
      id="dropdown"
      class="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg shadow-2xl overflow-hidden max-h-72 overflow-y-auto hidden"
      style="background:#080b14;border:1px solid rgba(255,255,255,0.08);box-shadow:0 20px 60px rgba(0,0,0,0.6)"
    />
  </div>
);

export const WsForms: FC = () => (
  <>
    <form id="suggest-form" hx-ws-send hx-trigger="suggest" style={{ display: "none" }}>
      <input type="hidden" name="action" value="suggest" />
      <input type="hidden" name="query" id="ws-query" />
      <input type="hidden" name="tags" id="ws-tags" />
    </form>
    <form id="add-tag-form" hx-ws-send hx-trigger="submit" style={{ display: "none" }}>
      <input type="hidden" name="action" value="add_tag" />
      <input type="hidden" name="facet" id="ws-add-facet" />
      <input type="hidden" name="value" id="ws-add-value" />
      <input type="hidden" name="tags" id="ws-add-tags" />
    </form>
    <form id="remove-tag-form" hx-ws-send hx-trigger="submit" style={{ display: "none" }}>
      <input type="hidden" name="action" value="remove_tag" />
      <input type="hidden" name="removeIdx" id="ws-remove-idx" />
      <input type="hidden" name="tags" id="ws-remove-tags" />
    </form>
    <form id="refresh-form" hx-ws-send hx-trigger="submit" style={{ display: "none" }}>
      <input type="hidden" name="action" value="refresh" />
      <input type="hidden" name="tags" id="ws-refresh-tags" />
    </form>
    <form id="set-tags-form" hx-ws-send hx-trigger="submit" style={{ display: "none" }}>
      <input type="hidden" name="action" value="set_tags" />
      <input type="hidden" name="tags" id="ws-set-tags" />
    </form>
  </>
);
