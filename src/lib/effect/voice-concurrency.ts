/**
 * Interval-sweep concurrency — pure, so the geometry behind "how many voice
 * sessions/generations were running at once" is unit-testable without a
 * database. Consumed by `voice-concurrency-io.ts` (D1 queries that produce
 * the interval lists) and rendered by `MetricTimeseriesChart`, which is why
 * the bucketed output matches `MetricSeriesResult` exactly — no chart changes
 * needed.
 *
 * A "concurrency interval" is simply when something started and when it
 * ended (`endMs: null` means still running — the producer hasn't reported a
 * close yet, e.g. a connection with no `connection_update`, or a generation
 * span not yet terminal). Per bucket we compute:
 *
 *   - `count` / `max` — PEAK concurrency at any instant inside the bucket.
 *     Both fields carry the same number: `MetricSeriesPoint` already has a
 *     `count` and a `max`, and for a concurrency series they're the same
 *     fact (there's only one "how many at once" per bucket), so re-deriving
 *     a distinct `max` would be inventing a second meaning that doesn't
 *     exist for this signal.
 *   - `avg` — the TIME-WEIGHTED average concurrency across the bucket (an
 *     instant with 3 concurrent calls counts 3x as much toward the average
 *     as an instant with 1, in proportion to how long each lasted) — not a
 *     simple mean of samples, which would misrepresent bursty traffic.
 *   - `min` — the lowest concurrency reached inside the bucket, including
 *     real gaps (no interval covering that instant) as zero.
 *   - `sum` — the time-integral of concurrency (concurrency-milliseconds);
 *     `avg` is `sum / bucket duration`. Not a headline number by itself, but
 *     it's what makes `avg` derivable and honest rather than guessed.
 */

import type { MetricSeriesPoint, MetricSeriesResult } from "./metric-series";

export interface ConcurrencyInterval {
  /** Epoch ms the thing started. */
  readonly startMs: number;
  /** Epoch ms it ended, or `null` if it is still open (no close reported). */
  readonly endMs: number | null;
}

export interface ConcurrencyWindow {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  /** Bucket width in ms. Buckets tile `[windowStartMs, windowEndMs)`; the
   *  final bucket is shorter than `bucketMs` when the window doesn't divide
   *  evenly. */
  readonly bucketMs: number;
}

export interface ConcurrencySeriesResult {
  /** Same shape `queryMetricSeries` returns (`source` always `"raw"` here —
   *  concurrency has no rollup story yet), so `MetricTimeseriesChart` and
   *  every other `MetricSeriesResult` consumer render it unchanged. */
  readonly series: MetricSeriesResult;
  /** Peak concurrency anywhere in the whole window — the max of every
   *  bucket's own peak, since the true window-wide peak necessarily falls
   *  inside exactly one bucket and that bucket's local sweep captures it. */
  readonly peak: number;
  /** How many intervals are open exactly at `windowEndMs` — see
   *  `openIntervalCount`. */
  readonly current: number;
}

/** How many intervals cover the instant `atMs` — start at-or-before, and
 *  either still open or ending strictly after. Half-open convention: an
 *  interval that ends exactly at `atMs` is NOT counted as covering it. */
export function openIntervalCount(intervals: readonly ConcurrencyInterval[], atMs: number): number {
  let count = 0;
  for (const interval of intervals) {
    if (interval.startMs <= atMs && (interval.endMs === null || interval.endMs > atMs)) count++;
  }
  return count;
}

interface SweepEvent {
  readonly t: number;
  readonly delta: 1 | -1;
}

/** Sort order for tied timestamps. `endsFirst` gives the conventional
 *  half-open semantics used for area/min (two intervals that touch at a
 *  boundary — [0,10) then [10,20) — do not count as overlapping).
 *  `startsFirst` is used only for peak detection: it lets a zero-length
 *  interval (start === end) register a momentary +1 before its own removal
 *  cancels it, and treats boundary-touching intervals as momentarily
 *  concurrent — the conservative choice for "how many at once, ever". */
function compareEvents(order: "startsFirst" | "endsFirst") {
  return (a: SweepEvent, b: SweepEvent): number => {
    if (a.t !== b.t) return a.t - b.t;
    if (a.delta === b.delta) return 0;
    const startFirst = a.delta === 1 ? -1 : 1;
    return order === "startsFirst" ? startFirst : -startFirst;
  };
}

interface BucketStats {
  readonly peak: number;
  readonly min: number;
  readonly avg: number;
  readonly sum: number;
}

const EMPTY_BUCKET: BucketStats = { peak: 0, min: 0, avg: 0, sum: 0 };

/**
 * Sweep every interval overlapping `[bucketStart, bucketEnd)`, clamped to the
 * bucket. Clamping an interval that spans the whole bucket (or is still
 * open) into a sub-interval covering the entire bucket is what makes a
 * long-running call "carry" correctly into every bucket it touches, with no
 * separate cross-bucket bookkeeping needed.
 */
function bucketStats(
  intervals: readonly ConcurrencyInterval[],
  bucketStart: number,
  bucketEnd: number
): BucketStats {
  const duration = bucketEnd - bucketStart;
  if (duration <= 0) return EMPTY_BUCKET;

  // `persistentEvents` feeds avg/min: real (non-zero-width) coverage only.
  // `peakEvents` additionally includes zero-length instants, which have no
  // area but must still register as a momentary peak.
  const persistentEvents: SweepEvent[] = [];
  const peakEvents: SweepEvent[] = [];

  for (const interval of intervals) {
    const end = interval.endMs === null ? bucketEnd : interval.endMs;

    if (interval.startMs === end) {
      if (interval.startMs >= bucketStart && interval.startMs < bucketEnd) {
        peakEvents.push({ t: interval.startMs, delta: 1 });
        peakEvents.push({ t: interval.startMs, delta: -1 });
      }
      continue;
    }

    const s = Math.max(interval.startMs, bucketStart);
    const e = Math.min(end, bucketEnd);
    if (s >= e) continue; // no overlap with this bucket

    persistentEvents.push({ t: s, delta: 1 });
    persistentEvents.push({ t: e, delta: -1 });
    peakEvents.push({ t: s, delta: 1 });
    peakEvents.push({ t: e, delta: -1 });
  }

  // Persistent pass: area under the concurrency curve, and its minimum.
  let active = 0;
  let cursor = bucketStart;
  let weightedSum = 0;
  let min = duration > 0 ? Infinity : 0;
  for (const ev of [...persistentEvents].sort(compareEvents("endsFirst"))) {
    if (ev.t > cursor) {
      const segment = ev.t - cursor;
      weightedSum += active * segment;
      if (active < min) min = active;
      cursor = ev.t;
    }
    active += ev.delta;
  }
  if (cursor < bucketEnd) {
    weightedSum += active * (bucketEnd - cursor);
    if (active < min) min = active;
  }
  if (min === Infinity) min = 0; // nothing covered the bucket at all

  // Peak pass: the highest instantaneous concurrency, including zero-length spikes.
  let peakActive = 0;
  let peak = 0;
  for (const ev of [...peakEvents].sort(compareEvents("startsFirst"))) {
    peakActive += ev.delta;
    if (peakActive > peak) peak = peakActive;
  }

  return { peak, min, avg: weightedSum / duration, sum: weightedSum };
}

/** Bucket boundaries tiling `[windowStartMs, windowEndMs)`. The final bucket
 *  is shorter than `bucketMs` when the window doesn't divide evenly. */
function bucketBounds(window: ConcurrencyWindow): Array<[number, number]> {
  const bounds: Array<[number, number]> = [];
  for (let start = window.windowStartMs; start < window.windowEndMs; start += window.bucketMs) {
    bounds.push([start, Math.min(start + window.bucketMs, window.windowEndMs)]);
  }
  return bounds;
}

/**
 * Bucket one series of intervals into `MetricSeriesResult`-shaped points
 * across `window`. Total — never throws. An invalid window (`windowEndMs <=
 * windowStartMs`, or a non-positive `bucketMs`) yields an empty series
 * rather than an error, since geometry has no useful "expected failure" to
 * report; callers validate window parameters before reaching here.
 */
export function computeConcurrencySeries(
  intervals: readonly ConcurrencyInterval[],
  window: ConcurrencyWindow
): ConcurrencySeriesResult {
  const valid = window.windowEndMs > window.windowStartMs && window.bucketMs > 0;
  const bounds = valid ? bucketBounds(window) : [];

  const points: MetricSeriesPoint[] = bounds.map(([start, end]) => {
    const stats = bucketStats(intervals, start, end);
    return {
      bucket_start: new Date(start).toISOString(),
      count: stats.peak,
      avg: stats.avg,
      min: stats.min,
      max: stats.peak,
      sum: stats.sum,
    };
  });

  const peak = points.reduce((max, point) => Math.max(max, point.count), 0);
  const current = valid ? openIntervalCount(intervals, window.windowEndMs) : 0;

  return {
    series: {
      source: "raw",
      from: new Date(window.windowStartMs).toISOString(),
      to: new Date(window.windowEndMs).toISOString(),
      points,
    },
    peak,
    current,
  };
}
