import { describe, expect, it } from 'bun:test';
import {
  toConnection,
  toConnectionUpdate,
  toEvent,
  toLog,
  toMetric,
  toSpan,
  toToolCall,
  toVoiceTurn,
} from '../src/wire';

/**
 * These pin the WIRE contract, not our own types.
 *
 * The original client was written from Pulsemon's insert helpers rather than
 * the schema its ingest actually validates. The names differ in several places,
 * and timestamps are ISO strings there while every emitter here has epoch
 * milliseconds. Result: a batch that looked correct in review and 400'd on
 * every single request, silently, because ingest is best-effort.
 *
 * The old tests could not catch it — they asserted our types round-tripped
 * through our own client. These assert the bytes.
 */

const AT = Date.parse('2026-08-11T20:00:00.000Z');

describe('timestamps', () => {
  it('go out as ISO-8601 strings, never epoch numbers', () => {
    const span = toSpan({ traceId: 't', service: 's', operation: 'op', startedAt: AT, endedAt: AT });
    expect(span.started_at).toBe('2026-08-11T20:00:00.000Z');
    expect(span.ended_at).toBe('2026-08-11T20:00:00.000Z');
  });

  it('are omitted entirely when unset, rather than sent as null', () => {
    expect('started_at' in toSpan({ traceId: 't', service: 's', operation: 'op' })).toBe(false);
  });
});

describe('field names Pulsemon actually validates', () => {
  it('spans use snake_case correlation keys', () => {
    expect(
      toSpan({ traceId: 't1', connectionId: 'c1', service: 's', operation: 'GET /x', durationMs: 12 }),
    ).toMatchObject({ trace_id: 't1', connection_id: 'c1', duration_ms: 12 });
  });

  it('metrics require metric_type and label with `tags`, not attributes', () => {
    const m = toMetric({
      service: 's',
      metricName: 'llm.cost_usd',
      metricType: 'counter',
      value: 0.4,
      tags: { model: 'haiku' },
    });
    expect(m).toMatchObject({ metric_name: 'llm.cost_usd', metric_type: 'counter', value: 0.4 });
    expect(m.tags).toEqual({ model: 'haiku' });
    expect('attributes' in m).toBe(false);
  });

  it('events carry `data` and no service column', () => {
    const e = toEvent({ eventType: 'voice.turn.completed', traceId: 't', attributes: { ttftMs: 4222 } });
    expect(e).toMatchObject({ event_type: 'voice.turn.completed', trace_id: 't' });
    expect(e.data).toEqual({ ttftMs: 4222 });
    expect('attributes' in e).toBe(false);
    expect('service' in e).toBe(false);
  });

  it('connections use connection_type / client_id / metadata', () => {
    const c = toConnection({ id: 'c', service: 's', connectionType: 'webrtc', clientId: 'x' });
    expect(c).toMatchObject({ connection_type: 'webrtc', client_id: 'x' });
    expect('type' in c).toBe(false);
  });

  it('connection updates carry the required id and snake_case close fields', () => {
    const u = toConnectionUpdate({
      id: 'call_1',
      endedAt: AT,
      durationMs: 42_000,
      closeReason: 'client_closed',
      status: 'closed',
    });
    expect(u).toMatchObject({
      id: 'call_1',
      ended_at: '2026-08-11T20:00:00.000Z',
      duration_ms: 42_000,
      close_reason: 'client_closed',
      status: 'closed',
    });
  });

  it('a connection update omits everything but id when nothing else is set', () => {
    expect(toConnectionUpdate({ id: 'call_1' })).toEqual({ id: 'call_1' });
  });

  it('voice turns use snake_case latency fields', () => {
    expect(
      toVoiceTurn({
        connectionId: 'call_1',
        role: 'agent',
        llmLatencyMs: 3862,
        ttsLatencyMs: 163,
        audioLatencyMs: 4440,
        costUsd: 0.004,
      }),
    ).toMatchObject({
      connection_id: 'call_1',
      llm_latency_ms: 3862,
      tts_latency_ms: 163,
      audio_latency_ms: 4440,
      cost_usd: 0.004,
    });
  });

  it('a TTS-degraded turn folds ttsDegradedReason into metadata, not a new column', () => {
    const vt = toVoiceTurn({
      role: 'agent',
      state: 'tts_failure',
      ttsDegradedReason: 'rate_limited',
      metadata: { deploymentId: 'dep_1' },
    });
    expect('tts_degraded_reason' in vt).toBe(false);
    expect(vt.metadata).toMatchObject({ deploymentId: 'dep_1', tts_degraded_reason: 'rate_limited' });
  });

  it('tool calls send the name and never the payload', () => {
    const t = toToolCall({ toolName: 'submitRatings', status: 'ok', connectionId: 'c' });
    expect(t).toMatchObject({ tool_name: 'submitRatings', status: 'ok' });
    expect('input' in t).toBe(false);
    expect('output' in t).toBe(false);
  });

  it('logs keep level/service/message as columns', () => {
    expect(toLog({ level: 'warn', service: 'request', message: 'm', traceId: 'r1' })).toMatchObject({
      level: 'warn',
      service: 'request',
      message: 'm',
      trace_id: 'r1',
    });
  });
});

describe('scrubbing reaches every free-form bag', () => {
  const dirty = { transcript: 'private words', scanId: 'scan_1' } as never;

  it.each([
    ['span.attributes', () => toSpan({ traceId: 't', service: 's', operation: 'o', attributes: dirty })],
    ['event.data', () => toEvent({ eventType: 'e', attributes: dirty })],
    ['metric.tags', () => toMetric({ service: 's', metricName: 'm', metricType: 'gauge', value: 1, tags: dirty })],
    ['voiceTurn.metadata', () => toVoiceTurn({ role: 'user', metadata: dirty })],
    ['toolCall.metadata', () => toToolCall({ toolName: 't', metadata: dirty })],
    ['connection.metadata', () => toConnection({ service: 's', connectionType: 'ws', metadata: dirty })],
    ['connectionUpdate.metadata', () => toConnectionUpdate({ id: 'c', metadata: dirty })],
    ['log.attributes', () => toLog({ level: 'info', service: 's', message: 'm', attributes: dirty })],
  ])('%s drops content but keeps ids', (_label, build) => {
    const raw = JSON.stringify(build());
    expect(raw).not.toContain('private words');
    expect(raw).toContain('scan_1');
  });
});
