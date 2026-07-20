export const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
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
