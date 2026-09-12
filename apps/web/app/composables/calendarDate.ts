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

const BIDI = /[\u200e\u200f\u061c]/g

function formatInstant(value: string | number | Date | null | undefined, locale: string, options: Intl.DateTimeFormatOptions): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—'
  return new Intl.DateTimeFormat(locale, { calendar: 'gregory', ...options }).format(date).replace(BIDI, '')
}

export function formatNasqDate(value: string | number | Date | null | undefined, locale: string): string {
  return formatInstant(value, locale, { dateStyle: 'medium' })
}

export function formatNasqDateTime(value: string | number | Date | null | undefined, locale: string): string {
  return formatInstant(value, locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatNasqTime(value: string | number | Date | null | undefined, locale: string): string {
  return formatInstant(value, locale, { timeStyle: 'short' })
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * True when `value` is a YYYY-MM-DD string naming a real calendar day.
 * Rejects a well-formed but non-existent date such as `2030-02-30`, which
 * `new Date(...)` would silently roll forward into March.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
