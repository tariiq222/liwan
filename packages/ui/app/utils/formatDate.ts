// The single date, time and datetime format of the app:
//   date      dd/MM/yyyy
//   time      HH:mm (24-hour)
//   datetime  dd/MM/yyyy HH:mm
// Latin digits in every locale. The result is wrapped in a left-to-right
// isolate so the numeric run keeps its order inside right-to-left text.
// Use these helpers instead of toLocaleDateString / Intl.DateTimeFormat.

export type DateInput = string | number | Date | null | undefined

const LRI = '\u2066'
const PDI = '\u2069'
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Wrap text in a left-to-right isolate (digits and slashes keep their order in RTL text). */
export function isolateLtr(text: string): string {
  return text ? `${LRI}${text}${PDI}` : text
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let found = formatters.get(key)
  if (!found) {
    try {
      found = new Intl.DateTimeFormat('en-GB', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(timeZone ? { timeZone } : {}),
      })
    } catch {
      // A stale or unsupported time zone falls back to UTC, like the notification parser.
      found = formatter('UTC')
    }
    formatters.set(key, found)
  }
  return found
}

function parts(date: Date, timeZone?: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(date)) out[part.type] = part.value
  return out
}

function toDate(value: DateInput): Date | null {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function calendarDay(value: string): string {
  const match = ISO_DATE.exec(value)!
  const [, year, month, day] = match
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return ''
  return `${day}/${month}/${year}`
}

/** dd/MM/yyyy for a YYYY-MM-DD calendar day or an instant. Returns '' for an empty or invalid value. */
export function formatDate(value: DateInput, timeZone?: string): string {
  // A bare YYYY-MM-DD is a calendar day, not an instant: never shift it by the time zone.
  if (typeof value === 'string' && ISO_DATE.test(value)) return isolateLtr(calendarDay(value))
  const date = toDate(value)
  if (!date) return ''
  const p = parts(date, timeZone)
  return isolateLtr(`${p.day}/${p.month}/${p.year}`)
}

/** HH:mm (24-hour) for an instant. Returns '' for an empty or invalid value. */
export function formatTime(value: DateInput, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return ''
  const p = parts(date, timeZone)
  return isolateLtr(`${p.hour}:${p.minute}`)
}

/** dd/MM/yyyy HH:mm for an instant. Returns '' for an empty or invalid value. */
export function formatDateTime(value: DateInput, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return ''
  const p = parts(date, timeZone)
  return isolateLtr(`${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`)
}

/** A date (default now) as the `YYYY-MM-DD` day in the browser's own calendar; `toISOString` would give the UTC day. */
export function localIsoDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
