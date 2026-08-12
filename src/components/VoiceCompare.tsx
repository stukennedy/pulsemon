import type { FC } from "hono/jsx";
import type { VoiceSessionSummary } from "@/lib/effect/sessions";
import type { VoiceSessionComparison } from "@/lib/effect/session-compare";
import { countRegressions, type CompareRow, type CompareVerdict } from "@/lib/session-compare";

const FIELD_STYLE = "width:100%;background:rgba(15,23,42,0.92);border:1px solid rgba(148,163,184,0.18);border-radius:6px;color:#e2e8f0;padding:9px 10px;font-size:12px";

function formatValue(value: number | null, unit: CompareRow["unit"]) {
  if (value === null) return "—";
  switch (unit) {
    case "ms":
      return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
    case "pct":
      return `${value.toFixed(1)}%`;
    case "usd":
      return value < 0.01 && value !== 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
    case "count":
      return value.toLocaleString();
  }
}

function formatDelta(row: CompareRow) {
  if (row.candidate === null || row.reference === null) return "—";
  const delta = row.candidate - row.reference;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const absolute = `${sign}${formatValue(Math.abs(delta), row.unit)}`;
  return row.deltaPct === null
    ? absolute
    : `${absolute} (${sign}${Math.abs(row.deltaPct).toFixed(1)}%)`;
}

const VERDICT_STYLES: Record<CompareVerdict, string> = {
  regressed: "color:#fb7185;background:rgba(251,113,133,0.09);border-color:rgba(251,113,133,0.2)",
  improved: "color:#34d399;background:rgba(52,211,153,0.08);border-color:rgba(52,211,153,0.18)",
  flat: "color:#94a3b8;background:rgba(148,163,184,0.08);border-color:rgba(148,163,184,0.18)",
  no_data: "color:#475569;background:rgba(71,85,105,0.08);border-color:rgba(71,85,105,0.18)",
};

const VerdictBadge: FC<{ verdict: CompareVerdict }> = ({ verdict }) => (
  <span
    class="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase"
    style={VERDICT_STYLES[verdict]}
  >
    {verdict === "no_data" ? "no data" : verdict}
  </span>
);

function sessionOptionLabel(session: VoiceSessionSummary) {
  const day = session.last_seen_at ? session.last_seen_at.slice(0, 10) : "";
  return `${session.session_id} · ${session.turn_count} turns · ${day}`;
}

export const VoiceCompareView: FC<{
  sessions: VoiceSessionSummary[];
  candidateId: string;
  referenceId: string;
  baselineDays: number;
  comparison: VoiceSessionComparison | null;
}> = ({ sessions, candidateId, referenceId, baselineDays, comparison }) => {
  const regressions = comparison ? countRegressions(comparison.rows) : 0;

  return (
    <div class="space-y-4 fade-in">
      <section
        class="p-4"
        style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px"
      >
        <div class="flex items-center justify-between gap-4 mb-3">
          <h2 class="text-sm font-mono" style="color:#cbd5e1">Compare Sessions</h2>
          <span class="text-[11px] font-mono" style="color:#64748b">
            candidate vs reference session or rolling baseline
          </span>
        </div>

        <form method="get" action="/voice/compare" class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <label class="block">
            <span class="text-[10px] font-mono uppercase" style="color:#64748b">Candidate session</span>
            <select name="a" required style={FIELD_STYLE} class="mt-1">
              <option value="" selected={candidateId === ""}>Select a session…</option>
              {sessions.map((session) => (
                <option value={session.session_id} selected={session.session_id === candidateId}>
                  {sessionOptionLabel(session)}
                </option>
              ))}
            </select>
          </label>
          <label class="block">
            <span class="text-[10px] font-mono uppercase" style="color:#64748b">Reference</span>
            <select name="b" style={FIELD_STYLE} class="mt-1">
              <option value="baseline" selected={referenceId === "baseline"}>Rolling baseline</option>
              {sessions.map((session) => (
                <option value={session.session_id} selected={session.session_id === referenceId}>
                  {sessionOptionLabel(session)}
                </option>
              ))}
            </select>
          </label>
          <label class="block">
            <span class="text-[10px] font-mono uppercase" style="color:#64748b">Baseline window (days)</span>
            <input name="days" type="number" min="1" max="30" value={String(baselineDays)} style={FIELD_STYLE} class="mt-1" />
          </label>
          <div class="flex items-end">
            <button
              type="submit"
              class="text-xs font-mono w-full"
              style="background:#e2e8f0;color:#020617;border-radius:6px;padding:9px 12px"
            >
              Compare
            </button>
          </div>
        </form>
      </section>

      {comparison && (
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="stat-card">
            <div class="stat-label">Candidate turns</div>
            <div class="stat-value">{comparison.candidate.turnCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Reference turns</div>
            <div class="stat-value">{comparison.reference?.turnCount ?? 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Regressions</div>
            <div class="stat-value" style={regressions > 0 ? "color:#fb7185" : "color:#34d399"}>{regressions}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Reference</div>
            <div class="stat-value text-xs" style="font-size:12px">{comparison.reference?.label ?? "no data"}</div>
          </div>
        </div>
      )}

      {comparison ? (
        <div
          class="rounded-lg overflow-hidden"
          style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)"
        >
          <div class="px-4 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace">
              {comparison.candidate.label} vs {comparison.reference?.label ?? "no reference data"}
            </span>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
                {["Metric", "Candidate", "Reference", "Δ", "Verdict"].map((h) => (
                  <th
                    class={`px-4 py-2 ${h === "Metric" ? "text-left" : "text-right"}`}
                    style="font-size:10px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#374151;font-family:'IBM Plex Mono',monospace"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr style="border-top:1px solid rgba(255,255,255,0.04)">
                  <td class="px-4 py-2 text-xs font-mono" style="color:#cbd5e1">{row.metric}</td>
                  <td class="px-4 py-2 text-xs font-mono text-right" style="color:#e2e8f0">{formatValue(row.candidate, row.unit)}</td>
                  <td class="px-4 py-2 text-xs font-mono text-right" style="color:#94a3b8">{formatValue(row.reference, row.unit)}</td>
                  <td
                    class="px-4 py-2 text-xs font-mono text-right"
                    style={row.verdict === "regressed" ? "color:#fb7185" : row.verdict === "improved" ? "color:#34d399" : "color:#64748b"}
                  >
                    {formatDelta(row)}
                  </td>
                  <td class="px-4 py-2 text-right">
                    <VerdictBadge verdict={row.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          class="rounded-lg px-4 py-8 text-center text-xs font-mono"
          style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);color:#334155"
        >
          Pick a candidate session to compare its stage latencies against another session or the rolling baseline.
        </div>
      )}
    </div>
  );
};
