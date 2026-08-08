/** Категории загрузки: зеркало backend/app/domain/categories.py.
 * Пользователь видит только категории; веса — для оптимистичных агрегатов,
 * сервер остаётся источником истины. */

export type LoadCategory = "background" | "half" | "most" | "full";

export const CATEGORY_ORDER: LoadCategory[] = ["background", "half", "most", "full"];

export const CATEGORY_WEIGHT: Record<LoadCategory, number> = {
  background: 0.25,
  half: 0.5,
  most: 0.75,
  full: 1,
};

export const CATEGORY_LABEL: Record<LoadCategory, string> = {
  background: "Фоново",
  half: "Наполовину",
  most: "Почти весь день",
  full: "Весь день",
};

export const CATEGORY_GLYPH: Record<LoadCategory, string> = {
  background: "▂",
  half: "▄",
  most: "▆",
  full: "█",
};

/** Быстрая клавиша категории — мышечная память старых числовых значений. */
export const CATEGORY_KEY: Record<LoadCategory, string> = {
  background: "2",
  half: "5",
  most: "7",
  full: "1",
};

export function categoryWeight(c: LoadCategory | null | undefined): number {
  return c ? CATEGORY_WEIGHT[c] : 0;
}

/* классы — полными литералами: Tailwind не видит собранные в рантайме строки */
const CELL_CLASS: Record<LoadCategory, string> = {
  background:
    "bg-[var(--load-cat-background-bg)] text-[var(--load-cat-background-ink)]",
  half: "bg-[var(--load-cat-half-bg)] text-[var(--load-cat-half-ink)]",
  most: "bg-[var(--load-cat-most-bg)] text-[var(--load-cat-most-ink)]",
  full: "bg-[var(--load-cat-full-bg)] text-[var(--load-cat-full-ink)] font-medium",
};

/** Класс ячейки проекта: своя ступень интенсивности на каждую категорию. */
export function categoryCellClass(c: LoadCategory): string {
  return CELL_CLASS[c];
}

/** Сводная ячейка «сумма весов vs ёмкость» — общая для TimelineGrid и SharePage. */
export function summaryLoadClass(
  allocated: number,
  capacity: number,
): { className: string; over: boolean } {
  if (allocated === 0) return { className: "", over: false };
  if (capacity > 0 && allocated > capacity)
    return {
      className: "bg-[var(--load-over-bg)] text-[var(--load-over-ink)] font-bold",
      over: true,
    };
  if (capacity > 0 && allocated >= capacity)
    return {
      className: "bg-[var(--load-full-bg)] text-[var(--load-full-ink)] font-medium",
      over: false,
    };
  return {
    className: "bg-[var(--load-partial-bg)] text-[var(--load-partial-ink)]",
    over: false,
  };
}
