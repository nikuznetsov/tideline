import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { ApiError, getWorkspaceSlug, wapi } from "../api/client";
import type { AbsenceItem, Member, NonWorkingDayItem } from "../api/types";
import { fromISO, rangeLabel, todayISO } from "../lib/dates";

const KIND_LABEL: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick leave",
  holiday: "Day off",
  other: "Other",
};

export function AbsencePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [kind, setKind] = useState("vacation");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const members = useQuery<Member[]>({
    queryKey: ["members", getWorkspaceSlug()],
    queryFn: () => wapi.get<Member[]>("/members"),
  });
  const absences = useQuery<AbsenceItem[]>({
    queryKey: ["absences", getWorkspaceSlug()],
    queryFn: () => wapi.get<AbsenceItem[]>("/absences"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["absences"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };

  const create = useMutation({
    mutationFn: (body: {
      member_id: string;
      date_from: string;
      date_to: string;
      kind: string;
      note: string | null;
      clear_allocations?: boolean;
    }) => wapi.post("/absences", body),
    onSuccess: () => {
      setError(null);
      setConflict(null);
      setNote("");
      invalidate();
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        (e.detail as { code?: string })?.code === "allocations_exist"
      ) {
        setError(null);
        setConflict(e.message);
      } else {
        setConflict(null);
        setError(e instanceof ApiError ? e.message : "Could not save");
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => wapi.delete(`/absences/${id}`),
    onSuccess: invalidate,
  });

  const memberName = (id: string) =>
    members.data?.find((m) => m.id === id)?.name ?? "—";

  function submit(e: FormEvent, clearAllocations = false) {
    e.preventDefault();
    if (!memberId) {
      setError("Select a team member");
      return;
    }
    create.mutate({
      member_id: memberId,
      date_from: from,
      date_to: to,
      kind,
      note: note.trim() || null,
      clear_allocations: clearAllocations,
    });
  }

  const upcoming = (absences.data ?? []).filter((a) => a.date_to >= todayISO());
  const past = (absences.data ?? []).filter((a) => a.date_to < todayISO());

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col border-l border-line bg-surface shadow-2xl"
      role="dialog"
      aria-label="Absences"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-sm font-bold">Absences</h2>
        <button onClick={onClose} className="text-muted hover:text-ink">✕</button>
      </div>

      <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3">
        <label className="col-span-2 text-xs text-muted">
          Team member
          <select
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value);
              setConflict(null);
            }}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          >
            <option value="">— select —</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (to < e.target.value) setTo(e.target.value);
              setConflict(null);
            }}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          />
        </label>
        <label className="text-xs text-muted">
          To (inclusive)
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setConflict(null);
            }}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          />
        </label>
        <label className="text-xs text-muted">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
          >
            {Object.entries(KIND_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
          />
        </label>
        {error && <p className="col-span-2 text-xs text-accent">{error}</p>}
        {conflict && (
          <div className="col-span-2 rounded border border-accent/40 bg-[var(--load-over-bg)] p-3">
            <p className="text-xs text-[var(--load-over-ink)]">
              {conflict} Clear these days and add the absence?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={(e) => submit(e, true)}
                disabled={create.isPending}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                Clear and add
              </button>
              <button
                type="button"
                onClick={() => setConflict(null)}
                className="rounded border border-line bg-surface px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="col-span-2 rounded bg-ink py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
        >
          Add absence
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {absences.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {absences.isSuccess && upcoming.length === 0 && past.length === 0 && (
          <p className="text-sm text-muted">
            No absences. Add a vacation with the form above — the days will automatically
            drop out of capacity on the timeline and in the capacity search.
          </p>
        )}

        {upcoming.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Current and upcoming
            </div>
            <div className="space-y-1.5">
              {upcoming.map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={a}
                  memberName={memberName(a.member_id)}
                  onDelete={() => remove.mutate(a.id)}
                />
              ))}
            </div>
          </div>
        )}

        {past.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Past
            </div>
            <div className="space-y-1.5 opacity-60">
              {past.slice(0, 15).map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={a}
                  memberName={memberName(a.member_id)}
                  onDelete={() => remove.mutate(a.id)}
                />
              ))}
            </div>
          </div>
        )}

        <NonWorkingDays onChanged={invalidate} />
      </div>
    </aside>
  );
}

function NonWorkingDays({ onChanged }: { onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const days = useQuery<NonWorkingDayItem[]>({
    queryKey: ["non-working-days", getWorkspaceSlug()],
    queryFn: () => wapi.get<NonWorkingDayItem[]>("/non-working-days"),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["non-working-days"] });
    onChanged();
  };

  const create = useMutation({
    mutationFn: (body: { day: string; title: string | null }) =>
      wapi.post("/non-working-days", body),
    onSuccess: () => {
      setError(null);
      setDay("");
      setTitle("");
      refresh();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => wapi.delete(`/non-working-days/${id}`),
    onSuccess: refresh,
  });

  const upcoming = (days.data ?? []).filter((d) => d.day >= todayISO());

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        Company calendar
      </div>
      <p className="mb-2 text-xs text-muted">
        Holidays and moved working days for the whole team: the day drops out of everyone's capacity.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (day) create.mutate({ day, title: title.trim() || null });
        }}
        className="mb-2 flex gap-2"
      >
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          required
          className="rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name (e.g. New Year's Day)"
          className="flex-1 rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
        >
          +
        </button>
      </form>
      {error && <p className="mb-2 text-xs text-accent">{error}</p>}
      <div className="space-y-1">
        {days.isSuccess && upcoming.length === 0 && (
          <p className="text-xs text-muted">No upcoming non-working days.</p>
        )}
        {upcoming.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded border border-line px-3 py-1.5 text-sm"
          >
            <span className="font-nums">
              {fromISO(d.day).toLocaleDateString("en-GB")}{" "}
              <span className="text-muted">{d.title ?? ""}</span>
            </span>
            <button
              onClick={() => remove.mutate(d.id)}
              className="text-xs text-accent underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AbsenceRow({
  absence,
  memberName,
  onDelete,
}: {
  absence: AbsenceItem;
  memberName: string;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-line px-3 py-1.5">
      <div>
        <div className="text-sm">
          <span className="font-medium">{memberName}</span>{" "}
          <span className="text-muted">
            · {KIND_LABEL[absence.kind] ?? absence.kind}
          </span>
        </div>
        <div className="text-xs text-muted font-nums">
          {rangeLabel(absence.date_from, absence.date_to)}
          {absence.note && ` · ${absence.note}`}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="text-xs text-accent underline"
        title="Remove absence — the days return to capacity"
      >
        Remove
      </button>
    </div>
  );
}
