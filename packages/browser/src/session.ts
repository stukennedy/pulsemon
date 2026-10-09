import { SID_PATTERN, sanitizeUid } from './wire';

export const SESSION_KEY = 'pulsemon_session';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const WRITE_THROTTLE_MS = 5000;

export interface SessionRecord {
  sid: string;
  /** last activity, epoch ms */
  last: number;
  /** next seq to use */
  seq: number;
  /** session sampled in */
  s: boolean;
  /** replay sampled in */
  r: boolean;
  uid?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionDeps {
  storage: StorageLike | undefined;
  now: () => number;
  random: () => number;
  newId: () => string;
}

export interface SampleRates {
  session: number;
  replay: number;
}

export function clampRate(rate: unknown, fallback = 1): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return fallback;
  return Math.min(1, Math.max(0, rate));
}

export function randomId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(21);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = '';
  for (const b of bytes) id += alphabet[b & 63];
  return id;
}

function parse(raw: string | null): SessionRecord | undefined {
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw) as Partial<SessionRecord>;
    if (
      typeof r.sid !== 'string' ||
      !SID_PATTERN.test(r.sid) ||
      typeof r.last !== 'number' ||
      typeof r.seq !== 'number' ||
      !Number.isInteger(r.seq) ||
      r.seq < 0 ||
      typeof r.s !== 'boolean' ||
      typeof r.r !== 'boolean'
    ) {
      return undefined;
    }
    const rec: SessionRecord = { sid: r.sid, last: r.last, seq: r.seq, s: r.s, r: r.r };
    const uid = sanitizeUid(r.uid);
    if (uid) rec.uid = uid;
    return rec;
  } catch {
    return undefined;
  }
}

/**
 * The SDK's only storage key. Holding seq here keeps it monotonic across
 * reloads; holding the sampling decisions here makes them sticky for the
 * session. Storage can throw (sandboxed iframes, some private modes), in which
 * case the session simply lives as long as the page.
 */
export class SessionStore {
  private rec: SessionRecord;
  private lastWrite = 0;

  constructor(
    private readonly deps: SessionDeps,
    private readonly rates: SampleRates,
  ) {
    const now = deps.now();
    let stored: SessionRecord | undefined;
    try {
      stored = parse(deps.storage?.getItem(SESSION_KEY) ?? null);
    } catch {
      stored = undefined;
    }
    this.rec = stored && now - stored.last <= SESSION_IDLE_MS && now >= stored.last - SESSION_IDLE_MS
      ? { ...stored, last: now }
      : this.fresh(now);
    this.persist(true);
  }

  get current(): Readonly<SessionRecord> {
    return this.rec;
  }

  expired(): boolean {
    return this.deps.now() - this.rec.last > SESSION_IDLE_MS;
  }

  /** Records activity; returns true when the idle gap started a new session. */
  touch(): boolean {
    const now = this.deps.now();
    const rotated = this.expired();
    if (rotated) this.rec = this.fresh(now);
    else this.rec.last = Math.max(this.rec.last, now);
    this.persist(rotated);
    return rotated;
  }

  /** Reserves `n` consecutive seq numbers and returns the first. */
  reserveSeq(n: number): number {
    const start = this.rec.seq;
    this.rec.seq += n;
    this.persist(true);
    return start;
  }

  setUid(uid: string | undefined): void {
    if (uid) this.rec.uid = uid;
    else delete this.rec.uid;
    this.persist(true);
  }

  private fresh(now: number): SessionRecord {
    const s = this.deps.random() < this.rates.session;
    const r = s && this.deps.random() < this.rates.replay;
    return { sid: this.deps.newId(), last: now, seq: 0, s, r };
  }

  private persist(force: boolean): void {
    const now = this.deps.now();
    if (!force && now - this.lastWrite < WRITE_THROTTLE_MS) return;
    this.lastWrite = now;
    try {
      this.deps.storage?.setItem(SESSION_KEY, JSON.stringify(this.rec));
    } catch {
      // storage unavailable or full: the in-memory record still works for this page
    }
  }
}
