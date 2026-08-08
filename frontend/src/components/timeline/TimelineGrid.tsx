import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../ConfirmDialog";
import { useWorkspaceMaybe } from "../../workspace";
import type { TimelineProject, TimelineResponse } from "../../api/types";
import { dayLabel, isWeekendISO } from "../../lib/dates";
import { fmtLoad, fmtNum } from "../../lib/format";
import {
  CATEGORY_GLYPH,
  CATEGORY_KEY,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryCellClass,
  summaryLoadClass,
  type LoadCategory,
} from "../../lib/categories";
import type { CellChange } from "./useTimelineController";

const QUICK_KEYS: Record<string, LoadCategory> = {
  "1": "full",
  "5": "half",
  "2": "background",
  "7": "most",
};

interface GridRow {
  memberId: string;
  projectId: string;
  projectCode: string;
}

interface Props {
  data: TimelineResponse;
  setCells: (cells: CellChange[]) => void;
  undo: () => void;
  redo: () => void;
  /** дополнительные (ещё пустые) строки проекта у сотрудника */
  extraRows: Record<string, string[]>;
  onAddRow: (memberId: string, projectId: string) => void;
  onRemoveRow?: (memberId: string, projectId: string) => void;
  readOnly?: boolean;
}

export function TimelineGrid({
  data,
  setCells,
  undo,
  redo,
  extraRows,
  onAddRow,
  onRemoveRow,
  readOnly = false,
}: Props) {
  const wsCtx = useWorkspaceMaybe();
  // выходные не показываем: планирование идёт только по будням
  const visibleTotals = useMemo(
    () => data.day_totals.filter((t) => !isWeekendISO(t.day)),
    [data.day_totals],
  );
  const days = visibleTotals.map((t) => t.day);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [picker, setPicker] = useState<{ r: number; c: number } | null>(null);
  const [removeRow, setRemoveRow] = useState<{
    memberId: string;
    projectId: string;
    code: string;
    allocatedDays: string[];
  } | null>(null);
  const dragging = useRef(false);
  const fillDrag = useRef<{ r: number; c0: number; c1: number } | null>(null);
  const [fillPreview, setFillPreview] = useState<{ r: number; c0: number; c1: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const projectsById = useMemo(() => {
    const map = new Map<string, TimelineProject>();
    data.projects.forEach((p) => map.set(p.id, p));
    return map;
  }, [data.projects]);

  const allocMap = useMemo(() => {
    const map = new Map<string, { category: LoadCategory }>();
    for (const a of data.allocations) {
      map.set(`${a.member_id}|${a.project_id}|${a.day}`, { category: a.category });
    }
    return map;
  }, [data.allocations]);

  /** редактируемые строки в порядке отображения — для клавиатурной навигации */
  const rows: GridRow[] = useMemo(() => {
    const result: GridRow[] = [];
    for (const tm of data.members) {
      if (!expanded[tm.member.id]) continue;
      const projectIds = new Set<string>();
      for (const a of data.allocations) {
        if (a.member_id === tm.member.id) projectIds.add(a.project_id);
      }
      (extraRows[tm.member.id] ?? []).forEach((p) => projectIds.add(p));
      const sorted = [...projectIds].sort((a, b) =>
        (projectsById.get(a)?.code ?? "").localeCompare(projectsById.get(b)?.code ?? ""),
      );
      for (const pid of sorted) {
        result.push({
          memberId: tm.member.id,
          projectId: pid,
          projectCode: projectsById.get(pid)?.code ?? "?",
        });
      }
    }
    return result;
  }, [data.members, data.allocations, expanded, extraRows, projectsById]);

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => map.set(`${row.memberId}|${row.projectId}`, i));
    return map;
  }, [rows]);

  const memberById = useMemo(() => {
    const map = new Map<string, (typeof data.members)[number]>();
    data.members.forEach((tm) => map.set(tm.member.id, tm));
    return map;
  }, [data.members]);

  const dayInfo = useCallback(
    (memberId: string, day: string) => {
      const tm = memberById.get(memberId);
      const d = tm?.days.find((x) => x.day === day);
      return d;
    },
    [memberById],
  );

  const isEditable = useCallback(
    (r: number, c: number) => {
      if (readOnly) return false;
      const row = rows[r];
      if (!row) return false;
      const d = dayInfo(row.memberId, days[c]);
      return !!d && d.is_working && !d.is_absent;
    },
    [rows, days, dayInfo, readOnly],
  );

  const selection = useMemo(() => {
    if (!focus) return null;
    const a = anchor ?? focus;
    return {
      r0: Math.min(a.r, focus.r),
      r1: Math.max(a.r, focus.r),
      c0: Math.min(a.c, focus.c),
      c1: Math.max(a.c, focus.c),
    };
  }, [focus, anchor]);

  const inSelection = useCallback(
    (r: number, c: number) =>
      !!selection &&
      r >= selection.r0 &&
      r <= selection.r1 &&
      c >= selection.c0 &&
      c <= selection.c1 &&
      (selection.r0 !== selection.r1 || selection.c0 !== selection.c1),
    [selection],
  );

  const applyToSelection = useCallback(
    (category: LoadCategory | null) => {
      if (!focus) return;
      const sel = selection ?? { r0: focus.r, r1: focus.r, c0: focus.c, c1: focus.c };
      const cells: CellChange[] = [];
      for (let r = sel.r0; r <= sel.r1; r++) {
        for (let c = sel.c0; c <= sel.c1; c++) {
          if (!isEditable(r, c)) continue;
          cells.push({
            member_id: rows[r].memberId,
            project_id: rows[r].projectId,
            day: days[c],
            category,
          });
        }
      }
      setCells(cells);
    },
    [focus, selection, isEditable, rows, days, setCells],
  );

  /** убрать строку проекта: пустую — сразу, с загрузкой — через подтверждение */
  const requestRemoveRow = useCallback(
    (row: GridRow) => {
      const allocatedDays = days.filter((d) =>
        allocMap.has(`${row.memberId}|${row.projectId}|${d}`),
      );
      if (!allocatedDays.length) {
        onRemoveRow?.(row.memberId, row.projectId);
        setFocus(null);
        setAnchor(null);
        return;
      }
      setRemoveRow({
        memberId: row.memberId,
        projectId: row.projectId,
        code: row.projectCode,
        allocatedDays,
      });
    },
    [days, allocMap, onRemoveRow],
  );

  const confirmRemoveRow = useCallback(() => {
    if (!removeRow) return;
    setCells(
      removeRow.allocatedDays.map((day) => ({
        member_id: removeRow.memberId,
        project_id: removeRow.projectId,
        day,
        category: null,
      })),
    );
    onRemoveRow?.(removeRow.memberId, removeRow.projectId);
    setFocus(null);
    setAnchor(null);
  }, [removeRow, setCells, onRemoveRow]);

  /** выбор в пикере: применить к выделению, фокус вниз — как раньше у редактора */
  const commitPicker = useCallback(
    (category: LoadCategory | null) => {
      if (!picker) return;
      setPicker(null);
      applyToSelection(category);
      if (picker.r < rows.length - 1) setFocus({ r: picker.r + 1, c: picker.c });
      containerRef.current?.focus();
    },
    [picker, applyToSelection, rows.length],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      if (picker) return; // ввод обрабатывает пикер
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!focus) return;
      const move = (dr: number, dc: number, extend: boolean) => {
        e.preventDefault();
        const r = Math.max(0, Math.min(rows.length - 1, focus.r + dr));
        const c = Math.max(0, Math.min(days.length - 1, focus.c + dc));
        if (extend) {
          if (!anchor) setAnchor(focus);
        } else {
          setAnchor(null);
        }
        setFocus({ r, c });
      };
      switch (e.key) {
        case "ArrowLeft":
          move(0, -1, e.shiftKey);
          return;
        case "ArrowRight":
          move(0, 1, e.shiftKey);
          return;
        case "ArrowUp":
          move(-1, 0, e.shiftKey);
          return;
        case "ArrowDown":
          move(1, 0, e.shiftKey);
          return;
        case "Tab":
          move(0, e.shiftKey ? -1 : 1, false);
          return;
        case "Enter":
          e.preventDefault();
          if (isEditable(focus.r, focus.c)) setPicker({ r: focus.r, c: focus.c });
          return;
        case "Escape":
          setAnchor(null);
          return;
        case "Delete":
        case "Backspace":
        case "0":
          e.preventDefault();
          applyToSelection(null);
          return;
      }
      if (QUICK_KEYS[e.key]) {
        e.preventDefault();
        applyToSelection(QUICK_KEYS[e.key]);
        return;
      }
    },
    [picker, focus, anchor, rows, days, undo, redo, applyToSelection, isEditable, readOnly],
  );

  // drag-fill: применить значение исходной ячейки на диапазон
  useEffect(() => {
    const onUp = () => {
      dragging.current = false;
      const fd = fillDrag.current;
      if (fd) {
        const row = rows[fd.r];
        const src = allocMap.get(`${row.memberId}|${row.projectId}|${days[fd.c0]}`);
        const cells: CellChange[] = [];
        const [lo, hi] = [Math.min(fd.c0, fd.c1), Math.max(fd.c0, fd.c1)];
        for (let c = lo; c <= hi; c++) {
          if (c === fd.c0 || !isEditable(fd.r, c)) continue;
          cells.push({
            member_id: row.memberId,
            project_id: row.projectId,
            day: days[c],
            category: src?.category ?? null,
          });
        }
        setCells(cells);
        fillDrag.current = null;
        setFillPreview(null);
      }
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [rows, days, allocMap, isEditable, setCells]);

  const weekStarts = useMemo(
    () => new Set(data.weeks.map((w) => w.week_start)),
    [data.weeks],
  );
  const currentWeek = data.weeks.find((w) => w.is_current);
  /** последний день текущей недели, попавший в окно, — граница «линии прилива» */
  const tidelineDay = useMemo(() => {
    if (!currentWeek) return null;
    const weekEnd = addDays(currentWeek.week_start, 7);
    const end = days.filter((d) => d >= currentWeek.week_start && d < weekEnd).pop();
    return end && days[days.length - 1] !== end ? end : null;
  }, [currentWeek, days]);

  const gridCols = `minmax(190px, 240px) repeat(${days.length}, minmax(38px, 1fr)) minmax(88px, 110px)`;
  const needScroll = days.length > 10;

  return (
    <div
      className={needScroll ? "overflow-x-auto" : ""}
      onMouseLeave={() => (dragging.current = false)}
    >
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="outline-none"
        style={needScroll ? { minWidth: `${240 + days.length * 44 + 110}px` } : undefined}
        role="grid"
        aria-label="Таймлайн загрузки"
      >
        {/* ---- заголовки недель ---- */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div className={needScroll ? "sticky left-0 z-10 bg-page" : ""} />
          {data.weeks.map((w) => {
            const count = days.filter(
              (d) => d >= w.week_start && d < addDays(w.week_start, 7),
            ).length;
            return (
              <div
                key={w.week_start}
                style={{ gridColumn: `span ${count}` }}
                className={`flex items-center gap-2 px-2 py-1 ${w.week_start !== data.weeks[0].week_start ? "week-gap" : "border-l-2 border-line"}`}
              >
                <span className="text-xs font-medium">
                  {dayLabel(w.week_start).slice(3)}.{w.week_start.slice(5, 7)}
                </span>
                <span
                  className={`rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                    w.is_past || w.is_current
                      ? "bg-ink text-surface"
                      : "border border-line text-muted"
                  }`}
                  title={
                    w.is_past || w.is_current
                      ? "Факт: текущая или прошедшая неделя"
                      : "План: будущая неделя, надёжность ниже"
                  }
                >
                  {w.is_past || w.is_current ? "факт" : "план"}
                </span>
                {w.is_closed && (
                  <span className="text-[10px] text-muted" title="Неделя закрыта">
                    🔒
                  </span>
                )}
              </div>
            );
          })}
          <div />
        </div>

        {/* ---- заголовки дней ---- */}
        <div
          className="grid border-b border-line text-center"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div
            className={`px-2 py-1 text-left text-[11px] uppercase tracking-wide text-muted ${
              needScroll ? "sticky left-0 z-10 bg-page" : ""
            }`}
          >
            Команда
          </div>
          {days.map((d) => {
            const off =
              isWeekendISO(d) || data.non_working_days.includes(d);
            return (
              <div
                key={d}
                className={`py-1 text-[11px] font-nums ${
                  off ? "text-muted/60" : "text-muted"
                } ${weekStarts.has(d) && d !== days[0] ? "week-gap" : ""} ${
                  d === tidelineDay ? "tideline-edge" : ""
                }`}
              >
                {dayLabel(d)}
              </div>
            );
          })}
          <div className="py-1 pr-2 text-right text-[11px] uppercase tracking-wide text-muted">
            Занято/своб.
          </div>
        </div>

        {/* ---- блоки сотрудников ---- */}
        {data.members.map((tm) => {
          const isOpen = !!expanded[tm.member.id];
          const memberRows = rows.filter((r) => r.memberId === tm.member.id);
          return (
            <Fragment key={tm.member.id}>
              {/* сводная строка */}
              <div
                className="grid items-stretch border-b border-line bg-surface"
                style={{ gridTemplateColumns: gridCols }}
              >
                <button
                  onClick={() =>
                    setExpanded((s) => ({ ...s, [tm.member.id]: !isOpen }))
                  }
                  className={`flex items-center gap-1.5 px-2 py-1 text-left hover:bg-page ${
                    needScroll ? "sticky left-0 z-10 bg-surface" : ""
                  }`}
                  title={isOpen ? "Свернуть" : "Развернуть по проектам"}
                >
                  <span className="text-[10px] text-muted">{isOpen ? "▾" : "▸"}</span>
                  <span className="truncate text-sm font-medium">{tm.member.name}</span>
                  {tm.member.role_title && (
                    <span className="hidden truncate text-[11px] text-muted xl:inline">
                      {tm.member.role_title}
                    </span>
                  )}
                </button>
                {tm.days.filter((d) => !isWeekendISO(d.day)).map((d) => {
                  const load = parseFloat(d.allocated);
                  const cap = parseFloat(d.capacity);
                  const off = !d.is_working;
                  return (
                    <div
                      key={d.day}
                      className={`relative flex items-center justify-center border-l border-line/60 py-1 text-xs font-nums ${
                        weekStarts.has(d.day) && d.day !== days[0] ? "week-gap" : ""
                      } ${d.day === tidelineDay ? "tideline-edge" : ""} ${
                        off ? "bg-[var(--cell-off)]" : summaryLoadClass(load, cap).className
                      }`}
                      style={
                        d.is_absent
                          ? { backgroundImage: "var(--cell-absent)" }
                          : cap > 0 && load > cap
                            ? { backgroundImage: "var(--cell-over-hatch)" }
                            : undefined
                      }
                      title={
                        d.is_absent
                          ? "Отсутствие"
                          : off
                            ? "Нерабочий день"
                            : `Загрузка ${fmtNum(load)} из ${fmtNum(cap)}`
                      }
                    >
                      {!off && !d.is_absent && (load > 0 ? fmtLoad(load) : "")}
                      {!off && cap > 0 && load > cap && (
                        <span className="absolute right-0.5 top-0 text-[9px]" aria-label="перегруз">
                          ⚠
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-end gap-1 py-1 pr-2 text-xs font-nums">
                  <span className="font-medium">{fmtNum(tm.total_allocated)}</span>
                  <span className="text-muted">/</span>
                  <span className="text-muted">{fmtNum(tm.total_free)}</span>
                </div>
              </div>

              {/* развёрнутые строки по проектам */}
              {isOpen &&
                memberRows.map((row) => {
                  const r = rowIndex.get(`${row.memberId}|${row.projectId}`)!;
                  return (
                    <div
                      key={row.projectId}
                      className="grid items-stretch border-b border-line/50"
                      style={{ gridTemplateColumns: gridCols }}
                    >
                      <div
                        className={`group/row flex items-center gap-1 py-0.5 pl-7 pr-2 text-xs text-muted ${
                          needScroll ? "sticky left-0 z-10 bg-page" : ""
                        }`}
                      >
                        {readOnly || !wsCtx ? (
                          <span className="truncate" title={projectsById.get(row.projectId)?.name}>
                            {row.projectCode}
                          </span>
                        ) : (
                          <Link
                            to={wsCtx!.wsPath(`/projects/${row.projectId}`)}
                            title={`${projectsById.get(row.projectId)?.name ?? ""} — открыть карточку`}
                            className="truncate hover:text-mts hover:underline"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {row.projectCode}
                          </Link>
                        )}
                        {!readOnly && (
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => requestRemoveRow(row)}
                            title="Убрать проект у сотрудника (снять загрузку в окне)"
                            aria-label={`Убрать строку ${row.projectCode}`}
                            className="ml-auto hidden rounded px-1 text-muted hover:bg-page hover:text-mts group-hover/row:block"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {days.map((d, c) => {
                        const cellData = allocMap.get(
                          `${row.memberId}|${row.projectId}|${d}`,
                        );
                        const category = cellData?.category ?? null;
                        const info = dayInfo(row.memberId, d);
                        const off = !info?.is_working;
                        const absent = !!info?.is_absent;
                        const isFocus = focus?.r === r && focus?.c === c;
                        const isSel = inSelection(r, c);
                        const inFill =
                          fillPreview &&
                          fillPreview.r === r &&
                          c >= Math.min(fillPreview.c0, fillPreview.c1) &&
                          c <= Math.max(fillPreview.c0, fillPreview.c1);
                        const picking = picker && picker.r === r && picker.c === c;
                        return (
                          <div
                            key={d}
                            role="gridcell"
                            aria-selected={isFocus}
                            aria-label={category ? CATEGORY_LABEL[category] : undefined}
                            className={`group relative flex cursor-cell items-center justify-center border-l border-line/60 py-0.5 text-xs ${
                              weekStarts.has(d) && d !== days[0] ? "week-gap" : ""
                            } ${d === tidelineDay ? "tideline-edge" : ""} ${
                              off ? "bg-[var(--cell-off)] cursor-default" : ""
                            } ${category && !off ? categoryCellClass(category) : ""} ${
                              isSel || inFill ? "cell-selected" : ""
                            } ${isFocus ? "cell-focus" : ""}`}
                            style={absent ? { backgroundImage: "var(--cell-absent)" } : undefined}
                            title={
                              absent
                                ? "Отсутствие (отпуск/болезнь): ёмкость дня 0, планирование недоступно. Чтобы поставить загрузку, сначала снимите отсутствие."
                                : off
                                  ? "Нерабочий день"
                                  : category
                                    ? CATEGORY_LABEL[category]
                                    : undefined
                            }
                            onMouseDown={(e) => {
                              if (readOnly) return;
                              e.preventDefault();
                              containerRef.current?.focus();
                              dragging.current = true;
                              setFocus({ r, c });
                              setAnchor(e.shiftKey && focus ? (anchor ?? focus) : { r, c });
                            }}
                            onMouseEnter={() => {
                              if (fillDrag.current && fillDrag.current.r === r) {
                                fillDrag.current.c1 = c;
                                setFillPreview({ ...fillDrag.current });
                              } else if (dragging.current && focus) {
                                setAnchor((a) => a ?? { r: focus.r, c: focus.c });
                                setFocus({ r, c });
                              }
                            }}
                            onDoubleClick={() => {
                              if (isEditable(r, c)) setPicker({ r, c });
                            }}
                          >
                            {!off && !absent && category ? (
                              <span aria-hidden>{CATEGORY_GLYPH[category]}</span>
                            ) : (
                              ""
                            )}
                            {/* маркер растяжки как в Excel: виден на фокусе
                                и при наведении на заполненную ячейку */}
                            {!readOnly && !off && !absent && (isFocus || category) && (
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 cursor-ew-resize rounded-sm border border-surface bg-[var(--accent)] ${
                                  isFocus ? "" : "opacity-0 group-hover:opacity-100"
                                }`}
                                title="Потянуть, чтобы растянуть значение по дням"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  containerRef.current?.focus();
                                  setFocus({ r, c });
                                  setAnchor(null);
                                  fillDrag.current = { r, c0: c, c1: c };
                                  setFillPreview({ r, c0: c, c1: c });
                                }}
                              />
                            )}
                            {picking && (
                              <CategoryPicker
                                current={category}
                                onPick={commitPicker}
                                onClose={() => {
                                  setPicker(null);
                                  containerRef.current?.focus();
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                      <div />
                    </div>
                  );
                })}

              {/* строка добавления проекта */}
              {isOpen && !readOnly && (
                <AddProjectRow
                  gridCols={gridCols}
                  needScroll={needScroll}
                  projects={data.projects.filter(
                    (p) => p.lifecycle === "active" || p.lifecycle === "support",
                  )}
                  existing={new Set(memberRows.map((r) => r.projectId))}
                  onAdd={(projectId) => onAddRow(tm.member.id, projectId)}
                />
              )}
            </Fragment>
          );
        })}

        {/* ---- итоговые строки ---- */}
        <div className="sticky bottom-0 z-20 border-t-2 border-line bg-surface">
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
            <div
              className={`px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted ${
                needScroll ? "sticky left-0 bg-surface" : ""
              }`}
            >
              Свободно, дн.
            </div>
            {visibleTotals.map((t) => (
              <div
                key={t.day}
                className={`py-1 text-center text-xs font-nums ${
                  !t.is_working
                    ? "text-muted/40"
                    : parseFloat(t.free) === 0
                      ? "text-muted"
                      : "font-medium"
                } ${weekStarts.has(t.day) && t.day !== days[0] ? "week-gap" : ""} ${
                  t.day === tidelineDay ? "tideline-edge" : ""
                }`}
              >
                {t.is_working ? fmtNum(t.free) : ""}
              </div>
            ))}
            <div className="py-1 pr-2 text-right text-xs font-nums text-muted">
              за окно
            </div>
          </div>
          <div
            className="grid border-t border-line/60"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div
              className={`px-2 py-1 text-[11px] text-muted ${
                needScroll ? "sticky left-0 bg-surface" : ""
              }`}
            >
              Итог недели · утилизация {fmtNum(data.utilization_pct, 1)}%
            </div>
            {data.weeks.map((w) => {
              const count = days.filter(
                (d) => d >= w.week_start && d < addDays(w.week_start, 7),
              ).length;
              return (
                <div
                  key={w.week_start}
                  style={{ gridColumn: `span ${count}` }}
                  className={`py-1 text-center text-xs font-nums ${w.week_start !== data.weeks[0].week_start ? "week-gap" : "border-l-2 border-line"}`}
                >
                  свободно <span className="font-medium">{fmtNum(w.free_total)}</span>
                </div>
              );
            })}
            <div />
          </div>
        </div>
      </div>
      {removeRow && (
        <ConfirmDialog
          title="Убрать проект у сотрудника"
          message={
            <>
              Строка <b>{removeRow.code}</b> у сотрудника{" "}
              {memberById.get(removeRow.memberId)?.member.name ?? ""}: загрузка за{" "}
              {removeRow.allocatedDays.length} раб. дн. в видимом окне будет снята.
              Действие можно отменить (Ctrl+Z).
            </>
          }
          confirmLabel="Снять и убрать"
          onConfirm={confirmRemoveRow}
          onClose={() => setRemoveRow(null)}
        />
      )}
    </div>
  );
}

function AddProjectRow({
  gridCols,
  needScroll,
  projects,
  existing,
  onAdd,
}: {
  gridCols: string;
  needScroll: boolean;
  projects: TimelineProject[];
  existing: Set<string>;
  onAdd: (projectId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = projects.filter(
    (p) =>
      !existing.has(p.id) &&
      (p.code.toLowerCase().includes(q.toLowerCase()) ||
        p.name.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div
      className="grid border-b border-line/50"
      style={{ gridTemplateColumns: gridCols }}
    >
      <div
        className={`relative py-0.5 pl-7 pr-2 ${needScroll ? "sticky left-0 z-10 bg-page" : ""}`}
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="+ проект…"
          className="w-full bg-transparent text-xs text-muted placeholder-muted/70 outline-none"
          aria-label="Добавить проект сотруднику"
        />
        {open && filtered.length > 0 && (
          <div className="absolute left-6 top-6 z-30 max-h-48 w-64 overflow-auto rounded border border-line bg-surface shadow-lg">
            {filtered.map((p) => (
              <button
                key={p.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAdd(p.id);
                  setQ("");
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-page"
              >
                <span className="font-medium">{p.code}</span>{" "}
                <span className="text-muted">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ gridColumn: `span ${gridColsSpan(gridCols)}` }} />
    </div>
  );
}

/** Поповер выбора категории у ячейки: Enter/двойной клик открывают,
 * ↑/↓ + Enter или клик выбирают, 1/2/5/7 — быстрый выбор, 0 — очистить, Esc — закрыть. */
function CategoryPicker({
  current,
  onPick,
  onClose,
}: {
  current: LoadCategory | null;
  onPick: (category: LoadCategory | null) => void;
  onClose: () => void;
}) {
  const options: (LoadCategory | null)[] = [...CATEGORY_ORDER, null];
  const [active, setActive] = useState(
    Math.max(0, options.indexOf(current)),
  );
  const keyToCategory = useMemo(() => {
    const map = new Map<string, LoadCategory | null>();
    CATEGORY_ORDER.forEach((c) => map.set(CATEGORY_KEY[c], c));
    map.set("0", null);
    return map;
  }, []);
  return (
    <div
      role="listbox"
      aria-label="Категория загрузки"
      tabIndex={0}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => Math.min(options.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          onPick(options[active]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (keyToCategory.has(e.key)) {
          e.preventDefault();
          onPick(keyToCategory.get(e.key) ?? null);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={onClose}
      className="absolute left-1/2 top-full z-30 mt-1 w-44 -translate-x-1/2 rounded-md border border-line bg-surface py-1 shadow-lg outline-none"
    >
      {options.map((c, i) => (
        <button
          key={c ?? "clear"}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(c);
          }}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
            i === active ? "bg-page" : ""
          } ${c === null ? "border-t border-line/60 text-muted" : ""}`}
        >
          {c ? (
            <>
              <span
                className={`inline-flex h-4 w-5 items-center justify-center rounded-sm text-[10px] ${categoryCellClass(c)}`}
                aria-hidden
              >
                {CATEGORY_GLYPH[c]}
              </span>
              <span className="flex-1">{CATEGORY_LABEL[c]}</span>
              <kbd className="text-[10px] text-muted">{CATEGORY_KEY[c]}</kbd>
            </>
          ) : (
            <>
              <span className="inline-flex h-4 w-5 items-center justify-center" aria-hidden>
                ✕
              </span>
              <span className="flex-1">Очистить</span>
              <kbd className="text-[10px] text-muted">0</kbd>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

function gridColsSpan(gridCols: string): number {
  const m = gridCols.match(/repeat\((\d+),/);
  return m ? parseInt(m[1], 10) + 1 : 1;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}
