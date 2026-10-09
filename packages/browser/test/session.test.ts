import { describe, expect, it } from 'bun:test';
import { SESSION_IDLE_MS, SESSION_KEY, SessionStore, clampRate, randomId, type StorageLike } from '../src/session';
import { SID_PATTERN } from '../src/wire';

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function deps(storage: StorageLike | undefined, clock: { t: number }, random = () => 0.5) {
  let n = 0;
  return { storage, now: () => clock.t, random, newId: () => `session-${++n}-${clock.t}` };
}

const ALL = { session: 1, replay: 1 };

describe('session store', () => {
  it('generates ids matching the spec pattern', () => {
    for (let i = 0; i < 50; i++) expect(SID_PATTERN.test(randomId())).toBe(true);
  });

  it('uses one storage key and reuses the session on reload', () => {
    const storage = memoryStorage();
    const clock = { t: 1_000_000 };
    const a = new SessionStore(deps(storage, clock), ALL);
    expect([...storage.map.keys()]).toEqual([SESSION_KEY]);
    clock.t += 60_000;
    const b = new SessionStore(deps(storage, clock), ALL);
    expect(b.current.sid).toBe(a.current.sid);
  });

  it('keeps seq monotonic across reloads', () => {
    const storage = memoryStorage();
    const clock = { t: 1_000_000 };
    const a = new SessionStore(deps(storage, clock), ALL);
    expect(a.reserveSeq(3)).toBe(0);
    const b = new SessionStore(deps(storage, clock), ALL);
    expect(b.reserveSeq(1)).toBe(3);
    expect(b.reserveSeq(2)).toBe(4);
  });

  it('rotates after 30 minutes of inactivity, on reload', () => {
    const storage = memoryStorage();
    const clock = { t: 1_000_000 };
    const a = new SessionStore(deps(storage, clock), ALL);
    a.reserveSeq(5);
    clock.t += SESSION_IDLE_MS + 1;
    const b = new SessionStore(deps(storage, clock), ALL);
    expect(b.current.sid).not.toBe(a.current.sid);
    expect(b.current.seq).toBe(0);
  });

  it('rotates after 30 minutes of inactivity, mid-page', () => {
    const clock = { t: 1_000_000 };
    const s = new SessionStore(deps(memoryStorage(), clock), ALL);
    const first = s.current.sid;
    clock.t += SESSION_IDLE_MS;
    expect(s.touch()).toBe(false);
    clock.t += SESSION_IDLE_MS;
    expect(s.touch()).toBe(false);
    expect(s.current.sid).toBe(first);
    clock.t += SESSION_IDLE_MS + 1;
    expect(s.expired()).toBe(true);
    expect(s.touch()).toBe(true);
    expect(s.current.sid).not.toBe(first);
  });

  it('sampling decision is sticky for the session', () => {
    const storage = memoryStorage();
    const clock = { t: 1_000_000 };
    const out = new SessionStore(deps(storage, clock, () => 0.9), { session: 0.5, replay: 1 });
    expect(out.current.s).toBe(false);
    const again = new SessionStore(deps(storage, clock, () => 0.1), { session: 0.5, replay: 1 });
    expect(again.current.sid).toBe(out.current.sid);
    expect(again.current.s).toBe(false);
  });

  it('replay sampling is independent and only for recorded sessions', () => {
    const clock = { t: 1 };
    expect(new SessionStore(deps(undefined, clock, () => 0.5), { session: 1, replay: 0.4 }).current).toMatchObject({ s: true, r: false });
    expect(new SessionStore(deps(undefined, clock, () => 0.5), { session: 0.4, replay: 1 }).current).toMatchObject({ s: false, r: false });
  });

  it('survives storage that throws', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const s = new SessionStore(deps(throwing, { t: 1 }), ALL);
    expect(s.reserveSeq(1)).toBe(0);
    expect(s.reserveSeq(1)).toBe(1);
  });

  it('ignores a corrupt stored record', () => {
    const storage = memoryStorage();
    storage.setItem(SESSION_KEY, '{"sid":"bad id!","last":1,"seq":0,"s":true,"r":true}');
    const s = new SessionStore(deps(storage, { t: 2 }), ALL);
    expect(SID_PATTERN.test(s.current.sid)).toBe(true);
    expect(s.current.sid).not.toBe('bad id!');
  });

  it('clampRate', () => {
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(2)).toBe(1);
    expect(clampRate(-1)).toBe(0);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});
