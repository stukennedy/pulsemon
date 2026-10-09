import { describe, expect, it } from 'bun:test';
import { KEEPALIVE_MAX_BYTES, sendBody, type FetchLike, type TransportConfig } from '../src/transport';

function recorder(result: { ok: boolean; status: number } | Error = { ok: true, status: 202 }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, fetch };
}

const base = { endpoint: 'https://p.example', key: 'pk_test' };

async function bytesOf(body: BodyInit | null | undefined): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(body ?? null).arrayBuffer());
}

describe('sendBody', () => {
  it('gzips with CompressionStream and flags enc=gzip, text/plain', async () => {
    const { calls, fetch } = recorder();
    const cfg: TransportConfig = { ...base, fetch, CompressionStream };
    const body = JSON.stringify({ v: 1, events: [] });
    expect(await sendBody(body, cfg, false)).toBe('ok');
    const { url, init } = calls[0]!;
    expect(url).toBe('https://p.example/api/ingest/browser?key=pk_test&enc=gzip');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(init.method).toBe('POST');
    const raw = await bytesOf(init.body);
    expect(new TextDecoder().decode(Bun.gunzipSync(raw))).toBe(body);
  });

  it('sends plain JSON without enc when CompressionStream is unavailable', async () => {
    const { calls, fetch } = recorder();
    await sendBody('{"v":1}', { ...base, fetch, CompressionStream: undefined }, false);
    expect(calls[0]!.url).toBe('https://p.example/api/ingest/browser?key=pk_test');
    expect(calls[0]!.init.body).toBe('{"v":1}');
  });

  it('uses keepalive under 60 KB and plain fetch above', async () => {
    const { calls, fetch } = recorder();
    const cfg = { ...base, fetch, CompressionStream: undefined };
    await sendBody('x'.repeat(1000), cfg, false);
    await sendBody('x'.repeat(KEEPALIVE_MAX_BYTES + 1), cfg, false);
    expect(calls.map((c) => c.init.keepalive)).toEqual([true, false]);
  });

  it('beacons a text/plain Blob on unload when the body fits', async () => {
    const { calls, fetch } = recorder();
    const beacons: Array<{ url: string; data: Blob }> = [];
    const beacon = (url: string, data: Blob) => {
      beacons.push({ url, data });
      return true;
    };
    expect(await sendBody('{"v":1}', { ...base, fetch, beacon, CompressionStream }, true)).toBe('ok');
    expect(calls).toHaveLength(0);
    expect(beacons[0]!.url).toBe('https://p.example/api/ingest/browser?key=pk_test');
    expect(beacons[0]!.data.type).toStartWith('text/plain');
    expect(await beacons[0]!.data.text()).toBe('{"v":1}');
  });

  it('on unload, a large body that compresses small is beaconed gzipped', async () => {
    const { calls, fetch } = recorder();
    const beacons: string[] = [];
    const beacon = (url: string) => {
      beacons.push(url);
      return true;
    };
    await sendBody('a'.repeat(200_000), { ...base, fetch, beacon, CompressionStream }, true);
    expect(calls).toHaveLength(0);
    expect(beacons).toEqual(['https://p.example/api/ingest/browser?key=pk_test&enc=gzip']);
  });

  it('falls back to fetch keepalive when the beacon is refused', async () => {
    const { calls, fetch } = recorder();
    await sendBody('{"v":1}', { ...base, fetch, beacon: () => false, CompressionStream: undefined }, true);
    expect(calls[0]!.init.keepalive).toBe(true);
  });

  it('classifies network failure vs rejection', async () => {
    expect(await sendBody('{}', { ...base, ...recorder(new TypeError('offline')), CompressionStream: undefined }, false)).toBe('network');
    expect(await sendBody('{}', { ...base, ...recorder({ ok: false, status: 422 }), CompressionStream: undefined }, false)).toBe('rejected');
  });
});
