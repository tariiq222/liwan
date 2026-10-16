import { CalendarDate, parseDate } from '@internationalized/date'
import { formatDate, formatDateTime, formatTime } from '../utils/formatDate'

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

// All display formats live in utils/formatDate.ts (dd/MM/yyyy, HH:mm). The
// locale argument is kept for call-site compatibility; the format is the same
// in every locale.
export function formatCalendarDate(iso: string | null, _locale?: string): string {
  const d = toCalendarDate(iso)
  return d ? formatDate(iso!.slice(0, 10)) : ''
}

function orFallback(formatted: string, value: string | number | Date | null | undefined): string {
  if (formatted) return formatted
  return typeof value === 'string' && value !== '' ? value : '—'
}

export function formatNasqDate(value: string | number | Date | null | undefined, _locale?: string): string {
  return orFallback(formatDate(value), value)
}

export function formatNasqDateTime(value: string | number | Date | null | undefined, _locale?: string): string {
  return orFallback(formatDateTime(value), value)
}

export function formatNasqTime(value: string | number | Date | null | undefined, _locale?: string): string {
  return orFallback(formatTime(value), value)
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
