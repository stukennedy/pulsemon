import { describe, expect, it, mock } from 'bun:test';
import { createPulsemonClient, MAX_BUFFERED } from '../src/client';
import { scrubAttributes } from '../src/scrub';
import type { FetchLike } from '../src/index';

const CONFIG = {
  PULSEMON_INGEST_URL: 'https://pulsemon.example.com/',
  PULSEMON_INGEST_KEY: 'ingest-key',
};

function recordingFetch(): { fetch: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202 };
    },
  };
}

type Batch = Record<string, Array<Record<string, unknown>>>;
const bodyOf = (init: RequestInit): Batch => JSON.parse(String(init.body)) as Batch;

/** Poll until `cond` holds (bun:test ships no waitFor); fails loudly after ~1s. */
async function until(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

describe('createPulsemonClient — inert without config', () => {
  it.each([
    ['no url', { PULSEMON_INGEST_KEY: 'k' }],
    ['no key', { PULSEMON_INGEST_URL: 'https://x' }],
    ['neither', {}],
    ['blank strings', { PULSEMON_INGEST_URL: '   ', PULSEMON_INGEST_KEY: '  ' }],
  ])('%s → a hard no-op, not a degraded mode', async (_label, config) => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(config, { fetch });
    expect(client.enabled).toBe(false);
    client.log({ level: 'error', service: 's', message: 'm' });
    client.voiceTurn({ connectionId: 'c', role: 'agent' });
    await client.flush();
    expect(calls).toHaveLength(0);
    expect(client.pending).toBe(0);
  });
});

describe('content capture gate', () => {
  it('strips transcript at buffer time when capture is not enabled', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.voiceTurn({ connectionId: 'c', role: 'agent', transcript: 'the user said this' });
    await client.flush();
    const [turn] = bodyOf(calls[0]!.init).voice_turns!;
    expect(turn).not.toHaveProperty('transcript');
  });

  it.each([
    ['"TRUE"', 'TRUE'],
    ['"1"', '1'],
    ['"yes"', 'yes'],
    ['"false"', 'false'],
  ])('%s is NOT capture — only the exact string "true" opens the gate', async (_label, value) => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient({ ...CONFIG, PULSEMON_CONTENT_CAPTURE: value }, { fetch });
    client.voiceTurn({ connectionId: 'c', role: 'agent', transcript: 'nope' });
    await client.flush();
    expect(bodyOf(calls[0]!.init).voice_turns![0]).not.toHaveProperty('transcript');
  });

  it('passes transcript through when PULSEMON_CONTENT_CAPTURE is "true"', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(
      { ...CONFIG, PULSEMON_CONTENT_CAPTURE: 'true' },
      { fetch },
    );
    client.voiceTurn({ connectionId: 'c', role: 'user', transcript: 'what does that mean?' });
    await client.flush();
    expect(bodyOf(calls[0]!.init).voice_turns![0]).toMatchObject({
      transcript: 'what does that mean?',
    });
  });
});

describe('batching', () => {
  it('sends ONE request for many records, to /api/ingest/batch', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.span({ traceId: 't', service: 's', operation: 'GET /x' });
    client.log({ level: 'info', service: 's', message: 'hello' });
    client.voiceTurn({ connectionId: 'c', role: 'agent', llmLatencyMs: 120 });
    client.connection({ id: 'c', service: 's', connectionType: 'webrtc' });
    client.connectionUpdate({ id: 'c', status: 'closed' });
    expect(client.pending).toBe(5);

    await client.flush();

    expect(calls).toHaveLength(1);
    // Trailing slash on the configured URL must not double up.
    expect(calls[0]?.url).toBe('https://pulsemon.example.com/api/ingest/batch');
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer ingest-key' });
    const body = bodyOf(calls[0]!.init);
    expect(body.spans).toHaveLength(1);
    expect(body.logs).toHaveLength(1);
    expect(body.voice_turns).toHaveLength(1);
    expect(body.connections).toHaveLength(1);
    expect(body.connection_updates).toHaveLength(1);
    expect(client.pending).toBe(0);
  });

  it('omits empty collections rather than sending empty arrays', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.log({ level: 'info', service: 's', message: 'only a log' });
    await client.flush();
    expect(Object.keys(bodyOf(calls[0]!.init))).toEqual(['logs']);
  });

  it('does not call the network when there is nothing buffered', async () => {
    const { fetch, calls } = recordingFetch();
    await createPulsemonClient(CONFIG, { fetch }).flush();
    expect(calls).toHaveLength(0);
  });

  it('can flush records added after an earlier empty flush', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    await client.flush();
    client.log({ level: 'info', service: 's', message: 'later' });

    await client.flush();

    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0]!.init).logs?.[0]).toMatchObject({ message: 'later' });
  });

  it('sheds the oldest records rather than growing without bound', () => {
    const { fetch } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    for (let i = 0; i < MAX_BUFFERED + 50; i++) {
      client.log({ level: 'info', service: 's', message: `m${i}` });
    }
    // A caller that never flushes must not be able to OOM a DO holding a call.
    expect(client.pending).toBeLessThanOrEqual(MAX_BUFFERED);
  });

  it('sheds from the LONGEST kind — a fresh record of a quiet kind survives', async () => {
    // The regression Bugbot caught: shedding from the list just appended to
    // discards the brand-new record whenever it was that list's only entry,
    // while a flood of another kind keeps every one of its older rows.
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    for (let i = 0; i < MAX_BUFFERED; i++) {
      client.log({ level: 'info', service: 's', message: `flood${i}` });
    }
    client.voiceTurn({ connectionId: 'call_1', role: 'agent' });
    expect(client.pending).toBeLessThanOrEqual(MAX_BUFFERED);

    await client.flush();
    const body = bodyOf(calls[0]!.init);
    // The lone voice turn survived; the flood paid the shed.
    expect(body.voice_turns).toHaveLength(1);
    expect((body.logs ?? []).length).toBeLessThan(MAX_BUFFERED);
  });
});

describe('connection lifecycle', () => {
  it('ships connectionUpdate in its own bucket, separate from connections', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.connectionUpdate({ id: 'call_1', status: 'closed', closeReason: 'client_closed' });
    await client.flush();
    const body = bodyOf(calls[0]!.init);
    expect('connections' in body).toBe(false);
    expect(body.connection_updates).toEqual([{ id: 'call_1', status: 'closed', close_reason: 'client_closed' }]);
  });

  it('scrubs connectionUpdate.metadata like every other free-form bag', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.connectionUpdate({
      id: 'call_1',
      status: 'closed',
      metadata: { transcript: 'private words', scanId: 'scan_1' } as never,
    });
    await client.flush();
    const raw = String(calls[0]?.init.body);
    expect(raw).not.toContain('private words');
    expect(raw).toContain('scan_1');
  });
});

describe('never on the critical path', () => {
  it('resolves even when the transport throws', async () => {
    const client = createPulsemonClient(CONFIG, {
      fetch: () => Promise.reject(new Error('pulsemon is down')),
    });
    client.log({ level: 'error', service: 's', message: 'm' });
    await expect(client.flush()).resolves.toBeUndefined();
  });

  it('drops the failed batch instead of replaying it forever', async () => {
    let attempts = 0;
    const client = createPulsemonClient(CONFIG, {
      fetch: () => {
        attempts += 1;
        return Promise.reject(new Error('down'));
      },
    });
    client.log({ level: 'error', service: 's', message: 'm' });
    await client.flush();
    await client.flush();
    expect(attempts).toBe(1);
    expect(client.pending).toBe(0);
  });

  it('serialises concurrent flushes into one request', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    client.log({ level: 'info', service: 's', message: 'a' });
    await Promise.all([client.flush(), client.flush(), client.flush()]);
    expect(calls).toHaveLength(1);
  });

  it('drains records buffered while a flush is in flight before resolving', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createPulsemonClient(CONFIG, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) await firstPending;
        return { ok: true, status: 202 };
      },
    });
    client.log({ level: 'info', service: 's', message: 'first' });

    const flushing = client.flush();
    await until(() => calls.length === 1);
    client.log({ level: 'info', service: 's', message: 'terminal' });
    releaseFirst?.();
    await flushing;

    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]!.init).logs?.[0]).toMatchObject({ message: 'terminal' });
    expect(client.pending).toBe(0);
  });
});

describe('content-free guarantee', () => {
  // This is the privacy control, so it is tested as behaviour rather than
  // trusted to the type system — `Attributes` cannot stop a caller spreading
  // an object through an `as` cast or from untyped JS.
  it('drops attribute keys that name conversation content', () => {
    const scrubbed = scrubAttributes({
      // kept — shape and identity
      scanId: 'scan_1',
      turnIndex: 3,
      interrupted: true,
      // dropped — content
      transcript: 'I spend about four hours a week on reporting',
      message: 'the user said something',
      prompt: 'You are Atlas',
      completion: 'Nice to meet you',
      input: 'tool args',
      output: 'tool result',
      errorMessage: 'boom at line 3',
    } as never);
    expect(scrubbed).toEqual({ scanId: 'scan_1', turnIndex: 3, interrupted: true });
  });

  it('drops non-scalar values, the other way content arrives', () => {
    expect(
      scrubAttributes({ ratings: [{ skill: 'x', band: 'expert' }], ok: true } as never),
    ).toEqual({ ok: true });
  });

  it('returns undefined rather than an empty object when everything is dropped', () => {
    expect(scrubAttributes({ transcript: 'secret' } as never)).toBeUndefined();
    expect(scrubAttributes(undefined)).toBeUndefined();
  });

  it('scrubs on the way into every record kind', async () => {
    const { fetch, calls } = recordingFetch();
    const client = createPulsemonClient(CONFIG, { fetch });
    const dirty = { transcript: 'private words', scanId: 'scan_1' } as never;
    client.span({ traceId: 't', service: 's', operation: 'op', attributes: dirty });
    client.voiceTurn({ connectionId: 'c', role: 'user', metadata: dirty });
    client.toolCall({ toolName: 'submitRatings', metadata: dirty });
    client.event({ eventType: 'e', attributes: dirty });
    client.log({ level: 'info', service: 's', message: 'm', attributes: dirty });
    client.metric({ service: 's', metricName: 'm', metricType: 'counter', value: 1, tags: dirty });
    client.connection({ id: 'c', service: 's', connectionType: 'websocket', metadata: dirty });
    await client.flush();

    const raw = String(calls[0]?.init.body);
    expect(raw).not.toContain('private words');
    expect(raw).toContain('scan_1');
  });
});

describe('flush is the only thing that touches the network', () => {
  it('buffering alone never fetches', () => {
    const fetchSpy = mock(() => undefined);
    const client = createPulsemonClient(CONFIG, { fetch: fetchSpy as unknown as FetchLike });
    client.connection({ id: 'c', service: 's', connectionType: 'websocket' });
    client.connectionUpdate({ id: 'c', status: 'closed' });
    client.voiceTurn({ connectionId: 'c', role: 'agent' });
    client.toolCall({ toolName: 'updateGoal' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.pending).toBe(4);
  });
});
