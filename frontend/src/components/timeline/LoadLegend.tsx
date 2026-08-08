import {
  CATEGORY_GLYPH,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryCellClass,
} from "../../lib/categories";

/** Легенда категорий загрузки + обозначение перегруза. */
export function LoadLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
      {CATEGORY_ORDER.map((c) => (
        <span key={c} className="inline-flex items-center gap-1">
          <span
            className={`inline-flex h-4 w-5 items-center justify-center rounded-sm text-[10px] ${categoryCellClass(c)}`}
            aria-hidden
          >
            {CATEGORY_GLYPH[c]}
          </span>
          {CATEGORY_LABEL[c]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-flex h-4 w-5 items-center justify-center rounded-sm bg-[var(--load-over-bg)] text-[10px] text-[var(--load-over-ink)]"
          style={{ backgroundImage: "var(--cell-over-hatch)" }}
          aria-hidden
        >
          ⚠
        </span>
        Перегруз
      </span>
    </div>
  );
}
