import { record as rrwebRecord } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';
import { packBatches, sized, trimReplay, type ReplayItem, type Sized } from './batch';
import {
  DEAD_WINDOW_MS,
  DeadClickJudge,
  RageDetector,
  buildSelector,
  isFormControl,
  scrollDepthPercent,
  type ElementLike,
} from './interactions';
import { SessionStore, clampRate, randomId, type StorageLike } from './session';
import { sendBody, type BeaconLike, type FetchLike, type TransportConfig } from './transport';
import {
  CAPS,
  sanitizeUid,
  shapePage,
  shapeProps,
  stripSrc,
  stripUrl,
  truncate,
  type BrowserEvent,
  type Scalar,
} from './wire';

export interface ReplayOptions {
  /** Default true. */
  enabled?: boolean;
  /** Fraction of recorded sessions that also capture replay. Default 1. */
  sampleRate?: number;
  /** Default "strict": all text masked unless inside `[data-pulsemon-unmask]`. */
  privacy?: 'strict' | 'balanced';
}

export interface PulsemonBrowserOptions {
  /** Base URL of the Pulsemon deployment. */
  endpoint?: string | undefined;
  /** Public browser key from BROWSER_INGEST_KEYS. */
  key?: string | undefined;
  replay?: ReplayOptions;
  /** Fraction of sessions recorded at all. Default 1. */
  sessionSampleRate?: number;
  /** Default false. */
  captureQueryString?: boolean;
  /** Default 5000. */
  flushIntervalMs?: number;
  fetch?: FetchLike;
}

export interface PulsemonBrowser {
  /** Empty when inert. Changes if the session rotates after 30 minutes idle. */
  readonly sessionId: string;
  identify(id: string): void;
  track(name: string, props?: Record<string, Scalar>): void;
  /** Always resolves. */
  flush(): Promise<void>;
  stop(): void;
}

export type RecordFn = typeof rrwebRecord;

export interface StartDeps {
  record?: RecordFn | undefined;
  now?: () => number;
  random?: () => number;
  newId?: () => string;
  beacon?: BeaconLike | undefined;
  CompressionStream?: typeof CompressionStream | undefined;
}

export const NOOP: PulsemonBrowser = Object.freeze({
  sessionId: '',
  identify: () => {},
  track: () => {},
  flush: () => Promise.resolve(),
  stop: () => {},
});

const REPLAY_CAP_BYTES = 5 * 1024 * 1024;
const EARLY_FLUSH_BYTES = 768 * 1024;
const MAX_BUFFERED_EVENTS = 1000;
const MAX_ERRORS_PER_PAGE = 100;
const SCROLL_SAMPLE_MS = 200;
const META = 4;

type Win = Window & typeof globalThis;

function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch {
      // never throw into the host page
    }
  };
}

function sessionStorageOf(win: Win): StorageLike | undefined {
  try {
    return win.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function initPulsemonBrowser(options: PulsemonBrowserOptions): PulsemonBrowser {
  try {
    if (typeof window === 'undefined') return NOOP;
    return startPulsemonBrowser(window as Win, options, {});
  } catch {
    return NOOP;
  }
}

export function startPulsemonBrowser(win: Win, options: PulsemonBrowserOptions, deps: StartDeps): PulsemonBrowser {
  const endpoint = options?.endpoint?.trim();
  const key = options?.key?.trim();
  if (!endpoint || !key) return NOOP;
  const doFetch: FetchLike | undefined = options.fetch ?? (typeof win.fetch === 'function' ? win.fetch.bind(win) : undefined);
  if (!doFetch) return NOOP;

  const now = deps.now ?? Date.now;
  const doc = win.document;
  const replayOpts = options.replay ?? {};
  const replayEnabled = replayOpts.enabled !== false;
  const strict = replayOpts.privacy !== 'balanced';
  const captureQuery = options.captureQueryString === true;

  const store = new SessionStore(
    { storage: sessionStorageOf(win), now, random: deps.random ?? Math.random, newId: deps.newId ?? randomId },
    { session: clampRate(options.sessionSampleRate), replay: replayEnabled ? clampRate(replayOpts.sampleRate) : 0 },
  );
  if (!store.current.s) return NOOP;

  const nav = win.navigator;
  const transport: TransportConfig = {
    endpoint,
    key,
    fetch: doFetch,
    beacon:
      'beacon' in deps
        ? deps.beacon
        : typeof nav?.sendBeacon === 'function'
          ? (url, data) => nav.sendBeacon(url, data)
          : undefined,
    CompressionStream: 'CompressionStream' in deps ? deps.CompressionStream : (win.CompressionStream ?? undefined),
  };
  const record = deps.record ?? rrwebRecord;

  let events: Sized[] = [];
  let replay: ReplayItem[] = [];
  let replayBytes = 0;
  let retry: Array<{ body: string }> = [];
  let stopped = false;
  let stopRecording: (() => void) | undefined;
  let trimming = false;

  let currentPath = win.location.pathname;
  let currentHref = win.location.href;
  let referrer = stripUrl(doc.referrer, false);
  let maxDepth = 0;
  let sentDepth = -1;
  let errorsThisPage = 0;
  let lastScrollSample = 0;
  let earlyFlush: ReturnType<typeof setTimeout> | undefined;

  const rage = new RageDetector();
  type ClickDraft = Omit<Extract<BrowserEvent, { sel: string }>, 'type'> & { rage: boolean };
  const judge = new DeadClickJudge<ClickDraft>();
  let judgeTimer: ReturnType<typeof setTimeout> | undefined;

  const vw = (): number => Math.round(win.innerWidth || doc.documentElement?.clientWidth || 0);
  const vh = (): number => Math.round(win.innerHeight || doc.documentElement?.clientHeight || 0);
  const dh = (): number =>
    Math.round(Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0, vh()));
  const path = (): string => truncate(currentPath || '/', CAPS.path);

  const push = (ev: BrowserEvent): void => {
    events.push(sized(ev));
    if (events.length > MAX_BUFFERED_EVENTS) events = events.slice(-MAX_BUFFERED_EVENTS);
  };

  const sampleDepth = (): void => {
    maxDepth = Math.max(maxDepth, scrollDepthPercent(win.scrollY ?? 0, vh(), dh()));
  };

  const emitScroll = (): void => {
    sampleDepth();
    if (maxDepth <= sentDepth) return;
    sentDepth = maxDepth;
    push({ t: now(), type: 'scroll', path: path(), depth: maxDepth, vw: vw(), dh: dh() });
  };

  const emitPageview = (): void => {
    maxDepth = 0;
    sentDepth = -1;
    errorsThisPage = 0;
    sampleDepth();
    push({ t: now(), type: 'pageview', path: path(), vw: vw(), vh: vh(), dh: dh() });
  };

  const resolveClicks = (force: boolean): void => {
    for (const { payload, dead } of judge.drain(now(), force)) {
      const { rage: isRage, ...click } = payload;
      push({ ...click, type: isRage ? 'rage_click' : dead ? 'dead_click' : 'click' });
    }
    if (judgeTimer !== undefined) clearTimeout(judgeTimer);
    judgeTimer = undefined;
    if (judge.size && !stopped) judgeTimer = setTimeout(safe(() => resolveClicks(false)), DEAD_WINDOW_MS + 50);
  };

  const pushReplay = (e: eventWithTime): void => {
    if (stopped) return;
    let ev = e;
    // rrweb's Meta carries location.href verbatim; the query-string rule applies to replay too.
    if (e.type === META) {
      const data = e.data as { href?: string };
      ev = { ...e, data: { ...data, href: stripUrl(data.href, captureQuery) ?? '' } } as eventWithTime;
    }
    const item = sized(ev);
    replay.push({ ...item, type: ev.type });
    replayBytes += item.bytes;
    if (replayBytes > REPLAY_CAP_BYTES && !trimming) {
      trimming = true;
      try {
        const trimmed = trimReplay(replay, REPLAY_CAP_BYTES);
        replay = trimmed.items;
        replayBytes = trimmed.bytes;
        if (trimmed.resnapshot) record.takeFullSnapshot?.(true);
      } finally {
        trimming = false;
      }
    }
    if (replayBytes > EARLY_FLUSH_BYTES && earlyFlush === undefined) {
      earlyFlush = setTimeout(() => {
        earlyFlush = undefined;
        void flush(false);
      }, 0);
    }
  };

  const maskText = (text: string, el: HTMLElement | null): string => {
    try {
      if (el?.closest?.('[data-pulsemon-unmask]')) return text;
    } catch {
      // fall through to masking
    }
    return text.replace(/\S/g, '*');
  };

  const startRecording = (): void => {
    if (stopRecording || !store.current.r) return;
    try {
      stopRecording =
        record({
          emit: safe(pushReplay),
          maskAllInputs: true,
          blockSelector: '[data-pulsemon-block]',
          ...(strict ? { maskTextSelector: '*', maskTextFn: maskText } : {}),
          errorHandler: () => true,
        }) ?? undefined;
    } catch {
      stopRecording = undefined;
    }
  };

  const stopRecordingNow = (): void => {
    try {
      stopRecording?.();
    } catch {
      // ignore
    }
    stopRecording = undefined;
  };

  let flushing: Promise<void> = Promise.resolve();

  const drain = (unloading: boolean): string[] => {
    resolveClicks(unloading);
    if (unloading) emitScroll();
    const sess = store.current;
    const evs = events;
    const rr = sess.r ? replay : undefined;
    events = [];
    replay = [];
    replayBytes = 0;
    if (!evs.length && !rr?.length) return [];
    const page = shapePage({
      href: win.location.href,
      pathname: win.location.pathname,
      title: doc.title,
      referrer,
      vw: vw(),
      vh: vh(),
      captureQueryString: captureQuery,
      includeTitle: !strict,
    });
    const header = { sid: sess.sid, uid: sess.uid, page };
    return packBatches(header, evs, rr, (n) => store.reserveSeq(n)).batches.map((b) => b.body);
  };

  const send = async (bodies: Array<{ body: string; retried: boolean }>, unloading: boolean): Promise<void> => {
    const results = await Promise.all(bodies.map((b) => sendBody(b.body, transport, unloading).catch(() => 'network' as const)));
    results.forEach((r, i) => {
      const b = bodies[i]!;
      if (r === 'network' && !b.retried) retry.push({ body: b.body });
    });
    let total = 0;
    retry = retry.filter((r) => (total += r.body.length) <= REPLAY_CAP_BYTES);
  };

  const flush = (unloading: boolean): Promise<void> => {
    try {
      const pendingRetry = retry.map((r) => ({ body: r.body, retried: true }));
      retry = [];
      const fresh = drain(unloading).map((body) => ({ body, retried: false }));
      const all = [...pendingRetry, ...fresh];
      if (!all.length) return flushing;
      // Unload sends start synchronously so beacons queue before the page goes away.
      const run = (): Promise<void> => send(all, unloading).catch(() => {});
      flushing = unloading ? run() : flushing.then(run, run);
      return flushing;
    } catch {
      return Promise.resolve();
    }
  };

  const touch = (): void => {
    if (!store.expired()) {
      store.touch();
      return;
    }
    // Drain under the old sid before rotating; the interaction that woke us belongs to the new session.
    void flush(false);
    store.touch();
    if (!store.current.s) {
      teardown();
      return;
    }
    stopRecordingNow();
    replay = [];
    replayBytes = 0;
    startRecording();
    emitPageview();
  };

  const onClick = safe((e: MouseEvent) => {
    touch();
    const target = e.target as Node | null;
    const el = (target?.nodeType === 1 ? target : (target?.parentElement ?? null)) as ElementLike | null;
    const t = now();
    const x = Math.round((e.clientX || 0) + (win.scrollX || 0));
    const y = Math.round((e.clientY || 0) + (win.scrollY || 0));
    judge.add(
      t,
      { t, path: path(), sel: buildSelector(el), x, y, vw: vw(), vh: vh(), dh: dh(), rage: rage.isRage(t, x, y) },
      !isFormControl(el),
    );
    if (judgeTimer === undefined) judgeTimer = setTimeout(safe(() => resolveClicks(false)), DEAD_WINDOW_MS + 50);
  });

  const onScroll = safe(() => {
    judge.activity(now());
    const t = now();
    if (t - lastScrollSample < SCROLL_SAMPLE_MS) return;
    lastScrollSample = t;
    touch();
    sampleDepth();
  });

  const onKey = safe(() => touch());

  const onLocationChange = safe(() => {
    judge.activity(now());
    const href = win.location.href;
    const p = win.location.pathname;
    if (href === currentHref && p === currentPath) return;
    const previousHref = currentHref;
    currentHref = href;
    if (p === currentPath) return;
    touch();
    emitScroll();
    referrer = stripUrl(previousHref, false);
    currentPath = p;
    emitPageview();
  });

  const onHidden = safe(() => {
    if (doc.visibilityState === 'hidden') void flush(true);
    else touch();
  });
  const onPageHide = safe(() => void flush(true));

  const onError = safe((e: ErrorEvent) => {
    if (typeof e?.message !== 'string' && !e?.error) return;
    if (++errorsThisPage > MAX_ERRORS_PER_PAGE) return;
    const msg = truncate(e.message || String(e.error ?? 'Error'), CAPS.msg);
    const src = stripSrc(e.filename, e.lineno, e.colno);
    push(src ? { t: now(), type: 'error', path: path(), msg, src } : { t: now(), type: 'error', path: path(), msg });
  });

  const onRejection = safe((e: PromiseRejectionEvent) => {
    if (++errorsThisPage > MAX_ERRORS_PER_PAGE) return;
    const reason: unknown = e?.reason;
    let msg: string;
    try {
      msg = reason instanceof Error ? reason.message || reason.name : String(reason);
    } catch {
      msg = 'Unhandled rejection';
    }
    push({ t: now(), type: 'error', path: path(), msg: truncate(msg || 'Unhandled rejection', CAPS.msg) });
  });

  const observer =
    typeof win.MutationObserver === 'function'
      ? new win.MutationObserver(
          safe(() => {
            if (judge.size) judge.activity(now());
          }),
        )
      : undefined;

  const history = win.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const wrap = (orig: History['pushState']): History['pushState'] =>
    function (this: History, ...args: Parameters<History['pushState']>) {
      const result = orig.apply(this, args);
      if (!stopped) onLocationChange();
      return result;
    };
  const patchedPush = wrap(originalPush);
  const patchedReplace = wrap(originalReplace);

  const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions]> = [
    [doc, 'click', onClick as EventListener, { capture: true, passive: true }],
    [doc, 'keydown', onKey as EventListener, { capture: true, passive: true }],
    [win, 'scroll', onScroll as EventListener, { capture: true, passive: true }],
    [win, 'popstate', onLocationChange as EventListener, {}],
    [win, 'hashchange', onLocationChange as EventListener, {}],
    [doc, 'visibilitychange', onHidden as EventListener, {}],
    [win, 'pagehide', onPageHide as EventListener, {}],
    [win, 'error', onError as EventListener, {}],
    [win, 'unhandledrejection', onRejection as EventListener, {}],
  ];

  let interval: ReturnType<typeof setInterval> | undefined;

  function teardown(): void {
    if (stopped) return;
    stopped = true;
    for (const [target, type, fn, opts] of listeners) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        // ignore
      }
    }
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
    // Only unpatch if nobody wrapped history after us; otherwise our wrapper stays, gated by `stopped`.
    if (history.pushState === patchedPush) history.pushState = originalPush;
    if (history.replaceState === patchedReplace) history.replaceState = originalReplace;
    if (interval !== undefined) clearInterval(interval);
    if (judgeTimer !== undefined) clearTimeout(judgeTimer);
    if (earlyFlush !== undefined) clearTimeout(earlyFlush);
    stopRecordingNow();
  }

  for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);
  try {
    observer?.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
    // ignore
  }
  history.pushState = patchedPush;
  history.replaceState = patchedReplace;

  const intervalMs = Math.max(1000, typeof options.flushIntervalMs === 'number' ? options.flushIntervalMs : 5000);
  interval = setInterval(() => void flush(false), intervalMs);

  emitPageview();
  startRecording();

  return {
    get sessionId() {
      return stopped && !store.current.s ? '' : store.current.sid;
    },
    identify: safe((id: string) => {
      if (stopped) return;
      store.setUid(sanitizeUid(id));
    }),
    track: safe((name: string, props?: Record<string, Scalar>) => {
      if (stopped || typeof name !== 'string' || !name) return;
      touch();
      const shaped = shapeProps(props);
      push(
        shaped
          ? { t: now(), type: 'custom', path: path(), name: truncate(name, CAPS.name), props: shaped }
          : { t: now(), type: 'custom', path: path(), name: truncate(name, CAPS.name) },
      );
    }),
    flush: () => (stopped ? flushing.catch(() => {}) : flush(false)),
    stop: safe(() => {
      if (stopped) return;
      void flush(false);
      teardown();
    }),
  };
}
