import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { wapi, workspaceUrl } from "../api/client";
import { LoadLegend } from "../components/timeline/LoadLegend";
import { TimelineGrid } from "../components/timeline/TimelineGrid";
import { useTimelineController } from "../components/timeline/useTimelineController";
import { AbsencePanel } from "../features/AbsencePanel";
import { CapacityPanel } from "../features/capacity-search/CapacityPanel";
import { SharePanel } from "../features/SharePanel";
import { addDays, currentMonday, rangeLabel } from "../lib/dates";
import { useWorkspace } from "../workspace";
import { fmtNum } from "../lib/format";

const HORIZONS = [2, 4, 6];

export function TimelinePage() {
  const [params, setParams] = useSearchParams();
  const horizon = Number(params.get("weeks") ?? 2);
  const from = params.get("from") ?? currentMonday();
  const to = addDays(from, horizon * 7 - 1);
  const { canEdit, isOwner, wsPath } = useWorkspace();
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [absencesOpen, setAbsencesOpen] = useState(false);
  const [extraRows, setExtraRows] = useState<Record<string, string[]>>({});
  const queryClient = useQueryClient();

  const { query, setCells, undo, redo, saveState, lastError, refresh } =
    useTimelineController(from, to);

  const setWindow = (newFrom: string, weeks = horizon) => {
    setParams(
      (p) => {
        p.set("from", newFrom);
        p.set("weeks", String(weeks));
        return p;
      },
      { replace: true },
    );
  };

  const closeWeek = useMutation({
    mutationFn: (week_start: string) => wapi.post("/weeks/close", { week_start }),
    onSuccess: () => refresh(),
  });
  const undoClose = useMutation({
    mutationFn: (week_start: string) =>
      wapi.post("/weeks/close/undo", { week_start }),
    onSuccess: () => refresh(),
  });
  const copyWeek = useMutation({
    mutationFn: (payload: { from_week_start: string; to_week_start: string }) =>
      wapi.post("/allocations/copy-week", { ...payload, mode: "merge" }),
    onSuccess: () => refresh(),
  });

  const data = query.data;
  const reminder = data?.week_close_reminder;
  const closableWeek = useMemo(() => {
    if (!data) return null;
    return (
      data.weeks.find((w) => (w.is_past || w.is_current) && !w.is_closed) ?? null
    );
  }, [data]);
  const undoableWeek = useMemo(
    () => data?.weeks.find((w) => w.is_closed && w.is_current) ?? null,
    [data],
  );

  return (
    <div className="flex h-full flex-col">
      {reminder && (
        <div className="flex items-center gap-3 border-b border-line bg-[var(--load-partial-bg)] px-4 py-1.5 text-xs text-[var(--load-partial-ink)]">
          <span>
            Week {rangeLabel(reminder, addDays(reminder, 6))} is not closed yet.
          </span>
          {canEdit && (
            <button
              onClick={() => closeWeek.mutate(reminder)}
              className="font-medium underline"
            >
              Close now
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWindow(addDays(from, -7))}
            className="rounded border border-line px-2 py-1 text-sm hover:bg-page"
            title="Previous week"
          >
            ←
          </button>
          <button
            onClick={() => setWindow(currentMonday())}
            className="rounded border border-line px-2 py-1 text-sm hover:bg-page"
          >
            Today
          </button>
          <button
            onClick={() => setWindow(addDays(from, 7))}
            className="rounded border border-line px-2 py-1 text-sm hover:bg-page"
            title="Next week"
          >
            →
          </button>
        </div>
        <span className="font-display text-sm font-medium">{rangeLabel(from, to)}</span>
        <div className="flex overflow-hidden rounded border border-line">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setWindow(from, h)}
              className={`px-2.5 py-1 text-xs ${
                h === horizon ? "bg-ink text-surface" : "hover:bg-page"
              }`}
            >
              {h} wk
            </button>
          ))}
        </div>

        <button
          onClick={() => setCapacityOpen((v) => !v)}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Enough people?
        </button>

        {canEdit && closableWeek && (
          <button
            onClick={() => closeWeek.mutate(closableWeek.week_start)}
            disabled={closeWeek.isPending}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-page disabled:opacity-50"
            title="Save the week snapshot to history and shift the window"
          >
            Close week {rangeLabel(closableWeek.week_start, addDays(closableWeek.week_start, 6))}
          </button>
        )}
        {canEdit && undoableWeek && (
          <button
            onClick={() => undoClose.mutate(undoableWeek.week_start)}
            className="rounded border border-line px-3 py-1.5 text-sm text-muted hover:bg-page"
            title="Available for 24 hours after closing"
          >
            Reopen week
          </button>
        )}
        {canEdit && (
        <button
          onClick={() =>
            copyWeek.mutate({ from_week_start: from, to_week_start: addDays(from, 7) })
          }
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-page"
          title="Duplicate the first week of the window into the second"
        >
          Copy week 1 → 2
        </button>
        )}
        {canEdit && (
        <button
          onClick={() => setAbsencesOpen((v) => !v)}
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-page"
          title="Vacations, sick days, days off — removed from capacity"
        >
          Absences
        </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
          <span
            className={`text-xs ${
              saveState === "error"
                ? "font-medium text-accent"
                : saveState === "saving"
                  ? "text-muted"
                  : "text-muted/70"
            }`}
            title={lastError ?? undefined}
          >
            {saveState === "saved" && "Saved"}
            {saveState === "saving" && "Saving…"}
            {saveState === "error" && (lastError ?? "Network error")}
          </span>
          )}
          <a
            href={workspaceUrl(`/export/timeline.xlsx?from=${from}&to=${to}`)}
            className="rounded border border-line px-2 py-1 text-xs hover:bg-page"
          >
            XLSX
          </a>
          <a
            href={workspaceUrl(`/export/timeline.csv?from=${from}&to=${to}`)}
            className="rounded border border-line px-2 py-1 text-xs hover:bg-page"
          >
            CSV
          </a>
          {isOwner && (
          <button
            onClick={() => setShareOpen((v) => !v)}
            className="rounded border border-line px-2 py-1 text-xs hover:bg-page"
          >
            Share
          </button>
          )}
        </div>
      </div>

      {closeWeek.isSuccess && (
        <div className="border-b border-line bg-surface px-4 py-1 text-xs text-muted">
          Week closed, snapshot saved.{" "}
          {(closeWeek.data as { diff?: { total_abs_delta?: string } })?.diff
            ?.total_abs_delta && (
            <>
              Deviation from plan:{" "}
              {fmtNum(
                (closeWeek.data as { diff: { total_abs_delta: string } }).diff
                  .total_abs_delta,
              )}{" "}
              days
            </>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2">
        {query.isLoading && (
          <div className="py-16 text-center text-muted">Loading timeline…</div>
        )}
        {query.isError && (
          <div className="py-16 text-center text-sm text-muted">
            Could not load data.{" "}
            <button onClick={() => query.refetch()} className="underline">
              Retry
            </button>
          </div>
        )}
        {data && data.members.length === 0 && (
          <div className="py-16 text-center text-sm text-muted">
            The workspace has no team members yet.{" "}
            {canEdit ? (
              <>
                Add your team on the{" "}
                <Link to={wsPath("/team")} className="text-accent underline">
                  Team
                </Link>{" "}
                tab — and the grid comes alive.
              </>
            ) : (
              "Ask an editor to add the team."
            )}
          </div>
        )}
        {data && data.members.length > 0 && (
          <>
            <div className="mb-2">
              <LoadLegend />
            </div>
            <TimelineGrid
              data={data}
              setCells={setCells}
              undo={undo}
              redo={redo}
              readOnly={!canEdit}
              extraRows={extraRows}
              onAddRow={(memberId, projectId) =>
                setExtraRows((s) => ({
                  ...s,
                  [memberId]: [...(s[memberId] ?? []), projectId],
                }))
              }
              onRemoveRow={(memberId, projectId) =>
                setExtraRows((s) => ({
                  ...s,
                  [memberId]: (s[memberId] ?? []).filter((p) => p !== projectId),
                }))
              }
            />
          </>
        )}
      </div>

      {capacityOpen && <CapacityPanel onClose={() => setCapacityOpen(false)} />}
      {shareOpen && <SharePanel onClose={() => setShareOpen(false)} />}
      {absencesOpen && <AbsencePanel onClose={() => setAbsencesOpen(false)} />}
    </div>
  );
}
