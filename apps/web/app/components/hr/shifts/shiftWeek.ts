/** Calendar arithmetic for the weekly shift table, on ISO dates only (no time zone involved). */
const DAY_MS = 86_400_000
const WEEK_DAYS = 7
/** Saudi work weeks start on Sunday (JavaScript weekday 0). */
const WEEK_STARTS_ON = 0

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The first day of the week that contains `iso`. */
export function weekStartOf(iso: string): string {
  const date = toUtc(iso)
  const back = (date.getUTCDay() - WEEK_STARTS_ON + WEEK_DAYS) % WEEK_DAYS
  return toIso(new Date(date.getTime() - back * DAY_MS))
}

/** `weeks` whole weeks after (or before, when negative) the week starting `iso`. */
export function addWeeks(iso: string, weeks: number): string {
  return toIso(new Date(toUtc(iso).getTime() + weeks * WEEK_DAYS * DAY_MS))
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtc(value).getTime())
}
