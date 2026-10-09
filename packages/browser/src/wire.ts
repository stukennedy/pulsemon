export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_EVENTS_PER_BATCH = 500;
export const MAX_RRWEB_PER_BATCH = 5000;

export const CAPS = {
  uid: 128,
  url: 2048,
  path: 1024,
  title: 256,
  sel: 512,
  msg: 500,
  name: 128,
  props: 20,
  // Not in the spec; bounds a single custom event so it can never outgrow a batch.
  propValue: 1024,
} as const;

export type Scalar = string | number | boolean;

export interface PageInfo {
  url: string;
  path: string;
  title?: string;
  referrer?: string;
  vw: number;
  vh: number;
}

export type BrowserEvent =
  | { t: number; type: 'pageview'; path: string; vw: number; vh: number; dh: number }
  | {
      t: number;
      type: 'click' | 'rage_click' | 'dead_click';
      path: string;
      sel: string;
      x: number;
      y: number;
      vw: number;
      vh: number;
      dh: number;
    }
  | { t: number; type: 'scroll'; path: string; depth: number; vw: number; dh: number }
  | { t: number; type: 'error'; path: string; msg: string; src?: string }
  | { t: number; type: 'custom'; path: string; name: string; props?: Record<string, Scalar> };

export interface BrowserBatch {
  v: 1;
  sid: string;
  seq: number;
  uid?: string;
  page: PageInfo;
  rrweb?: unknown[];
  events: BrowserEvent[];
}

export const SID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let out = value.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

export function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** origin + pathname (+ search when opted in); never the fragment. */
export function stripUrl(raw: string | undefined | null, captureQueryString: boolean): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return truncate(u.origin + u.pathname + (captureQueryString ? u.search : ''), CAPS.url);
  } catch {
    return undefined;
  }
}

export function stripSrc(filename: string | undefined, line?: number, col?: number): string | undefined {
  const file = filename?.split(/[?#]/)[0];
  if (!file) return undefined;
  return truncate(`${file}:${line ?? 0}:${col ?? 0}`, CAPS.url);
}

export function shapeProps(props: unknown): Record<string, Scalar> | undefined {
  if (!props || typeof props !== 'object') return undefined;
  const out: Record<string, Scalar> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (n >= CAPS.props) break;
    if (typeof v === 'string') out[k] = truncate(v, CAPS.propValue);
    else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else continue;
    n++;
  }
  return n ? out : undefined;
}

export function sanitizeUid(id: unknown): string | undefined {
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const s = String(id).trim();
  return s ? truncate(s, CAPS.uid) : undefined;
}

export function shapePage(input: {
  href: string;
  pathname: string;
  title?: string | undefined;
  referrer?: string | undefined;
  vw: number;
  vh: number;
  captureQueryString: boolean;
  includeTitle: boolean;
}): PageInfo {
  const page: PageInfo = {
    url: stripUrl(input.href, input.captureQueryString) ?? truncate(input.pathname, CAPS.url),
    path: truncate(input.pathname || '/', CAPS.path),
    vw: Math.round(input.vw),
    vh: Math.round(input.vh),
  };
  if (input.includeTitle && input.title) page.title = truncate(input.title, CAPS.title);
  if (input.referrer) page.referrer = input.referrer;
  return page;
}

export function ingestUrl(endpoint: string, key: string, gzip: boolean): string {
  return `${endpoint.replace(/\/+$/, '')}/api/ingest/browser?key=${encodeURIComponent(key)}${gzip ? '&enc=gzip' : ''}`;
}
