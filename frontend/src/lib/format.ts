export function fmtNum(v: string | number, digits = 2): string {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (Number.isNaN(n)) return "—";
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}

export function fmtLoad(v: string | number): string {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (n === 0) return "";
  if (n === 1) return "1";
  return fmtNum(n);
}

/** Russian-style plural picker (one / few / many); kept for compatibility. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}
