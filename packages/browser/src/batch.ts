import { MAX_BODY_BYTES, MAX_EVENTS_PER_BATCH, MAX_RRWEB_PER_BATCH, utf8Length, type PageInfo } from './wire';

/** A pre-serialised wire item: rrweb events are stringified once, on arrival, and never again. */
export interface Sized {
  json: string;
  bytes: number;
}

export interface ReplayItem extends Sized {
  type: number;
}

export function sized(value: unknown): Sized {
  const json = JSON.stringify(value);
  return { json, bytes: utf8Length(json) };
}

export interface BatchHeader {
  sid: string;
  uid?: string | undefined;
  page: PageInfo;
}

export interface PackLimits {
  maxBytes: number;
  maxEvents: number;
  maxRrweb: number;
}

export const DEFAULT_LIMITS: PackLimits = {
  maxBytes: MAX_BODY_BYTES,
  maxEvents: MAX_EVENTS_PER_BATCH,
  maxRrweb: MAX_RRWEB_PER_BATCH,
};

export interface PackedBatch {
  seq: number;
  body: string;
}

export interface PackResult {
  batches: PackedBatch[];
  /** Items that alone exceed the body limit; the receiver would reject them, so they are dropped. */
  dropped: number;
}

/**
 * Splits buffered items into wire bodies that each respect the byte and count
 * limits. `rrweb === undefined` means replay is off for this session, which the
 * spec signals by omitting the field rather than sending an empty array.
 */
export function packBatches(
  header: BatchHeader,
  events: Sized[],
  rrweb: Sized[] | undefined,
  startSeq: number | ((count: number) => number),
  limits: PackLimits = DEFAULT_LIMITS,
): PackResult {
  const head: Record<string, unknown> = { v: 1, sid: header.sid, seq: 0 };
  if (header.uid) head.uid = header.uid;
  head.page = header.page;
  const prefix = (seq: number): string => JSON.stringify({ ...head, seq }).slice(0, -1);
  // Sized for the largest seq the session could plausibly reach so a split never overflows by a digit.
  const overhead = utf8Length(prefix(Number.MAX_SAFE_INTEGER)) + utf8Length(',"rrweb":[],"events":[]}');

  interface Group {
    events: string[];
    rrweb: string[];
    bytes: number;
  }
  const groups: Group[] = [];
  let dropped = 0;
  const fresh = (): Group => ({ events: [], rrweb: [], bytes: overhead });
  let cur = fresh();

  const place = (item: Sized, kind: 'events' | 'rrweb'): void => {
    const cost = item.bytes + 1;
    if (overhead + cost > limits.maxBytes) {
      dropped++;
      return;
    }
    const countFull =
      kind === 'events' ? cur.events.length >= limits.maxEvents : cur.rrweb.length >= limits.maxRrweb;
    if (countFull || cur.bytes + cost > limits.maxBytes) {
      groups.push(cur);
      cur = fresh();
    }
    cur[kind].push(item.json);
    cur.bytes += cost;
  };

  for (const e of events) place(e, 'events');
  if (rrweb) for (const r of rrweb) place(r, 'rrweb');
  if (cur.events.length || cur.rrweb.length) groups.push(cur);

  const first = !groups.length ? 0 : typeof startSeq === 'number' ? startSeq : startSeq(groups.length);
  const batches = groups.map((g, i) => {
    const seq = first + i;
    const replay = rrweb ? `,"rrweb":[${g.rrweb.join(',')}]` : '';
    return { seq, body: `${prefix(seq)}${replay},"events":[${g.events.join(',')}]}` };
  });
  return { batches, dropped };
}

const FULL_SNAPSHOT = 2;
const META = 4;

/**
 * Bounds the replay buffer when flushes keep failing. Everything before the
 * latest full snapshot (and its Meta) is useless for replay once that snapshot
 * exists, so it goes first. If the tail since that snapshot is itself over the
 * cap, the whole buffer is discarded and the caller must take a fresh full
 * snapshot, because incremental events without their base cannot be replayed.
 */
export function trimReplay(
  items: ReplayItem[],
  capBytes: number,
): { items: ReplayItem[]; bytes: number; resnapshot: boolean } {
  const total = items.reduce((n, i) => n + i.bytes, 0);
  if (total <= capBytes) return { items, bytes: total, resnapshot: false };
  let snap = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.type === FULL_SNAPSHOT) {
      snap = i;
      break;
    }
  }
  if (snap > 0) {
    const start = items[snap - 1]!.type === META ? snap - 1 : snap;
    const tail = items.slice(start);
    const bytes = tail.reduce((n, i) => n + i.bytes, 0);
    if (bytes <= capBytes) return { items: tail, bytes, resnapshot: false };
  }
  return { items: [], bytes: 0, resnapshot: true };
}
