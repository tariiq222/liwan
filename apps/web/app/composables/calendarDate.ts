import { CalendarDate, parseDate } from '@internationalized/date'

// Calendar dates (project start/end, milestone deadline) are YYYY-MM-DD
// strings on the wire — not instants, unlike task deadlines. Never go through
// `new Date(...)`: that parses as UTC midnight and shifts the day in any
// timezone west of Greenwich.
export function toCalendarDate(iso: string | null): CalendarDate | undefined {
  if (!iso) return undefined
  try {
    return parseDate(iso.slice(0, 10))
  } catch {
    return undefined
  }
}

export function fromCalendarDate(d: CalendarDate | undefined): string | null {
  return d ? d.toString() : null
}

export function formatCalendarDate(iso: string | null, locale: string): string {
  const d = toCalendarDate(iso)
  if (!d) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', calendar: 'gregory', timeZone: 'UTC' }).format(
    new Date(Date.UTC(d.year, d.month - 1, d.day)),
  )
}
