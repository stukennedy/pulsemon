import { afterEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { NOOP, initPulsemonBrowser, startPulsemonBrowser, type PulsemonBrowser, type RecordFn, type StartDeps } from '../src/browser';
import { SESSION_IDLE_MS } from '../src/session';
import type { FetchLike } from '../src/transport';
import type { BrowserBatch } from '../src/wire';
import { optionsFromDataset } from '../src/script-tag';

type Win = Parameters<typeof startPulsemonBrowser>[0];

const handles: PulsemonBrowser[] = [];
const windows: Window[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) h.stop();
  for (const w of windows.splice(0)) await w.happyDOM.close();
});

function setup(
  opts: Parameters<typeof startPulsemonBrowser>[1] = {},
  extra: { url?: string; random?: () => number; html?: string } = {},
) {
  const window = new Window({ url: extra.url ?? 'https://app.example.com/start?token=secret#h', width: 1280, height: 720 });
  windows.push(window);
  window.document.body.innerHTML =
    extra.html ??
    '<main><button id="buy">Buy for Alice</button><input id="email" type="email"><p class="copy">Hello Alice</p></main>';
  const clock = { t: 1_700_000_000_000 };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 202 };
  };
  const recordCalls: Array<Record<string, unknown>> = [];
  let emit: ((e: unknown) => void) | undefined;
  const record = ((o: Record<string, unknown>) => {
    recordCalls.push(o);
    emit = o.emit as (e: unknown) => void;
    return () => {
      emit = undefined;
    };
  }) as unknown as RecordFn;
  const deps: StartDeps = {
    record,
    now: () => clock.t,
    random: extra.random ?? (() => 0),
    beacon: undefined,
    CompressionStream: undefined,
  };
  const handle = startPulsemonBrowser(
    window as unknown as Win,
    { endpoint: 'https://pulsemon.example.com', key: 'pk_test', fetch, flushIntervalMs: 60_000, ...opts },
    deps,
  );
  handles.push(handle);
  const batches = (): BrowserBatch[] => calls.map((c) => JSON.parse(String(c.init.body)) as BrowserBatch);
  const events = () => batches().flatMap((b) => b.events);
  return { window, clock, calls, handle, batches, events, recordCalls, emit: (e: unknown) => emit?.(e) };
}

function click(window: Window, target: Element, x: number, y: number): void {
  const ev = new window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
  target.dispatchEvent(ev as unknown as Event);
}

describe('inert handle', () => {
  it('outside a browser', () => {
    expect(initPulsemonBrowser({ endpoint: 'https://x', key: 'k' })).toBe(NOOP);
  });

  it('without endpoint or key', async () => {
    for (const opts of [{ endpoint: '' }, { key: '  ' }, { endpoint: undefined, key: undefined }]) {
      const { handle, calls } = setup(opts);
      expect(handle).toBe(NOOP);
      handle.track('x');
      await handle.flush();
      expect(calls).toHaveLength(0);
    }
  });

  it('when the session is sampled out: nothing is sent, nothing is recorded', async () => {
    const { handle, calls, recordCalls, window } = setup({ sessionSampleRate: 0.5 }, { random: () => 0.9 });
    expect(handle).toBe(NOOP);
    expect(handle.sessionId).toBe('');
    click(window, window.document.getElementById('buy') as unknown as Element, 1, 1);
    handle.track('x');
    await handle.flush();
    expect(calls).toHaveLength(0);
    expect(recordCalls).toHaveLength(0);
  });
});

describe('payload', () => {
  it('first flush carries a spec-shaped batch with a pageview, stripped URL, no title in strict mode', async () => {
    const { handle, calls, batches } = setup();
    await handle.flush();
    expect(calls[0]!.url).toBe('https://pulsemon.example.com/api/ingest/browser?key=pk_test');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    const b = batches()[0]!;
    expect(b.v).toBe(1);
    expect(b.sid).toBe(handle.sessionId);
    expect(b.sid).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(b.seq).toBe(0);
    expect(b.page).toEqual({ url: 'https://app.example.com/start', path: '/start', vw: 1280, vh: 720 });
    expect(b.rrweb).toEqual([]);
    expect(b.events).toEqual([{ t: expect.any(Number), type: 'pageview', path: '/start', vw: 1280, vh: 720, dh: expect.any(Number) }]);
  });

  it('balanced privacy includes the title; captureQueryString keeps the query', async () => {
    const { handle, batches, window } = setup({ replay: { privacy: 'balanced' }, captureQueryString: true });
    window.document.title = 'Shop';
    await handle.flush();
    expect(batches()[0]!.page).toMatchObject({ url: 'https://app.example.com/start?token=secret', title: 'Shop' });
  });

  it('seq increases per batch and uid rides once identified', async () => {
    const { handle, batches } = setup();
    await handle.flush();
    handle.identify('user-42');
    handle.track('signup', { plan: 'pro', seats: 3, nested: { no: 1 } as unknown as string });
    await handle.flush();
    const [a, b] = batches();
    expect(a!.seq).toBe(0);
    expect(a).not.toHaveProperty('uid');
    expect(b!.seq).toBe(1);
    expect(b!.uid).toBe('user-42');
    expect(b!.events).toEqual([{ t: expect.any(Number), type: 'custom', path: '/start', name: 'signup', props: { plan: 'pro', seats: 3 } }]);
  });

  it('omits rrweb when replay is sampled out', async () => {
    const { handle, batches, recordCalls } = setup({ replay: { sampleRate: 0 } });
    await handle.flush();
    expect(batches()[0]).not.toHaveProperty('rrweb');
    expect(recordCalls).toHaveLength(0);
  });
});

describe('replay privacy', () => {
  it('strict: masks inputs and all text, unmask region shows verbatim, blocks block region', () => {
    const { recordCalls, window } = setup(
      {},
      { html: '<p id="a">Alice</p><div data-pulsemon-unmask><p id="b">Public copy</p></div>' },
    );
    const o = recordCalls[0]!;
    expect(o.maskAllInputs).toBe(true);
    expect(o.maskTextSelector).toBe('*');
    expect(o.blockSelector).toBe('[data-pulsemon-block]');
    const fn = o.maskTextFn as (t: string, el: unknown) => string;
    expect(fn('Alice Smith', window.document.getElementById('a'))).toBe('***** *****');
    expect(fn('Public copy', window.document.getElementById('b'))).toBe('Public copy');
    expect(fn('x', null)).toBe('*');
  });

  it('balanced: masks inputs only', () => {
    const { recordCalls } = setup({ replay: { privacy: 'balanced' } });
    const o = recordCalls[0]!;
    expect(o.maskAllInputs).toBe(true);
    expect(o.maskTextSelector).toBeUndefined();
    expect(o.maskTextFn).toBeUndefined();
  });

  it('strips the query string from rrweb Meta href', async () => {
    const { handle, batches, emit } = setup();
    emit({ type: 4, data: { href: 'https://app.example.com/start?token=secret', width: 1, height: 1 }, timestamp: 1 });
    emit({ type: 2, data: { node: {} }, timestamp: 2 });
    await handle.flush();
    const rr = batches()[0]!.rrweb as Array<{ type: number; data: { href?: string } }>;
    expect(rr.map((e) => e.type)).toEqual([4, 2]);
    expect(rr[0]!.data.href).toBe('https://app.example.com/start');
  });
});

describe('clicks', () => {
  it('click with a DOM mutation inside 1 s is a plain click, carrying selector not text', async () => {
    const { handle, events, window, clock } = setup();
    const btn = window.document.getElementById('buy') as unknown as Element;
    click(window, btn, 40, 50);
    clock.t += 100;
    window.document.body.appendChild(window.document.createElement('div'));
    await new Promise((r) => setTimeout(r, 0));
    clock.t += 1000;
    await handle.flush();
    const c = events().find((e) => e.type.endsWith('click'))!;
    expect(c).toMatchObject({ type: 'click', path: '/start', sel: 'button#buy', x: 40, y: 50, vw: 1280, vh: 720 });
    expect(JSON.stringify(c)).not.toContain('Alice');
  });

  it('a click that changes nothing is a dead click; form controls are exempt', async () => {
    const { handle, events, window, clock } = setup();
    click(window, window.document.querySelector('p.copy') as unknown as Element, 5, 5);
    clock.t += 10;
    click(window, window.document.getElementById('email') as unknown as Element, 300, 300);
    clock.t += 1100;
    await handle.flush();
    expect(events().filter((e) => e.type.endsWith('click')).map((e) => e.type)).toEqual(['dead_click', 'click']);
  });

  it('third quick click in place is a rage click', async () => {
    const { handle, events, window, clock } = setup();
    const p = window.document.querySelector('p.copy') as unknown as Element;
    for (let i = 0; i < 4; i++) {
      click(window, p, 10 + i, 10);
      clock.t += 150;
    }
    clock.t += 1100;
    await handle.flush();
    expect(events().filter((e) => e.type.endsWith('click')).map((e) => e.type)).toEqual([
      'dead_click',
      'dead_click',
      'rage_click',
      'rage_click',
    ]);
  });
});

describe('navigation, scroll and errors', () => {
  it('pushState to a new path emits the previous page scroll, then a pageview', async () => {
    const { handle, events, window, batches } = setup();
    window.history.pushState({}, '', '/next?q=1');
    window.history.replaceState({}, '', '/next?q=2');
    await handle.flush();
    const types = events().map((e) => `${e.type}:${e.path}`);
    expect(types).toEqual(['pageview:/start', 'scroll:/start', 'pageview:/next']);
    expect(batches()[0]!.page.referrer).toBe('https://app.example.com/start');
    expect(batches()[0]!.page.url).toBe('https://app.example.com/next');
  });

  it('hiding the tab sends the scroll depth once', async () => {
    const { handle, events, window } = setup();
    Object.defineProperty(window.document, 'visibilityState', { value: 'hidden', configurable: true });
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await handle.flush();
    const scrolls = events().filter((e) => e.type === 'scroll');
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]).toMatchObject({ path: '/start', vw: 1280 });
    expect((scrolls[0] as { depth: number }).depth).toBeGreaterThan(0);
  });

  it('window errors become error events with a query-free src and capped msg', async () => {
    const { handle, events, window } = setup();
    window.dispatchEvent(
      new window.ErrorEvent('error', {
        message: 'boom '.repeat(200),
        filename: 'https://cdn.example.com/app.js?v=9',
        lineno: 12,
        colno: 3,
      }),
    );
    await handle.flush();
    const err = events().find((e) => e.type === 'error') as { msg: string; src: string };
    expect(err.msg.length).toBe(500);
    expect(err.src).toBe('https://cdn.example.com/app.js:12:3');
  });
});

describe('session rotation and resilience', () => {
  it('30 minutes idle then a click starts a new session with seq 0; the old buffer ships under the old sid', async () => {
    const { handle, batches, window, clock } = setup();
    const first = handle.sessionId;
    handle.track('before');
    clock.t += SESSION_IDLE_MS + 1;
    click(window, window.document.getElementById('buy') as unknown as Element, 1, 1);
    await handle.flush();
    const all = batches();
    expect(all[0]!.sid).toBe(first);
    expect(all[0]!.events.map((e) => e.type)).toContain('custom');
    const second = all.find((b) => b.sid !== first)!;
    expect(second.sid).toBe(handle.sessionId);
    expect(second.seq).toBe(0);
    expect(second.events[0]!.type).toBe('pageview');
  });

  it('requeues a batch once on network failure, then drops it', async () => {
    const window = new Window({ url: 'https://app.example.com/' });
    windows.push(window);
    let attempts = 0;
    const bodies: string[] = [];
    const handle = startPulsemonBrowser(
      window as unknown as Win,
      {
        endpoint: 'https://p.example',
        key: 'k',
        replay: { enabled: false },
        fetch: async (_url, init) => {
          attempts++;
          bodies.push(String(init.body));
          throw new TypeError('offline');
        },
      },
      { beacon: undefined, CompressionStream: undefined },
    );
    handles.push(handle);
    await handle.flush();
    await handle.flush();
    await handle.flush();
    expect(attempts).toBe(2);
    expect(bodies[0]).toBe(bodies[1]!);
  });

  it('never throws into the page even if fetch throws synchronously', async () => {
    const window = new Window({ url: 'https://app.example.com/' });
    windows.push(window);
    const handle = startPulsemonBrowser(
      window as unknown as Win,
      {
        endpoint: 'https://p.example',
        key: 'k',
        fetch: () => {
          throw new Error('sync');
        },
      },
      { record: (() => { throw new Error('rrweb'); }) as unknown as RecordFn, beacon: undefined, CompressionStream: undefined },
    );
    handles.push(handle);
    expect(() => handle.track('x', { a: 1 })).not.toThrow();
    await expect(handle.flush()).resolves.toBeUndefined();
  });
});

describe('script tag options', () => {
  it('reads data-* attributes', () => {
    expect(
      optionsFromDataset({
        endpoint: 'https://p',
        key: 'pk',
        replay: 'false',
        privacy: 'balanced',
        replaySampleRate: '0.5',
        sessionSampleRate: '0.25',
        captureQueryString: 'true',
        flushIntervalMs: '2000',
      }),
    ).toEqual({
      endpoint: 'https://p',
      key: 'pk',
      replay: { enabled: false, sampleRate: 0.5, privacy: 'balanced' },
      sessionSampleRate: 0.25,
      captureQueryString: true,
      flushIntervalMs: 2000,
    });
  });
});
