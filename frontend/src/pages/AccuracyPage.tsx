import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getWorkspaceSlug, wapi } from "../api/client";
import type { AccuracyReport } from "../api/types";
import { addDays, rangeLabel } from "../lib/dates";
import { fmtNum } from "../lib/format";

export function AccuracyPage() {
  const [weeks, setWeeks] = useState(8);
  const report = useQuery<AccuracyReport>({
    queryKey: ["accuracy", weeks, getWorkspaceSlug()],
    queryFn: () => wapi.get<AccuracyReport>(`/weeks/accuracy?weeks=${weeks}`),
  });

  const r = report.data;
  const maxErr = r ? Math.max(...r.weeks.map((w) => parseFloat(w.abs_error)), 1) : 1;

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="font-display text-lg font-bold">Planning accuracy</h1>
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="rounded border border-line bg-surface px-2 py-1 text-xs"
        >
          {[4, 8, 12, 26].map((n) => (
            <option key={n} value={n}>last {n} weeks</option>
          ))}
        </select>
      </div>
      <p className="mb-4 text-xs text-muted">
        Compares the plan captured a week in advance with the actual load at
        the moment the week was closed.
      </p>

      {report.isLoading && <p className="py-8 text-center text-muted">Loading…</p>}
      {r && r.weeks_analyzed === 0 && (
        <p className="rounded border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          No plan/actual pairs yet. Close your first week and statistics will
          appear here.
        </p>
      )}
      {r && r.weeks_analyzed > 0 && (
        <>
          <div className="mb-4 rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Error by week, days
            </div>
            <div className="space-y-1.5">
              {[...r.weeks].reverse().map((w) => (
                <div key={w.week_start} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 whitespace-nowrap text-muted font-nums">
                    {rangeLabel(w.week_start, addDays(w.week_start, 6))}
                  </span>
                  <div className="h-4 flex-1 rounded-sm bg-page">
                    <div
                      className="h-full rounded-sm bg-[var(--load-full-bg)]"
                      style={{
                        width: `${(parseFloat(w.abs_error) / maxErr) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-nums font-medium">
                    {fmtNum(w.abs_error)}
                  </span>
                  <span className="w-40 shrink-0 whitespace-nowrap text-right text-muted font-nums">
                    plan {fmtNum(w.plan_total)} · actual {fmtNum(w.fact_total)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                Mean absolute error per team member
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {r.members.map((m) => (
                    <tr key={m.member_id} className="border-b border-line/40">
                      <td className="py-1">{m.member_name}</td>
                      <td className="py-1 text-right font-nums">
                        {fmtNum(m.mean_abs_error)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                  Free capacity left unused
                </div>
                <div className="font-display text-2xl font-bold font-nums">
                  {Math.round(r.idle_weeks_share * 100)}%
                </div>
                <div className="text-xs text-muted">
                  of weeks where people marked free stayed free
                </div>
              </div>
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Plan overrun by project
                </div>
                {r.overrun_projects.length === 0 && (
                  <p className="text-xs text-muted">No overruns.</p>
                )}
                {r.overrun_projects.length > 0 && (
                  <table className="w-full text-sm">
                    <tbody>
                      {r.overrun_projects.map((p) => (
                        <tr key={p.project_id} className="border-b border-line/40 last:border-0">
                          <td className="w-16 py-1 pr-2 font-medium">{p.code}</td>
                          <td className="truncate py-1 pr-2 text-muted">{p.name}</td>
                          <td className="w-14 py-1 text-right font-nums text-accent">
                            +{fmtNum(p.total_overrun)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
