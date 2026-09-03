import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { TimelineResponse } from "../api/types";
import { LoadLegend } from "../components/timeline/LoadLegend";
import { TimelineGrid } from "../components/timeline/TimelineGrid";
import { summaryLoadClass } from "../lib/categories";
import { addDays, currentMonday, dayLabel, rangeLabel } from "../lib/dates";
import { fmtNum } from "../lib/format";
import { Wordmark } from "../components/Wordmark";
import { HealthDot } from "../components/HealthDot";


interface PublicProject {
  id: string;
  code: string;
  name: string;
  lifecycle: string;
  health: string;
}

async function publicGet<T>(path: string): Promise<T> {
  const resp = await fetch(`/api/v1${path}`);
  if (!resp.ok) throw new Error(String(resp.status));
  return resp.json();
}

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"timeline" | "projects">("timeline");
  const horizon = Number(params.get("weeks") ?? 2);
  const from = params.get("from") ?? currentMonday();
  const to = addDays(from, horizon * 7 - 1);

  const timeline = useQuery<TimelineResponse>({
    queryKey: ["public-timeline", token, from, to],
    queryFn: () =>
      publicGet<TimelineResponse>(`/s/${token}/timeline?date_from=${from}&date_to=${to}`),
    retry: false,
  });
  const projects = useQuery<PublicProject[]>({
    queryKey: ["public-projects", token],
    queryFn: () => publicGet<PublicProject[]>(`/s/${token}/projects`),
    enabled: tab === "projects",
    retry: false,
  });

  if (timeline.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="font-display text-lg font-bold">This link is no longer valid</div>
        <p className="max-w-sm text-sm text-muted">
          The link was revoked, has expired or was mistyped. Ask the workspace
          owner for a new one.
        </p>
      </div>
    );
  }

  const data = timeline.data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Wordmark size="sm" />
        <span className="rounded bg-page px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          Read only
        </span>
        <nav className="flex gap-1">
          {(["timeline", "projects"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-sm ${
                tab === t ? "bg-page font-medium" : "text-muted"
              }`}
            >
              {t === "timeline" ? "Timeline" : "Projects"}
            </button>
          ))}
        </nav>
        {tab === "timeline" && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                setParams((p) => {
                  p.set("from", addDays(from, -7));
                  return p;
                })
              }
              className="rounded border border-line px-2 py-1 text-sm"
            >
              ←
            </button>
            <span className="px-1 text-sm">{rangeLabel(from, to)}</span>
            <button
              onClick={() =>
                setParams((p) => {
                  p.set("from", addDays(from, 7));
                  return p;
                })
              }
              className="rounded border border-line px-2 py-1 text-sm"
            >
              →
            </button>
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "timeline" && (
          <>
            {timeline.isLoading && (
              <p className="py-10 text-center text-muted">Loading…</p>
            )}
            {data && (
              <>
                {/* desktop: full grid */}
                <div className="hidden md:block">
                  <div className="mb-2">
                    <LoadLegend />
                  </div>
                  <TimelineGrid
                    data={data}
                    setCells={() => {}}
                    undo={() => {}}
                    redo={() => {}}
                    extraRows={{}}
                    onAddRow={() => {}}
                    readOnly
                  />
                </div>
                {/* mobile: vertical list per team member */}
                <div className="space-y-3 md:hidden">
                  {data.members.map((tm) => (
                    <div key={tm.member.id} className="rounded-lg border border-line bg-surface p-3">
                      <div className="mb-1 flex justify-between">
                        <span className="text-sm font-medium">{tm.member.name}</span>
                        <span className="text-xs text-muted font-nums">
                          {fmtNum(tm.total_allocated)} / {fmtNum(tm.total_free)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {tm.days
                          .filter((d) => d.is_working)
                          .map((d) => {
                            const load = parseFloat(d.allocated);
                            const cap = parseFloat(d.capacity);
                            const cls =
                              d.is_absent || load === 0
                                ? "bg-[var(--cell-off)]"
                                : summaryLoadClass(load, cap).className;
                            return (
                              <span
                                key={d.day}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-nums ${cls}`}
                              >
                                {dayLabel(d.day)} {d.is_absent ? "abs." : fmtNum(load)}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "projects" && (
          <div className="mx-auto max-w-3xl">
            {projects.isLoading && (
              <p className="py-10 text-center text-muted">Loading…</p>
            )}
            <div className="space-y-2">
              {(projects.data ?? []).map((p) => (
                <div key={p.id} className="rounded-lg border border-line bg-surface px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <HealthDot health={p.health} />
                    <span className="font-medium">{p.code}</span>
                    <span className="text-sm text-muted">{p.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
