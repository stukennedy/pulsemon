import { ingestUrl, utf8Length } from './wire';

/** Browsers cap keepalive/beacon bodies at 64 KiB in flight; leave headroom. */
export const KEEPALIVE_MAX_BYTES = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
export type BeaconLike = (url: string, data: Blob) => boolean;

export interface TransportConfig {
  endpoint: string;
  key: string;
  fetch: FetchLike;
  beacon?: BeaconLike | undefined;
  CompressionStream?: typeof CompressionStream | undefined;
}

export type SendResult = 'ok' | 'rejected' | 'network';

export async function gzip(
  text: string,
  CS: typeof CompressionStream | undefined,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!CS) return undefined;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

/**
 * `unloading` prefers sendBeacon, which survives the page going away; a raw
 * body that fits is beaconed synchronously, before any async compression the
 * browser might never let finish.
 */
export async function sendBody(body: string, cfg: TransportConfig, unloading: boolean): Promise<SendResult> {
  if (unloading && cfg.beacon && utf8Length(body) <= KEEPALIVE_MAX_BYTES) {
    try {
      if (cfg.beacon(ingestUrl(cfg.endpoint, cfg.key, false), new Blob([body], { type: 'text/plain' }))) return 'ok';
    } catch {
      // fall through to fetch
    }
  }

  const gz = await gzip(body, cfg.CompressionStream);
  const url = ingestUrl(cfg.endpoint, cfg.key, gz !== undefined);
  const payload: BodyInit = gz ?? body;
  const size = gz ? gz.byteLength : utf8Length(body);

  if (unloading && cfg.beacon && gz && size <= KEEPALIVE_MAX_BYTES) {
    try {
      if (cfg.beacon(url, new Blob([gz], { type: 'text/plain' }))) return 'ok';
    } catch {
      // fall through to fetch
    }
  }

  try {
    const res = await cfg.fetch(url, {
      method: 'POST',
      // text/plain keeps this a CORS "simple request": no preflight, and beacon-compatible.
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      keepalive: size < KEEPALIVE_MAX_BYTES,
      credentials: 'omit',
    });
    return res.ok ? 'ok' : 'rejected';
  } catch {
    return 'network';
  }
}
