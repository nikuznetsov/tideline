/** Project health light (green / amber / red) as a CSS dot — no emoji font dependency. */
const COLOR: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-rose-500",
};
const LABEL: Record<string, string> = {
  green: "on track",
  amber: "needs attention",
  red: "problems",
};

export function HealthDot({ health, className = "" }: { health: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Health: ${LABEL[health] ?? health}`}
      title={LABEL[health] ?? health}
      className={`inline-block h-2.5 w-2.5 rounded-full align-middle ${COLOR[health] ?? "bg-muted"} ${className}`}
    />
  );
}
