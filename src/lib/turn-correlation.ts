/**
 * Attach a session's tool calls and events to the turns they belong to.
 *
 * The subtlety both P1 review findings circled: `trace_id` is NOT a turn
 * identifier. Some producers mint one trace per turn (then it happens to be
 * unique), others give every turn of a session the same session-level trace —
 * both are valid ingest. Correlating naively by trace either duplicates every
 * record onto every turn (shared trace) or silently drops records (turn-id
 * producers). So:
 *
 *   1. `call.turn_id === turn.id`          — the canonical join, always wins.
 *   2. `call.turn_id === turn.trace_id`    — producers that use their own
 *      per-turn id for both fields.
 *   3. trace match, ONLY when that trace is unique among the session's turns —
 *      a shared trace is a session key, not a turn key, and matching on it
 *      would attach everything to everything.
 *   4. time window, for records carrying no join key at all.
 *
 * Pure module so the hierarchy is unit-testable — it decides whose payloads
 * and errors render under which turn, which is exactly the kind of quiet
 * misattribution a dashboard gets trusted about.
 */
import type { AgentToolCall, Event, VoiceTurn } from "@/db/schema";

/** Trace ids that appear on more than one turn — session keys, not turn keys. */
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
 * The next turn starting is the honest upper bound — under any turn-taking, a
 * turn is over once its successor begins. Only the LAST turn stays open.
 */
export interface TurnBound {
  readonly end: string;
  /** True when `end` came from the next turn's start rather than `ended_at`.
   *  Inferred bounds are EXCLUSIVE: a record stamped exactly at the next
   *  turn's start belongs to that turn, not to both. A real `ended_at` stays
   *  inclusive — a record at the closing instant is genuinely this turn's. */
  readonly inferred: boolean;
}

export function effectiveEnds(turns: readonly VoiceTurn[]): Map<string, TurnBound> {
  const ordered = [...turns].sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
  const ends = new Map<string, TurnBound>();
  for (let i = 0; i < ordered.length; i++) {
    const turn = ordered[i]!;
    if (turn.ended_at) ends.set(turn.id, { end: turn.ended_at, inferred: false });
    else ends.set(turn.id, { end: ordered[i + 1]?.started_at ?? "9999", inferred: true });
  }
  return ends;
}

function inWindow(at: string, turn: VoiceTurn, ends: Map<string, TurnBound>): boolean {
  if (!turn.started_at) return false;
  const bound = ends.get(turn.id) ?? { end: turn.ended_at ?? "9999", inferred: !turn.ended_at };
  if (at < turn.started_at) return false;
  return bound.inferred ? at < bound.end : at <= bound.end;
}

export interface TurnCorrelator {
  toolsForTurn(turn: VoiceTurn, toolCalls: readonly AgentToolCall[]): AgentToolCall[];
  eventsForTurn(turn: VoiceTurn, events: readonly Event[]): Event[];
}

/** Build once per session view — precomputes the shared-trace set and the
 *  effective end bounds the per-turn filters depend on. */
export function createTurnCorrelator(turns: readonly VoiceTurn[]): TurnCorrelator {
  const shared = sharedTraceIds(turns);
  const ends = effectiveEnds(turns);
  return {
    toolsForTurn(turn, toolCalls) {
      return toolCalls.filter((call) => {
        if (call.turn_id) return call.turn_id === turn.id || call.turn_id === turn.trace_id;
        // A trace that uniquely identifies this turn is a real join.
        if (call.trace_id && turn.trace_id && !shared.has(turn.trace_id)) {
          return call.trace_id === turn.trace_id;
        }
        // Otherwise the trace carries no turn information — a session-level
        // trace copied onto every call, or a trace we cannot resolve. Time is
        // the remaining signal; rejecting outright dropped these calls from
        // every card (they only survived under All activity).
        return inWindow(call.started_at, turn, ends);
      });
    },
    eventsForTurn(turn, events) {
      const traceIsTurnKey = !!turn.trace_id && !shared.has(turn.trace_id);
      return events.filter((event) => {
        if (traceIsTurnKey && event.trace_id) return event.trace_id === turn.trace_id;
        if (!event.trace_id || !traceIsTurnKey) {
          // Shared-trace (or unkeyed) events: the time window is the only
          // honest association left. Events outside every turn's window belong
          // to the session view, not to a turn card.
          return inWindow(event.timestamp, turn, ends);
        }
        return false;
      });
    },
  };
}
