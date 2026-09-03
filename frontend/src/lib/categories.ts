/** Load categories: mirror of backend/app/domain/categories.py.
 * The user only sees categories; weights are for optimistic aggregates,
 * the server remains the source of truth. */

export type LoadCategory = "background" | "half" | "most" | "full";

export const CATEGORY_ORDER: LoadCategory[] = ["background", "half", "most", "full"];

export const CATEGORY_WEIGHT: Record<LoadCategory, number> = {
  background: 0.25,
  half: 0.5,
  most: 0.75,
  full: 1,
};

export const CATEGORY_LABEL: Record<LoadCategory, string> = {
  background: "Background",
  half: "Half day",
  most: "Most of the day",
  full: "Full day",
};

export const CATEGORY_GLYPH: Record<LoadCategory, string> = {
  background: "▂",
  half: "▄",
  most: "▆",
  full: "█",
};

/** Category hotkey — muscle memory from the old numeric values. */
export const CATEGORY_KEY: Record<LoadCategory, string> = {
  background: "2",
  half: "5",
  most: "7",
  full: "1",
};

export function categoryWeight(c: LoadCategory | null | undefined): number {
  return c ? CATEGORY_WEIGHT[c] : 0;
}

/* classes as full literals: Tailwind cannot see strings assembled at runtime */
const CELL_CLASS: Record<LoadCategory, string> = {
  background:
    "bg-[var(--load-cat-background-bg)] text-[var(--load-cat-background-ink)]",
  half: "bg-[var(--load-cat-half-bg)] text-[var(--load-cat-half-ink)]",
  most: "bg-[var(--load-cat-most-bg)] text-[var(--load-cat-most-ink)]",
  full: "bg-[var(--load-cat-full-bg)] text-[var(--load-cat-full-ink)] font-medium",
};

/** Project cell class: its own intensity step per category. */
export function categoryCellClass(c: LoadCategory): string {
  return CELL_CLASS[c];
}

/** Summary cell “sum of weights vs. capacity” — shared by TimelineGrid and SharePage. */
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
