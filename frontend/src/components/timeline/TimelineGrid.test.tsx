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
      load: "0.5",
      is_sole_owner: false,
      note: null,
    },
  ],
  projects: [{ id: "p1", code: "TEST", name: "Тест", lifecycle: "active" }],
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

function renderGrid(setCells = vi.fn()) {
  render(
    <MemoryRouter>
      <TimelineGrid
        data={data}
        setCells={setCells}
        undo={() => {}}
        redo={() => {}}
        extraRows={{}}
        onAddRow={() => {}}
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
      { member_id: "m1", project_id: "p1", day: days[1], load: "1" },
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
      { member_id: "m1", project_id: "p1", day: days[0], load: null },
    ]);
  });

  it("открывает инлайн-редактор по цифре и сохраняет по Enter", () => {
    const setCells = renderGrid();
    fireEvent.click(screen.getByTitle("Развернуть по проектам"));
    const grid = screen.getByRole("grid");
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[2]);
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "3" });
    const input = screen.getByDisplayValue("3");
    fireEvent.change(input, { target: { value: "0.3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(setCells).toHaveBeenCalledWith([
      { member_id: "m1", project_id: "p1", day: days[2], load: "0.3" },
    ]);
  });
});
