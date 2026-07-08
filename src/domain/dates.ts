/* ============================================
   Diamond Lineup - Date utilities

   All game dates are plain calendar dates stored as
   "YYYY-MM-DD" strings. They must always be interpreted
   in the coach's LOCAL timezone. Never pass these strings
   to `new Date(str)` directly: JS parses date-only strings
   as UTC midnight, which renders as the previous day in
   any timezone west of Greenwich (the "print date is one
   day off" bug), and `new Date().toISOString()` yields
   tomorrow's date during evening games.
   ============================================ */

/** Parse a YYYY-MM-DD string as a local-timezone Date at midnight. */
export function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Today's date as YYYY-MM-DD in the local timezone. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Human-friendly display, e.g. "7/6/2026" (locale-dependent). */
export function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  return parseLocalDate(isoDate).toLocaleDateString();
}

/** Long display, e.g. "Monday, July 6, 2026". */
export function formatDateLong(isoDate: string): string {
  if (!isoDate) return '';
  return parseLocalDate(isoDate).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/** Whole days from `fromISO` to `toISO` (positive if `toISO` is later). */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = parseLocalDate(fromISO);
  const to = parseLocalDate(toISO);
  // Round to absorb DST transitions (23h/25h days).
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Compare two YYYY-MM-DD strings for sorting (newest first with b,a order). */
export function compareDatesDesc(a: string, b: string): number {
  return b.localeCompare(a);
}
