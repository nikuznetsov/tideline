import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import type { TimelineResponse } from "../../api/types";
import { TimelineGrid } from "./TimelineGrid";

// понедельник и вторник текущей недели
function monday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const mon = monday();
const days = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(mon);
  d.setDate(d.getDate() + i);
  return iso(d);
});

const member = {
  id: "m1",
  user_id: null,
  email: null,
  name: "Аня",
  role_title: null,
  capacity_per_day: "1",
  tags: [],
  sort_order: 0,
  is_active: true,
};

const data: TimelineResponse = {
  date_from: days[0],
  date_to: days[13],
  members: [
    {
      member,
      days: days.map((day, i) => ({
        day,
        capacity: i % 7 < 5 ? "1" : "0",
        allocated: "0",
        free: i % 7 < 5 ? "1" : "0",
        is_working: i % 7 < 5,
        is_absent: false,
      })),
      total_allocated: "0",
      total_free: "10",
    },
  ],
  allocations: [
    {
      id: "a1",
      member_id: "m1",
      project_id: "p1",
      day: days[0],
      category: "half",
      note: null,
    },
  ],
  projects: [
    { id: "p1", code: "TEST", name: "Тест", lifecycle: "active" },
    { id: "p2", code: "EXTRA", name: "Пустой", lifecycle: "active" },
  ],
  absences: [],
  non_working_days: [],
  day_totals: days.map((day, i) => ({
    day,
    free: i % 7 < 5 ? "1" : "0",
    capacity: i % 7 < 5 ? "1" : "0",
    allocated: "0",
    is_working: i % 7 < 5,
  })),
  weeks: [
    { week_start: days[0], is_closed: false, is_current: true, is_past: false, free_total: "5" },
    { week_start: days[7], is_closed: false, is_current: false, is_past: false, free_total: "5" },
  ],
  utilization_pct: 0,
  week_close_reminder: null,
};

function renderGrid(
  setCells = vi.fn(),
  opts: {
    extraRows?: Record<string, string[]>;
    onRemoveRow?: (memberId: string, projectId: string) => void;
  } = {},
) {
  render(
    <MemoryRouter>
      <TimelineGrid
        data={data}
        setCells={setCells}
        undo={() => {}}
        redo={() => {}}
        extraRows={opts.extraRows ?? {}}
        onAddRow={() => {}}
        onRemoveRow={opts.onRemoveRow}
      />
    </MemoryRouter>,
  );
  return setCells;
}

describe("TimelineGrid", () => {
  it("разворачивает сотрудника и ставит 1.0 быстрой клавишей", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    expect(screen.getByText("TEST")).toBeTruthy();

    const grid = screen.getByRole("grid");
    const cells = screen.getAllByRole("gridcell");
    expect(cells.length).toBe(10); // 2 недели без выходных

    fireEvent.mouseDown(cells[1]); // вторник
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "1" });

    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[1], category: "full" },
    ]);
  });

  it("очищает ячейку клавишей 0", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    const grid = screen.getByRole("grid");
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[0]);
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "0" });
    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[0], category: null },
    ]);
  });

  it("открывает пикер по Enter и ставит категорию кликом", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    const grid = screen.getByRole("grid");
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[2]);
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "Enter" });
    const picker = screen.getByRole("listbox");
    expect(picker).toBeTruthy();
    fireEvent.mouseDown(screen.getByText("Наполовину"));
    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[2], category: "half" },
    ]);
  });

  it("цифра без категории ничего не делает", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    const grid = screen.getByRole("grid");
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[2]);
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "3" });
    expect(setCells).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("крестик у строки с загрузкой: подтверждение снимает ячейки и убирает строку", () => {
    const onRemoveRow = vi.fn();
    const setCells = renderGrid(vi.fn(), { onRemoveRow });
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    fireEvent.click(screen.getByLabelText("Убрать строку TEST"));
    // строка с загрузкой — сначала подтверждение
    expect(setCells).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Снять и убрать"));
    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[0], category: null },
    ]);
    expect(onRemoveRow).toHaveBeenCalledWith("m1", "p1");
  });

  it("пустая строка убирается сразу, без подтверждения", () => {
    const onRemoveRow = vi.fn();
    const setCells = renderGrid(vi.fn(), {
      extraRows: { m1: ["p2"] },
      onRemoveRow,
    });
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    fireEvent.click(screen.getByLabelText("Убрать строку EXTRA"));
    expect(screen.queryByText("Снять и убрать")).toBeNull();
    expect(setCells).not.toHaveBeenCalled();
    expect(onRemoveRow).toHaveBeenCalledWith("m1", "p2");
  });

  it("drag-fill копирует категорию исходной ячейки", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    const cells = screen.getAllByRole("gridcell");
    // ячейка понедельника заполнена ("half") — фокусируем, тянем маркер до среды
    fireEvent.mouseDown(cells[0]);
    fireEvent.mouseUp(window);
    const handle = screen.getByTitle("Потянуть, чтобы растянуть значение по дням");
    fireEvent.mouseDown(handle);
    fireEvent.mouseEnter(cells[1]);
    fireEvent.mouseEnter(cells[2]);
    fireEvent.mouseUp(window);
    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[1], category: "half" },
      { member_id: "m1", project_id: "p1", day: days[2], category: "half" },
    ]);
  });
});
