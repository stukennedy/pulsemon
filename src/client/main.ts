/**
 * Client-side logic for the log browser.
 * Tag state management, keyboard navigation, WS form submission,
 * and AI panel toggling.
 */

// HTMX 4 + hx-ws loaded via public/ scripts in layout
declare const htmx: any;

interface Tag {
  facet: string;
  value: string;
}

let activeTags: Tag[] = [];
let highlightIdx = -1;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let wsClientSeq = 0;

const SEARCH_SESSION_STORAGE_KEY = "pulsemon.searchSessionId";
const SEARCH_SESSION_QUERY_PARAM = "sid";
const SEQUENCED_WS_ACTIONS = new Set(["suggest", "add_tag", "remove_tag", "refresh", "set_tags"]);

interface WsSendData {
  client_seq?: string;
  values?: Record<string, unknown>;
}

interface WsSendEventDetail {
  data?: WsSendData;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const input = () => $("search-input") as HTMLInputElement;
const dropdown = () => $("dropdown");

function newSearchSessionId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  if (crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function getSearchSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SEARCH_SESSION_STORAGE_KEY);
    if (existing) return existing;

    const sessionId = newSearchSessionId();
    sessionStorage.setItem(SEARCH_SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return newSearchSessionId();
  }
}

function withSearchSessionId(value: string, sessionId: string): string {
  try {
    const url = new URL(value, window.location.href);
    url.searchParams.set(SEARCH_SESSION_QUERY_PARAM, sessionId);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function installSearchSessionId() {
  const sessionId = getSearchSessionId();
  document.querySelectorAll<HTMLElement>("[hx-ws-connect], [hx-ws\\:connect]").forEach((el) => {
    for (const attr of ["hx-ws-connect", "hx-ws:connect"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      el.setAttribute(attr, withSearchSessionId(value, sessionId));
    }
  });
}

function installWsRequestSequencing() {
  document.body.addEventListener("htmx:before:ws:send", ((event: CustomEvent<WsSendEventDetail>) => {
    const data = event.detail?.data;
    const values = data?.values;
    const action = typeof values?.action === "string" ? values.action : "";
    if (!data || !values || !SEQUENCED_WS_ACTIONS.has(action)) return;

    const clientSeq = String(++wsClientSeq);
    data.client_seq = clientSeq;
    values.client_seq = clientSeq;
  }) as EventListener);
}

installSearchSessionId();
installWsRequestSequencing();

function getTagsStr(): string {
  return activeTags.map((t) => `${t.facet}:${t.value}`).join("|");
}

// --- WebSocket-driven actions ---

function wsSuggest() {
  ($("ws-query") as HTMLInputElement).value = input().value;
  ($("ws-tags") as HTMLInputElement).value = getTagsStr();
  htmx.trigger($("suggest-form"), "suggest");
}

// Sync current tags string into the AI hidden input
function syncAiTags(tagsStr: string) {
  const el = $("ai-tags") as HTMLInputElement | null;
  if (el) el.value = tagsStr;
}

// Exposed to onclick handlers in server-rendered HTML
(window as any).selectFacet = (facet: string) => {
  input().value = facet + ":";
  input().focus();
  highlightIdx = -1;
  wsSuggest();
};

(window as any).addTag = (facet: string, value: string) => {
  ($("ws-add-facet") as HTMLInputElement).value = facet;
  ($("ws-add-value") as HTMLInputElement).value = value;
  ($("ws-add-tags") as HTMLInputElement).value = getTagsStr();
  htmx.trigger($("add-tag-form"), "submit");
};

(window as any).removeTag = (index: number) => {
  ($("ws-remove-idx") as HTMLInputElement).value = String(index);
  ($("ws-remove-tags") as HTMLInputElement).value = getTagsStr();
  htmx.trigger($("remove-tag-form"), "submit");
};

// AI-driven filter application — replaces all active tags via WS
(window as any).setTags = (tagsStr: string) => {
  ($("ws-set-tags") as HTMLInputElement).value = tagsStr;
  htmx.trigger($("set-tags-form"), "submit");
};

(window as any).toggleAiPanel = () => {
  const wrapper = $("ai-panel-wrapper");
  const btn = $("ai-toggle-btn");
  if (!wrapper) return;
  const hidden = wrapper.classList.toggle("hidden");
  if (btn) {
    btn.style.background = hidden
      ? "rgba(99,102,241,0.1)"
      : "rgba(99,102,241,0.2)";
    btn.style.borderColor = hidden
      ? "rgba(99,102,241,0.25)"
      : "rgba(99,102,241,0.4)";
  }
  if (!hidden) {
    const aiInput = wrapper.querySelector<HTMLInputElement>("input[name='question']");
    aiInput?.focus();
  }
};

// --- Input events ---

document.addEventListener("DOMContentLoaded", () => {
  const inp = input();
  const dd = dropdown();

  // Debounced suggest on input
  inp.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(wsSuggest, 150);
  });

  inp.addEventListener("focus", wsSuggest);

  // Keyboard navigation
  inp.addEventListener("keydown", (e) => {
    const items = dd.querySelectorAll<HTMLElement>(".dropdown-item");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
      updateHighlight(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      updateHighlight(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < items.length) {
        items[highlightIdx].click();
      }
    } else if (e.key === "Escape") {
      dd.innerHTML = "";
      dd.classList.add("hidden");
    } else if (e.key === "Backspace" && inp.value === "" && activeTags.length > 0) {
      (window as any).removeTag(activeTags.length - 1);
    }
  });

  // Show/hide dropdown based on content
  const observer = new MutationObserver(() => {
    dd.classList.toggle("hidden", !dd.innerHTML.trim());
  });
  observer.observe(dd, { childList: true, subtree: true });

  // Close dropdown on outside click
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#search-container")) {
      dd.innerHTML = "";
      dd.classList.add("hidden");
    }
  });

  // Reset highlight when dropdown updates
  document.body.addEventListener("htmx:afterSwap", ((e: CustomEvent) => {
    const target = e.detail?.target;
    if (target === dd || target?.id === "dropdown") {
      highlightIdx = -1;
    }
  }) as EventListener);

  // Auto-apply AI-suggested filters after the AI response swaps in
  document.body.addEventListener("htmx:afterSwap", ((e: CustomEvent) => {
    const target = e.detail?.target as HTMLElement | null;
    if (target?.id === "ai-response") {
      const autoEl = target.querySelector<HTMLElement>("[data-auto-filters]");
      if (autoEl) {
        const filtersStr = autoEl.getAttribute("data-auto-filters");
        if (filtersStr) {
          // Short delay so the chips render before the WS refresh
          setTimeout(() => (window as any).setTags(filtersStr), 250);
        }
      }
    }
  }) as EventListener);

  // Handle state messages from WebSocket
  document.body.addEventListener("htmx:wsMessage", ((e: CustomEvent) => {
    const d = e.detail;
    if (d?.channel === "state") {
      if (d.tags !== undefined) {
        activeTags = d.tags
          ? d.tags.split("|").map((t: string) => {
              const idx = t.indexOf(":");
              return { facet: t.slice(0, idx), value: t.slice(idx + 1) };
            })
          : [];
        syncAiTags(d.tags ?? "");
      }
      if (d.clearInput) {
        inp.value = "";
        inp.blur();
      }
    }
  }) as EventListener);
});

function updateHighlight(items: NodeListOf<HTMLElement>) {
  items.forEach((item, i) => {
    item.classList.toggle("highlighted", i === highlightIdx);
    if (i === highlightIdx) item.scrollIntoView({ block: "nearest" });
  });
}
