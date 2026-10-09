import { CAPS, truncate } from './wire';

export const RAGE_WINDOW_MS = 1000;
export const RAGE_RADIUS_PX = 30;
export const RAGE_MIN_CLICKS = 3;
export const DEAD_WINDOW_MS = 1000;

/** Third or later click within 1 s inside a 30 px radius of this one. */
export class RageDetector {
  private recent: Array<{ t: number; x: number; y: number }> = [];

  isRage(t: number, x: number, y: number): boolean {
    this.recent = this.recent.filter((c) => t - c.t <= RAGE_WINDOW_MS);
    const near = this.recent.filter((c) => Math.hypot(c.x - x, c.y - y) <= RAGE_RADIUS_PX).length;
    this.recent.push({ t, x, y });
    return near + 1 >= RAGE_MIN_CLICKS;
  }
}

interface PendingClick<T> {
  t: number;
  payload: T;
  eligible: boolean;
  alive: boolean;
}

/**
 * Holds each click for DEAD_WINDOW_MS. Any DOM mutation, navigation or scroll
 * in that window marks it alive; anything still quiet when the window closes
 * is dead. Clicks still pending at unload are resolved as alive, since the
 * unload is itself a navigation.
 */
export class DeadClickJudge<T> {
  private pending: Array<PendingClick<T>> = [];

  get size(): number {
    return this.pending.length;
  }

  add(t: number, payload: T, eligible: boolean): void {
    this.pending.push({ t, payload, eligible, alive: false });
  }

  activity(t: number): void {
    for (const p of this.pending) if (t >= p.t && t <= p.t + DEAD_WINDOW_MS) p.alive = true;
  }

  drain(now: number, force = false): Array<{ payload: T; dead: boolean }> {
    const out: Array<{ payload: T; dead: boolean }> = [];
    const keep: Array<PendingClick<T>> = [];
    for (const p of this.pending) {
      if (now >= p.t + DEAD_WINDOW_MS) out.push({ payload: p.payload, dead: p.eligible && !p.alive });
      else if (force) out.push({ payload: p.payload, dead: false });
      else keep.push(p);
    }
    this.pending = keep;
    return out;
  }
}

export interface ElementLike {
  tagName: string;
  id?: string;
  classList?: ArrayLike<string> | Iterable<string>;
  parentElement: ElementLike | null;
  previousElementSibling: ElementLike | null;
  nextElementSibling: ElementLike | null;
  getAttribute(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const MAX_DEPTH = 6;
const MAX_CLASSES = 2;

function siblingIndex(el: ElementLike): { index: number; ambiguous: boolean } {
  const tag = el.tagName;
  let index = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === tag) index++;
  let ambiguous = index > 1;
  for (let s = el.nextElementSibling; s && !ambiguous; s = s.nextElementSibling) if (s.tagName === tag) ambiguous = true;
  return { index, ambiguous };
}

/**
 * A structural CSS selector: tag, id, a couple of class names and
 * :nth-of-type. Never element text or attribute values other than id/class,
 * so it cannot carry user content. Over-long chains lose ancestors first.
 */
export function buildSelector(target: ElementLike | null): string {
  const parts: string[] = [];
  for (let el = target, depth = 0; el && depth < MAX_DEPTH; el = el.parentElement, depth++) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'html') break;
    const id = el.id;
    if (id && IDENT.test(id)) {
      parts.unshift(`${tag}#${id}`);
      break;
    }
    let part = tag;
    if (tag === 'body') {
      parts.unshift(part);
      break;
    }
    const classes = el.classList ? Array.from(el.classList as Iterable<string>) : [];
    for (const c of classes.filter((c) => IDENT.test(c)).slice(0, MAX_CLASSES)) part += `.${c}`;
    const { index, ambiguous } = siblingIndex(el);
    if (ambiguous) part += `:nth-of-type(${index})`;
    parts.unshift(part);
  }
  while (parts.length > 1 && parts.join(' > ').length > CAPS.sel) parts.shift();
  return truncate(parts.join(' > '), CAPS.sel);
}

const NON_ENTRY_INPUTS = new Set(['button', 'submit', 'reset', 'image']);

/** Value-entry controls, where a click legitimately changes nothing in the DOM. */
export function isFormControl(el: ElementLike | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    if (tag === 'input') return !NON_ENTRY_INPUTS.has((e.getAttribute('type') ?? '').toLowerCase());
    if (tag === 'select' || tag === 'textarea' || tag === 'option' || tag === 'label') return true;
    const ce = e.getAttribute('contenteditable');
    if (ce !== null && ce !== 'false') return true;
  }
  return false;
}

export function scrollDepthPercent(scrollY: number, viewportHeight: number, documentHeight: number): number {
  if (!(documentHeight > 0) || viewportHeight >= documentHeight) return 100;
  const pct = Math.round(((Math.max(0, scrollY) + viewportHeight) / documentHeight) * 100);
  return Math.min(100, Math.max(0, pct));
}
