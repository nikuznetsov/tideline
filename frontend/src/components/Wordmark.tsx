/** Product wordmark: wave glyph + "Tideline". Used by the app header and public pages. */
export function Wordmark({ size = "sm" }: { size?: "sm" | "base" }) {
  const text = size === "sm" ? "text-sm" : "text-base";
  const glyph = size === "sm" ? 16 : 20;
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="64" height="64" rx="14" fill="var(--accent)" />
        <g fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round">
          <path d="M8 21 q6 -8 12 0 t12 0 t12 0 t12 0" />
          <path d="M8 34 q6 -8 12 0 t12 0 t12 0 t12 0" opacity="0.68" />
          <path d="M8 47 q6 -8 12 0 t12 0 t12 0 t12 0" opacity="0.4" />
        </g>
      </svg>
      <span className={`font-display ${text} font-bold tracking-tight text-ink`}>Tideline</span>
    </span>
  );
}
