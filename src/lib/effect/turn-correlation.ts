/**
 * Attach a session's tool calls and events to the turns they belong to.
 *
 * The subtlety both P1 review findings circled: `trace_id` is NOT a turn
 * identifier. Some producers mint one trace per turn (then it happens to be
 * unique), others give every turn of a session the same session-level trace -
 * both are valid ingest. Correlating naively by trace either duplicates every
 * record onto every turn (shared trace) or silently drops records (turn-id
 * producers). So:
 *
 *   1. `call.turn_id === turn.id`          - the canonical join, always wins.
 *   2. `call.turn_id === turn.trace_id`    - producers that use their own
 *      per-turn id for both fields.
 *   3. trace match, ONLY when that trace is unique among the session's turns -
 *      a shared trace is a session key, not a turn key, and matching on it
 *      would attach everything to everything.
 *   4. time window, for records carrying no join key at all.
 *
 * Pure module so the hierarchy is unit-testable - it decides whose payloads
 * and errors render under which turn, which is exactly the kind of quiet
 * misattribution a dashboard gets trusted about.
 */
import type { AgentToolCall, Event, VoiceTurn } from "@/db/schema";

/** Trace ids that appear on more than one turn - session keys, not turn keys. */
export function sharedTraceIds(turns: readonly VoiceTurn[]): Set<string> {
  const seen = new Map<string, number>();
  for (const turn of turns) {
    if (turn.trace_id) seen.set(turn.trace_id, (seen.get(turn.trace_id) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

/**
 * Effective end bound per turn. Ingest allows turns without `ended_at`; left
 * unbounded, every later record time-matches every preceding unfinished turn.
 * The next turn starting is the honest upper bound - under any turn-taking, a
 * turn is over once its successor begins. Only the LAST turn stays open.
 */
/** Epoch ms, or null when unparseable. RFC 3339 permits offsets ("+01:00")
 *  and varying fractional precision, so lexical comparison of two valid
 *  timestamps does NOT preserve chronological order - every window check
 *  below compares instants. */
function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export interface TurnBound {
  readonly end: number;
  /** True when `end` came from the next turn's start rather than `ended_at`.
   *  Inferred bounds are EXCLUSIVE: a record stamped exactly at the next
   *  turn's start belongs to that turn, not to both. A real `ended_at` stays
   *  inclusive - a record at the closing instant is genuinely this turn's. */
  readonly inferred: boolean;
}

export function effectiveEnds(turns: readonly VoiceTurn[]): Map<string, TurnBound> {
  const ordered = [...turns].sort(
    (a, b) => (instant(a.started_at) ?? 0) - (instant(b.started_at) ?? 0)
  );
  const ends = new Map<string, TurnBound>();
  for (let i = 0; i < ordered.length; i++) {
    const turn = ordered[i]!;
    const explicit = instant(turn.ended_at);
    if (explicit !== null) {
      ends.set(turn.id, { end: explicit, inferred: false });
    } else {
      ends.set(turn.id, {
        end: instant(ordered[i + 1]?.started_at) ?? Number.POSITIVE_INFINITY,
        inferred: true,
      });
    }
  }
  return ends;
}

function inWindow(at: string, turn: VoiceTurn, ends: Map<string, TurnBound>): boolean {
  const t = instant(at);
  const start = instant(turn.started_at);
  if (t === null || start === null) return false;
  const bound = ends.get(turn.id) ?? {
    end: instant(turn.ended_at) ?? Number.POSITIVE_INFINITY,
    inferred: !turn.ended_at,
  };
  if (t < start) return false;
  return bound.inferred ? t < bound.end : t <= bound.end;
}

export interface TurnAssignments {
  toolsFor(turnId: string): AgentToolCall[];
  eventsFor(turnId: string): Event[];
}

export interface TurnCorrelator {
  /**
   * Assign every record to AT MOST ONE turn, computed once over the whole
   * session. Two passes, and the order is the point:
   *
   *   1. KEYED - `turn_id`, or a trace that uniquely identifies a turn.
   *   2. WINDOW - only records the keyed pass left unassigned, matched
   *      against the FIRST turn (chronologically) whose window contains them.
   *
   * Filtering per turn instead - each turn independently asking "is this
   * mine?" - double-assigned records in sessions that MIX keying styles: an
   * event carrying turn A's unique trace, timestamped inside unkeyed turn B's
   * window, matched A by trace and B by time and rendered on both cards.
   */
  assign(toolCalls: readonly AgentToolCall[], events: readonly Event[]): TurnAssignments;
}

export function createTurnCorrelator(turns: readonly VoiceTurn[]): TurnCorrelator {
  const shared = sharedTraceIds(turns);
  const ends = effectiveEnds(turns);
  const ordered = [...turns].sort(
    (a, b) => (Date.parse(a.started_at ?? "") || 0) - (Date.parse(b.started_at ?? "") || 0)
  );
  const byUniqueTrace = new Map<string, VoiceTurn>();
  for (const turn of turns) {
    if (turn.trace_id && !shared.has(turn.trace_id)) byUniqueTrace.set(turn.trace_id, turn);
  }
  const byId = new Map(turns.map((turn) => [turn.id, turn]));

  function keyedTurn(turnId: string | null, traceId: string | null): VoiceTurn | undefined {
    if (turnId) {
      // Canonical join first, then producers using their own per-turn id for
      // both fields.
      return byId.get(turnId) ?? byUniqueTrace.get(turnId);
    }
    if (traceId) return byUniqueTrace.get(traceId);
    return undefined;
  }

  function windowTurn(at: string): VoiceTurn | undefined {
    return ordered.find((turn) => inWindow(at, turn, ends));
  }

  return {
    assign(toolCalls, events) {
      const tools = new Map<string, AgentToolCall[]>();
      const eventMap = new Map<string, Event[]>();
      const put = <T>(map: Map<string, T[]>, turn: VoiceTurn | undefined, record: T) => {
        if (!turn) return;
        const list = map.get(turn.id) ?? [];
        list.push(record);
        map.set(turn.id, list);
      };

      for (const call of toolCalls) {
        const turnId = call.turn_id?.trim() || null;
        const keyed = keyedTurn(turnId, call.trace_id ?? null);
        // Keyed wins outright; only a record NO key claims may fall back to
        // time. A shared/unresolvable trace carries no turn information, so it
        // is treated as unkeyed rather than rejected (rejecting dropped those
        // calls from every card).
        put(tools, keyed ?? (turnId ? undefined : windowTurn(call.started_at)), call);
      }
      for (const event of events) {
        const keyed = keyedTurn(null, event.trace_id ?? null);
        put(eventMap, keyed ?? windowTurn(event.timestamp), event);
      }

      return {
        toolsFor: (turnId) => tools.get(turnId) ?? [],
        eventsFor: (turnId) => eventMap.get(turnId) ?? [],
      };
    },
  };
}
