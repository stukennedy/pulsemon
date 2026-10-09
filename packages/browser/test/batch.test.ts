import { describe, expect, it } from 'bun:test';
import { packBatches, sized, trimReplay, type ReplayItem } from '../src/batch';
import { MAX_BODY_BYTES, MAX_EVENTS_PER_BATCH, MAX_RRWEB_PER_BATCH, SID_PATTERN, utf8Length, type BrowserBatch } from '../src/wire';

const header = {
  sid: 'abcdEFGH1234_-xy',
  uid: 'user-1',
  page: { url: 'https://app.example.com/a', path: '/a', vw: 1280, vh: 720 },
};

const parse = (body: string): BrowserBatch => JSON.parse(body) as BrowserBatch;

describe('packBatches', () => {
  it('produces the spec BrowserBatch shape', () => {
    const ev = { t: 1, type: 'pageview', path: '/a', vw: 1280, vh: 720, dh: 2000 };
    const { batches } = packBatches(header, [sized(ev)], [sized({ type: 4, data: {}, timestamp: 1 })], 7);
    expect(batches).toHaveLength(1);
    const b = parse(batches[0]!.body);
    expect(b).toEqual({
      v: 1,
      sid: header.sid,
      seq: 7,
      uid: 'user-1',
      page: header.page,
      rrweb: [{ type: 4, data: {}, timestamp: 1 }],
      events: [ev],
    } as unknown as BrowserBatch);
    expect(SID_PATTERN.test(b.sid)).toBe(true);
  });

  it('omits rrweb entirely when replay is off, and uid when unidentified', () => {
    const { batches } = packBatches({ ...header, uid: undefined }, [sized({ t: 1 })], undefined, 0);
    const b = parse(batches[0]!.body);
    expect(b).not.toHaveProperty('rrweb');
    expect(b).not.toHaveProperty('uid');
  });

  it('sends rrweb: [] when replay is on but nothing was recorded', () => {
    const { batches } = packBatches(header, [sized({ t: 1 })], [], 0);
    expect(parse(batches[0]!.body).rrweb).toEqual([]);
  });

  it('nothing buffered → no batches and no seq reserved', () => {
    let reserved = 0;
    const { batches } = packBatches(header, [], [], (n) => {
      reserved += n;
      return 0;
    });
    expect(batches).toHaveLength(0);
    expect(reserved).toBe(0);
  });

  it('splits at 1 MiB, keeps order, and assigns consecutive seqs', () => {
    const chunk = 'x'.repeat(100 * 1024);
    const rrweb = Array.from({ length: 25 }, (_, i) => sized({ type: 3, i, chunk }));
    const reserves: number[] = [];
    const { batches, dropped } = packBatches(header, [sized({ t: 1 })], rrweb, (n) => {
      reserves.push(n);
      return 40;
    });
    expect(dropped).toBe(0);
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(reserves).toEqual([batches.length]);
    const seen: number[] = [];
    batches.forEach((b, i) => {
      expect(utf8Length(b.body)).toBeLessThanOrEqual(MAX_BODY_BYTES);
      const parsed = parse(b.body);
      expect(parsed.seq).toBe(40 + i);
      expect(b.seq).toBe(40 + i);
      for (const r of parsed.rrweb as Array<{ i: number }>) seen.push(r.i);
    });
    expect(seen).toEqual(rrweb.map((_, i) => i));
  });

  it('respects the byte limit with multibyte content', () => {
    const rrweb = Array.from({ length: 40 }, () => sized({ s: '€'.repeat(20_000) }));
    const { batches } = packBatches(header, [], rrweb, 0);
    for (const b of batches) expect(new TextEncoder().encode(b.body).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('splits at 500 events per batch', () => {
    const events = Array.from({ length: 1201 }, (_, t) => sized({ t, type: 'custom', path: '/', name: 'n' }));
    const { batches } = packBatches(header, events, undefined, 0);
    expect(batches.map((b) => parse(b.body).events.length)).toEqual([MAX_EVENTS_PER_BATCH, MAX_EVENTS_PER_BATCH, 201]);
  });

  it('splits at 5000 rrweb events per batch', () => {
    const rrweb = Array.from({ length: 10_001 }, (_, i) => sized({ type: 3, i }));
    const { batches } = packBatches(header, [], rrweb, 0);
    expect(batches.map((b) => parse(b.body).rrweb!.length)).toEqual([MAX_RRWEB_PER_BATCH, MAX_RRWEB_PER_BATCH, 1]);
  });

  it('drops a single item that can never fit', () => {
    const huge = sized({ type: 2, blob: 'y'.repeat(MAX_BODY_BYTES) });
    const { batches, dropped } = packBatches(header, [sized({ t: 1 })], [huge, sized({ type: 3 })], 0);
    expect(dropped).toBe(1);
    expect(batches).toHaveLength(1);
    expect(parse(batches[0]!.body).rrweb).toEqual([{ type: 3 }]);
  });
});

describe('trimReplay', () => {
  const item = (type: number, bytes: number): ReplayItem => ({ json: '{}', bytes, type });

  it('leaves a buffer under the cap alone', () => {
    const items = [item(4, 10), item(2, 10)];
    expect(trimReplay(items, 100)).toEqual({ items, bytes: 20, resnapshot: false });
  });

  it('drops everything before the latest Meta + FullSnapshot', () => {
    const items = [item(4, 10), item(2, 50), item(3, 30), item(4, 5), item(2, 40), item(3, 5)];
    const out = trimReplay(items, 60);
    expect(out.items.map((i) => i.type)).toEqual([4, 2, 3]);
    expect(out.bytes).toBe(50);
    expect(out.resnapshot).toBe(false);
  });

  it('asks for a fresh snapshot when the tail alone is over the cap', () => {
    const out = trimReplay([item(4, 10), item(2, 50), item(3, 100)], 60);
    expect(out).toEqual({ items: [], bytes: 0, resnapshot: true });
  });
});
