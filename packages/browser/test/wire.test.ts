import { describe, expect, it } from 'bun:test';
import {
  CAPS,
  ingestUrl,
  sanitizeUid,
  shapePage,
  shapeProps,
  stripSrc,
  stripUrl,
  truncate,
  utf8Length,
} from '../src/wire';

describe('URL stripping', () => {
  it('drops query string and fragment by default', () => {
    expect(stripUrl('https://app.example.com/a/b?token=secret#frag', false)).toBe('https://app.example.com/a/b');
  });

  it('keeps the query string only when opted in, never the fragment', () => {
    expect(stripUrl('https://app.example.com/a?x=1#f', true)).toBe('https://app.example.com/a?x=1');
  });

  it('rejects non-http URLs and garbage', () => {
    expect(stripUrl('javascript:alert(1)', false)).toBeUndefined();
    expect(stripUrl('not a url', false)).toBeUndefined();
    expect(stripUrl('', false)).toBeUndefined();
  });

  it('caps url at 2048', () => {
    const long = `https://a.example/${'x'.repeat(5000)}`;
    expect(stripUrl(long, false)!.length).toBe(CAPS.url);
  });

  it('error src is file:line:col without query or hash', () => {
    expect(stripSrc('https://cdn.example/app.js?v=123#x', 10, 4)).toBe('https://cdn.example/app.js:10:4');
    expect(stripSrc('', 1, 1)).toBeUndefined();
  });

  it('shapePage strips the query, omits title in strict privacy, caps fields', () => {
    const base = {
      href: 'https://app.example.com/checkout?email=a@b.c',
      pathname: '/checkout',
      title: 'Order for Alice',
      vw: 1280.4,
      vh: 720,
      captureQueryString: false,
    };
    const strict = shapePage({ ...base, includeTitle: false });
    expect(strict).toEqual({ url: 'https://app.example.com/checkout', path: '/checkout', vw: 1280, vh: 720 });
    const balanced = shapePage({ ...base, title: 't'.repeat(400), includeTitle: true, referrer: 'https://x.example/' });
    expect(balanced.title!.length).toBe(CAPS.title);
    expect(balanced.referrer).toBe('https://x.example/');
    expect(shapePage({ ...base, pathname: `/${'p'.repeat(3000)}`, includeTitle: false }).path.length).toBe(CAPS.path);
  });
});

describe('field caps', () => {
  it('props: at most 20, scalars only, long strings capped', () => {
    const props: Record<string, unknown> = { obj: { a: 1 }, nan: Number.NaN, fn: () => 1 };
    for (let i = 0; i < 30; i++) props[`k${i}`] = i;
    props.long = 'z'.repeat(5000);
    const shaped = shapeProps(props)!;
    expect(Object.keys(shaped)).toHaveLength(CAPS.props);
    expect(shaped).not.toHaveProperty('obj');
    expect(shaped).not.toHaveProperty('nan');
    expect(shaped).not.toHaveProperty('fn');
    expect(shapeProps({ s: 'y'.repeat(5000) })!.s).toHaveLength(CAPS.propValue);
    expect(shapeProps({})).toBeUndefined();
    expect(shapeProps(null)).toBeUndefined();
  });

  it('uid capped at 128 and blank ids ignored', () => {
    expect(sanitizeUid('u'.repeat(300))!.length).toBe(CAPS.uid);
    expect(sanitizeUid('   ')).toBeUndefined();
    expect(sanitizeUid({})).toBeUndefined();
  });

  it('truncate never splits a surrogate pair', () => {
    expect(truncate('ab😀', 3)).toBe('ab');
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('utf8Length matches TextEncoder', () => {
    const s = 'aé€😀';
    expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });
});

describe('ingest URL', () => {
  it('builds the spec endpoint with key and optional enc=gzip', () => {
    expect(ingestUrl('https://p.example/', 'pk_a b', false)).toBe('https://p.example/api/ingest/browser?key=pk_a%20b');
    expect(ingestUrl('https://p.example', 'pk', true)).toBe('https://p.example/api/ingest/browser?key=pk&enc=gzip');
  });
});
