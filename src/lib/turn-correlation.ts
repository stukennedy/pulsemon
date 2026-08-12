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

function inWindow(at: string, turn: VoiceTurn): boolean {
  if (!turn.started_at) return false;
  return at >= turn.started_at && at <= (turn.ended_at ?? "9999");
}

export function toolsForTurn(
  turn: VoiceTurn,
  toolCalls: readonly AgentToolCall[],
  shared: Set<string>
): AgentToolCall[] {
  return toolCalls.filter((call) => {
    if (call.turn_id) return call.turn_id === turn.id || call.turn_id === turn.trace_id;
    if (call.trace_id) {
      return call.trace_id === turn.trace_id && !!turn.trace_id && !shared.has(turn.trace_id);
    }
    return inWindow(call.started_at, turn);
  });
}

export function eventsForTurn(turn: VoiceTurn, events: readonly Event[], shared: Set<string>): Event[] {
  const traceIsTurnKey = !!turn.trace_id && !shared.has(turn.trace_id);
  return events.filter((event) => {
    if (traceIsTurnKey && event.trace_id) return event.trace_id === turn.trace_id;
    if (!event.trace_id || !traceIsTurnKey) {
      // Shared-trace (or unkeyed) events: the time window is the only honest
      // association left. Events outside every turn's window belong to the
      // session view, not to a turn card.
      return inWindow(event.timestamp, turn);
    }
    return false;
  });
}
