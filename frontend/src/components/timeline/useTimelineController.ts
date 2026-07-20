import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { getWorkspaceSlug, wapi } from "../../api/client";
import type { TimelineResponse } from "../../api/types";

/** Мутация одной ячейки: load=null — очистить. */
export interface CellChange {
  member_id: string;
  project_id: string;
  day: string;
  load: string | null;
}

interface UndoEntry {
  before: CellChange[];
  after: CellChange[];
}

const MAX_UNDO = 50;

export function timelineKey(from: string, to: string) {
  return ["timeline", from, to, getWorkspaceSlug()] as const;
}

/** Пересчёт производных полей после оптимистичного изменения аллокаций. */
export function applyCells(
  data: TimelineResponse,
  cells: CellChange[],
): TimelineResponse {
  let allocations = [...data.allocations];
  for (const c of cells) {
    const idx = allocations.findIndex(
      (a) =>
        a.member_id === c.member_id &&
        a.project_id === c.project_id &&
        a.day === c.day,
    );
    if (c.load === null) {
      if (idx >= 0) allocations.splice(idx, 1);
    } else if (idx >= 0) {
      allocations[idx] = { ...allocations[idx], load: c.load };
    } else {
      allocations.push({
        id: `tmp-${c.member_id}-${c.project_id}-${c.day}`,
        member_id: c.member_id,
        project_id: c.project_id,
        day: c.day,
        load: c.load,
        is_sole_owner: false,
        note: null,
      });
    }
  }

  const byMemberDay = new Map<string, number>();
  for (const a of allocations) {
    const key = `${a.member_id}|${a.day}`;
    byMemberDay.set(key, (byMemberDay.get(key) ?? 0) + parseFloat(a.load));
  }

  const members = data.members.map((tm) => {
    let totalAllocated = 0;
    let totalFree = 0;
    const days = tm.days.map((d) => {
      const allocated = byMemberDay.get(`${tm.member.id}|${d.day}`) ?? 0;
      const capacity = parseFloat(d.capacity);
      const free = Math.max(0, capacity - allocated);
      totalAllocated += allocated;
      totalFree += free;
      return { ...d, allocated: String(allocated), free: String(free) };
    });
    return {
      ...tm,
      days,
      total_allocated: String(totalAllocated),
      total_free: String(totalFree),
    };
  });

  const day_totals = data.day_totals.map((t) => {
    let free = 0;
    let allocated = 0;
    for (const tm of members) {
      const d = tm.days.find((x) => x.day === t.day);
      if (d) {
        free += parseFloat(d.free);
        allocated += parseFloat(d.allocated);
      }
    }
    return { ...t, free: String(free), allocated: String(allocated) };
  });

  const weeks = data.weeks.map((w) => {
    const end = addDaysISO(w.week_start, 6);
    const free = day_totals
      .filter((t) => t.day >= w.week_start && t.day <= end)
      .reduce((s, t) => s + parseFloat(t.free), 0);
    return { ...w, free_total: String(free) };
  });

  const totalCap = day_totals.reduce((s, t) => s + parseFloat(t.capacity), 0);
  const totalAlloc = day_totals.reduce((s, t) => s + parseFloat(t.allocated), 0);

  return {
    ...data,
    allocations,
    members,
    day_totals,
    weeks,
    utilization_pct: totalCap
      ? Math.round(Math.min(totalAlloc / totalCap, 2) * 1000) / 10
      : 0,
  };
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export type SaveState = "saved" | "saving" | "error";

export function useTimelineController(from: string, to: string) {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastError, setLastError] = useState<string | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const pending = useRef(0);

  const query = useQuery<TimelineResponse>({
    queryKey: timelineKey(from, to),
    queryFn: () => wapi.get<TimelineResponse>(`/timeline?from=${from}&to=${to}`),
  });

  const mutation = useMutation({
    mutationFn: async (cells: CellChange[]) => {
      const items = cells.map((c) => ({
        member_id: c.member_id,
        project_id: c.project_id,
        date_from: c.day,
        date_to: c.day,
        load: c.load,
      }));
      return wapi.post("/allocations/bulk", { items });
    },
    onMutate: () => {
      pending.current += 1;
      setSaveState("saving");
    },
    onSuccess: () => {
      setLastError(null);
    },
    onError: (err) => {
      setSaveState("error");
      setLastError(err instanceof Error ? err.message : "Ошибка сети");
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
    onSettled: () => {
      pending.current -= 1;
      if (pending.current <= 0) {
        pending.current = 0;
        setSaveState((s) => (s === "error" ? "error" : "saved"));
      }
    },
  });

  /** Текущие значения ячеек — для формирования undo-записи. */
  const snapshotCells = useCallback(
    (cells: { member_id: string; project_id: string; day: string }[]): CellChange[] => {
      const data = queryClient.getQueryData<TimelineResponse>(timelineKey(from, to));
      if (!data) return [];
      return cells.map((c) => {
        const found = data.allocations.find(
          (a) =>
            a.member_id === c.member_id &&
            a.project_id === c.project_id &&
            a.day === c.day,
        );
        return { ...c, load: found ? found.load : null };
      });
    },
    [queryClient, from, to],
  );

  const applyOptimistic = useCallback(
    (cells: CellChange[]) => {
      queryClient.setQueryData<TimelineResponse>(timelineKey(from, to), (old) =>
        old ? applyCells(old, cells) : old,
      );
    },
    [queryClient, from, to],
  );

  /** Главная операция: изменить набор ячеек с записью в undo. */
  const setCells = useCallback(
    (cells: CellChange[]) => {
      if (!cells.length) return;
      const before = snapshotCells(cells);
      const changed = cells.filter((c, i) => c.load !== before[i]?.load);
      if (!changed.length) return;
      const beforeChanged = before.filter((b) =>
        changed.some(
          (c) =>
            c.member_id === b.member_id &&
            c.project_id === b.project_id &&
            c.day === b.day,
        ),
      );
      undoStack.current.push({ before: beforeChanged, after: changed });
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      redoStack.current = [];
      applyOptimistic(changed);
      mutation.mutate(changed);
    },
    [snapshotCells, applyOptimistic, mutation],
  );

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    applyOptimistic(entry.before);
    mutation.mutate(entry.before);
  }, [applyOptimistic, mutation]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    applyOptimistic(entry.after);
    mutation.mutate(entry.after);
  }, [applyOptimistic, mutation]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["timeline"] }),
    [queryClient],
  );

  return useMemo(
    () => ({
      query,
      setCells,
      undo,
      redo,
      saveState,
      lastError,
      refresh,
    }),
    [query, setCells, undo, redo, saveState, lastError, refresh],
  );
}
