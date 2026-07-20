import { useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import type { CapacitySearchResult } from "../../api/types";
import { addDays, currentMonday, dayLabel } from "../../lib/dates";
import { fmtNum, plural } from "../../lib/format";

const WARNING_LABEL: Record<string, string> = {
  bus_factor: "Bus factor",
  absence: "Отпуск",
  fragmentation: "Фрагментация",
};

export function CapacityPanel({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState(addDays(currentMonday(), 14));
  const [to, setTo] = useState(addDays(currentMonday(), 25));
  const [needed, setNeeded] = useState("15");
  const [minDaily, setMinDaily] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const query = useQuery<CapacitySearchResult>({
    queryKey: ["capacity", submitted],
    queryFn: () => api.get<CapacitySearchResult>(`/capacity/search?${submitted}`),
    enabled: !!submitted,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams({
      from,
      to,
      needed_person_days: needed,
    });
    if (minDaily) p.set("min_daily", minDaily);
    setSubmitted(p.toString());
  }

  const r = query.data;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[420px] max-w-full flex-col border-l border-line bg-surface shadow-2xl"
      role="dialog"
      aria-label="Поиск свободного ресурса"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-wide text-sm font-bold">Хватит ли людей?</h2>
        <button onClick={onClose} className="text-muted hover:text-ink">✕</button>
      </div>

      <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3">
        <label className="text-xs text-muted">
          С
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          />
        </label>
        <label className="text-xs text-muted">
          По
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink"
            required
          />
        </label>
        <label className="text-xs text-muted">
          Нужно, дней
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={needed}
            onChange={(e) => setNeeded(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink font-nums"
            required
          />
        </label>
        <label className="text-xs text-muted">
          Мин. доля дня
          <input
            type="number"
            min="0"
            max="1"
            step="0.25"
            placeholder="напр. 0.5"
            value={minDaily}
            onChange={(e) => setMinDaily(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-page px-2 py-1.5 text-sm text-ink font-nums"
          />
        </label>
        <button
          type="submit"
          className="col-span-2 rounded bg-mts py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Проверить
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {!submitted && (
          <p className="text-sm text-muted">
            Укажите диапазон и объём — панель ответит, хватает ли свободной
            ёмкости, и покажет кандидатов с предупреждениями.
          </p>
        )}
        {query.isLoading && <p className="text-sm text-muted">Считаем…</p>}
        {query.isError && (
          <p className="text-sm text-mts">Не удалось выполнить поиск.</p>
        )}
        {r && (
          <>
            <div
              className={`mb-2 rounded-lg border px-4 py-3 ${
                r.enough
                  ? "border-line bg-page"
                  : "border-mts/40 bg-[var(--load-over-bg)]"
              }`}
            >
              <div className="font-wide text-sm font-bold">
                {r.enough
                  ? "Хватает"
                  : `Не хватает ${fmtNum(r.deficit)} ${plural(Math.ceil(parseFloat(r.deficit)), "дня", "дней", "дней")}`}
              </div>
              <div className="mt-1 text-xs text-muted">
                Свободно {fmtNum(r.total_free)} из требуемых {fmtNum(r.needed)}{" "}
                дней
              </div>
            </div>
            {r.plan_horizon_warning && (
              <p className="mb-3 rounded border border-line bg-page px-3 py-2 text-xs text-muted">
                Диапазон дальше двух недель — это план, а не факт. Надёжность
                оценки ниже.
              </p>
            )}
            <div className="space-y-2">
              {r.candidates.length === 0 && (
                <p className="text-sm text-muted">
                  Свободных людей в диапазоне нет. Попробуйте расширить даты
                  или снизить минимальную долю дня.
                </p>
              )}
              {r.candidates.map((c) => (
                <div key={c.member.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-sm font-medium">{c.member.name}</span>
                      {c.member.role_title && (
                        <span className="ml-2 text-xs text-muted">{c.member.role_title}</span>
                      )}
                    </div>
                    <span className="text-sm font-bold font-nums">
                      {fmtNum(c.free_total)}
                    </span>
                  </div>
                  {c.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {c.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1 text-xs">
                          <span
                            className={`mt-px rounded px-1 text-[10px] font-bold uppercase ${
                              w.kind === "bus_factor"
                                ? "bg-[var(--load-over-bg)] text-[var(--load-over-ink)]"
                                : "bg-page text-muted"
                            }`}
                          >
                            {WARNING_LABEL[w.kind] ?? w.kind}
                          </span>
                          <span className="text-muted">{w.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-px">
                    {Object.entries(c.free_by_day).map(([d, v]) => (
                      <span
                        key={d}
                        title={`${dayLabel(d)}: свободно ${fmtNum(v)}`}
                        className="rounded-sm px-1 py-px text-[10px] font-nums"
                        style={{
                          background:
                            parseFloat(v) >= 1
                              ? "var(--load-full-bg)"
                              : "var(--load-partial-bg)",
                          color:
                            parseFloat(v) >= 1
                              ? "var(--load-full-ink)"
                              : "var(--load-partial-ink)",
                        }}
                      >
                        {dayLabel(d).slice(3)}·{fmtNum(v)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
