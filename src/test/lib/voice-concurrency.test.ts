import { describe, expect, it } from "bun:test";
import {
  computeConcurrencySeries,
  openIntervalCount,
  type ConcurrencyInterval,
  type ConcurrencyWindow,
} from "@/lib/effect/voice-concurrency";

const T0 = Date.parse("2026-08-18T10:00:00.000Z");
const MIN = 60_000;

function interval(startMinute: number, endMinute: number | null): ConcurrencyInterval {
  return {
    startMs: T0 + startMinute * MIN,
    endMs: endMinute === null ? null : T0 + endMinute * MIN,
  };
}

function windowOf(startMinute: number, endMinute: number, bucketMinutes: number): ConcurrencyWindow {
  return {
    windowStartMs: T0 + startMinute * MIN,
    windowEndMs: T0 + endMinute * MIN,
    bucketMs: bucketMinutes * MIN,
  };
}

describe("openIntervalCount", () => {
  it("counts intervals covering the instant, including still-open ones", () => {
    const intervals = [interval(0, 5), interval(2, null), interval(6, 8)];
    expect(openIntervalCount(intervals, T0 + 3 * MIN)).toBe(2);
  });

  it("excludes an interval that ends exactly at the instant (half-open)", () => {
    const intervals = [interval(0, 5)];
    expect(openIntervalCount(intervals, T0 + 5 * MIN)).toBe(0);
  });

  it("includes an interval that starts exactly at the instant", () => {
    const intervals = [interval(5, 10)];
    expect(openIntervalCount(intervals, T0 + 5 * MIN)).toBe(1);
  });

  it("returns zero for empty input", () => {
    expect(openIntervalCount([], T0)).toBe(0);
  });
});

describe("computeConcurrencySeries", () => {
  it("returns an empty-but-total series for empty input", () => {
    const result = computeConcurrencySeries([], windowOf(0, 10, 5));
    expect(result.peak).toBe(0);
    expect(result.current).toBe(0);
    expect(result.series.points).toHaveLength(2);
    for (const point of result.series.points) {
      expect(point).toMatchObject({ count: 0, avg: 0, min: 0, max: 0, sum: 0 });
    }
  });

  it("buckets a single interval fully inside one bucket", () => {
    const result = computeConcurrencySeries([interval(1, 4)], windowOf(0, 10, 5));
    // Bucket 0: [0,5) — covered [1,4) => 3 of 5 minutes at concurrency 1.
    expect(result.series.points[0]).toMatchObject({ count: 1, max: 1, min: 0 });
    expect(result.series.points[0]?.avg).toBeCloseTo(3 / 5, 6);
    expect(result.series.points[1]).toMatchObject({ count: 0, max: 0, min: 0, avg: 0 });
    expect(result.peak).toBe(1);
  });

  it("computes peak concurrency from overlapping intervals", () => {
    const intervals = [interval(0, 10), interval(2, 6), interval(3, 4)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    expect(result.series.points[0]).toMatchObject({ count: 3, max: 3 });
    expect(result.peak).toBe(3);
  });

  it("computes a time-weighted average, not a naive count average", () => {
    // Bucket [0,10): concurrency 1 for [0,8), concurrency 2 for [8,10).
    const intervals = [interval(0, 10), interval(8, 10)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    // (1*8 + 2*2) / 10 = 1.2
    expect(result.series.points[0]?.avg).toBeCloseTo(1.2, 6);
    expect(result.series.points[0]?.min).toBe(1);
    expect(result.series.points[0]?.max).toBe(2);
  });

  it("does not treat touching (non-overlapping) intervals as concurrent", () => {
    // [0,5) ends exactly when [5,10) starts — never actually overlapping.
    const intervals = [interval(0, 5), interval(5, 10)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    expect(result.series.points[0]?.min).toBe(1);
    expect(result.series.points[0]?.avg).toBeCloseTo(1, 6);
  });

  it("registers a zero-length interval as a momentary peak", () => {
    const intervals: ConcurrencyInterval[] = [{ startMs: T0 + 3 * MIN, endMs: T0 + 3 * MIN }];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    expect(result.series.points[0]).toMatchObject({ count: 1, max: 1 });
    // Zero duration contributes no area.
    expect(result.series.points[0]?.avg).toBe(0);
    expect(result.series.points[0]?.sum).toBe(0);
    expect(result.peak).toBe(1);
  });

  it("stacks multiple zero-length intervals at the same instant", () => {
    const t = T0 + 3 * MIN;
    const intervals: ConcurrencyInterval[] = [
      { startMs: t, endMs: t },
      { startMs: t, endMs: t },
      { startMs: t, endMs: t },
    ];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    expect(result.series.points[0]?.count).toBe(3);
  });

  it("clamps an open (still-running) interval to windowEnd for geometry", () => {
    const intervals = [interval(5, null)];
    const window = windowOf(0, 10, 5);
    const result = computeConcurrencySeries(intervals, window);
    // Bucket 1: [5,10) fully covered by the open interval.
    expect(result.series.points[1]).toMatchObject({ count: 1, max: 1, min: 1 });
    expect(result.series.points[1]?.avg).toBeCloseTo(1, 6);
    expect(result.current).toBe(1); // still open at windowEnd
  });

  it("carries a long-running interval across multiple bucket boundaries", () => {
    const intervals = [interval(0, 30)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 30, 10));
    expect(result.series.points).toHaveLength(3);
    for (const point of result.series.points) {
      expect(point).toMatchObject({ count: 1, max: 1, min: 1 });
      expect(point.avg).toBeCloseTo(1, 6);
    }
  });

  it("splits an interval straddling a bucket edge proportionally", () => {
    // Interval [3,7) straddles the 5-minute bucket boundary.
    const intervals = [interval(3, 7)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 5));
    expect(result.series.points[0]?.avg).toBeCloseTo(2 / 5, 6); // [3,5) of [0,5)
    expect(result.series.points[1]?.avg).toBeCloseTo(2 / 5, 6); // [5,7) of [5,10)
  });

  it("reports current as intervals open at windowEnd, independent of history", () => {
    const intervals = [interval(0, 3), interval(1, null), interval(9, null)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 10));
    expect(result.current).toBe(2); // the closed-at-3 interval no longer counts
  });

  it("handles an interval entirely outside the window", () => {
    const intervals = [interval(-100, -50)];
    const result = computeConcurrencySeries(intervals, windowOf(0, 10, 5));
    expect(result.peak).toBe(0);
    expect(result.current).toBe(0);
    expect(result.series.points.every((p) => p.count === 0)).toBe(true);
  });

  it("is total for an invalid window (end before start) rather than throwing", () => {
    const result = computeConcurrencySeries([interval(0, 5)], windowOf(10, 0, 5));
    expect(result.series.points).toEqual([]);
    expect(result.peak).toBe(0);
    expect(result.current).toBe(0);
  });

  it("is total for a non-positive bucket size rather than throwing", () => {
    const result = computeConcurrencySeries([interval(0, 5)], {
      windowStartMs: T0,
      windowEndMs: T0 + 10 * MIN,
      bucketMs: 0,
    });
    expect(result.series.points).toEqual([]);
  });

  it("produces a shorter final bucket when the window doesn't divide evenly", () => {
    const result = computeConcurrencySeries([interval(0, 12)], windowOf(0, 12, 5));
    expect(result.series.points).toHaveLength(3);
    const last = result.series.points[2]!;
    expect(last.avg).toBeCloseTo(1, 6); // fully covered [10,12)
  });

  it("produces ISO bucket_start timestamps aligned to the window", () => {
    const result = computeConcurrencySeries([], windowOf(0, 10, 5));
    expect(result.series.points.map((p) => p.bucket_start)).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + 5 * MIN).toISOString(),
    ]);
    expect(result.series.from).toBe(new Date(T0).toISOString());
    expect(result.series.to).toBe(new Date(T0 + 10 * MIN).toISOString());
    expect(result.series.source).toBe("raw");
  });
});
