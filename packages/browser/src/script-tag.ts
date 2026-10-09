import type { PulsemonBrowserOptions } from './browser';

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function optionsFromDataset(d: Record<string, string | undefined>): PulsemonBrowserOptions {
  const opts: PulsemonBrowserOptions = { endpoint: d.endpoint, key: d.key };
  const replay: NonNullable<PulsemonBrowserOptions['replay']> = {};
  if (d.replay !== undefined) replay.enabled = d.replay !== 'false';
  const replayRate = num(d.replaySampleRate);
  if (replayRate !== undefined) replay.sampleRate = replayRate;
  if (d.privacy === 'balanced' || d.privacy === 'strict') replay.privacy = d.privacy;
  opts.replay = replay;
  const sessionRate = num(d.sessionSampleRate);
  if (sessionRate !== undefined) opts.sessionSampleRate = sessionRate;
  if (d.captureQueryString !== undefined) opts.captureQueryString = d.captureQueryString === 'true';
  const interval = num(d.flushIntervalMs);
  if (interval !== undefined) opts.flushIntervalMs = interval;
  return opts;
}
