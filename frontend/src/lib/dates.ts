export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
export const MONTHS_GEN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function mondayOf(d: Date): string {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - dow);
  return toISO(copy);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function currentMonday(): string {
  return mondayOf(new Date());
}

export function dayLabel(iso: string): string {
  const d = fromISO(iso);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

export function rangeLabel(fromIso: string, toIso: string): string {
  const a = fromISO(fromIso);
  const b = fromISO(toIso);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
}

export function isWeekendISO(iso: string): boolean {
  const dow = (fromISO(iso).getDay() + 6) % 7;
  return dow >= 5;
}

/** "31 Aug" — compact date for week headers. */
export function shortDate(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
