import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AbsenceItem, Member } from "../api/types";
import { rangeLabel, todayISO } from "../lib/dates";

const KIND_LABEL: Record<string, string> = {
  vacation: "Отпуск",
  sick: "Болезнь",
  holiday: "Отгул",
  other: "Другое",
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
    queryKey: ["members"],
    queryFn: () => api.get<Member[]>("/members"),
  });
  const absences = useQuery<AbsenceItem[]>({
    queryKey: ["absences"],
    queryFn: () => api.get<AbsenceItem[]>("/absences"),
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
    }) => api.post("/absences", body),
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
        setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/absences/${id}`),
    onSuccess: invalidate,
  });

  const memberName = (id: string) =>
    members.data?.find((m) => m.id === id)?.name ?? "—";

  function submit(e: FormEvent, clearAllocations = false) {
    e.preventDefault();
    if (!memberId) {
      setError("Выберите сотрудника");
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
      aria-label="Отпуска и отсутствия"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-wide text-sm font-bold">Отпуска и отсутствия</h2>
        <button onClick={onClose} className="text-muted hover:text-ink">✕</button>
      </div>

      <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3">
        <label className="col-span-2 text-xs text-muted">
          Сотрудник
          <select
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value);
              setConflict(null);
            }}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          >
            <option value="">— выберите —</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          С
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
          По (включительно)
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
          Тип
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
          Заметка
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="необязательно"
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
          />
        </label>
        {error && <p className="col-span-2 text-xs text-mts">{error}</p>}
        {conflict && (
          <div className="col-span-2 rounded border border-mts/40 bg-[var(--load-over-bg)] p-3">
            <p className="text-xs text-[var(--load-over-ink)]">
              {conflict} Очистить эти дни и оформить отсутствие?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={(e) => submit(e, true)}
                disabled={create.isPending}
                className="rounded bg-mts px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Очистить и добавить
              </button>
              <button
                type="button"
                onClick={() => setConflict(null)}
                className="rounded border border-line bg-surface px-3 py-1.5 text-xs"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="col-span-2 rounded bg-ink py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
        >
          Добавить отсутствие
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {absences.isLoading && <p className="text-sm text-muted">Загрузка…</p>}
        {absences.isSuccess && upcoming.length === 0 && past.length === 0 && (
          <p className="text-sm text-muted">
            Отсутствий нет. Добавьте отпуск формой выше — дни автоматически
            выпадут из ёмкости на таймлайне и в поиске ресурса.
          </p>
        )}

        {upcoming.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Текущие и будущие
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
              Прошедшие
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
      </div>
    </aside>
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
        className="text-xs text-mts underline"
        title="Снять отсутствие — дни вернутся в ёмкость"
      >
        Снять
      </button>
    </div>
  );
}
