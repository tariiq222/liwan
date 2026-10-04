import { CommercialError } from './types.js'
import type { Cadence } from './types.js'

const bad = () => new CommercialError('invalid_billing_period')
const DAY_MS = 86_400_000

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).filter(k => obj[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

function parse(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw bad()
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw bad()
  return [y, mo, d]
}
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const epochDay = (date: string): number => { const [y, m, d] = parse(date); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS) }

/** Calendar day (YYYY-MM-DD) in Asia/Riyadh (UTC+3, no DST) for an instant. */
export function riyadhDate(instant: string | Date): string {
  const t = (instant instanceof Date ? instant : new Date(instant)).getTime()
  if (!Number.isFinite(t)) throw bad()
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number { return epochDay(to) - epochDay(from) }
/** Activation day counted, renewal (period end) day not. */
export function remainingDays(activation: string, periodEnd: string): number {
  const n = daysBetween(activation, periodEnd)
  if (n < 0) throw bad()
  return n
}

function cadenceMonths(c: Cadence): number {
  if (!Number.isInteger(c.count) || c.count < 1 || (c.unit !== 'month' && c.unit !== 'year')) throw bad()
  return c.unit === 'year' ? c.count * 12 : c.count
}
/** anchor + periods*cadence, clamped to month end but always derived from the anchor day. */
export function addCadence(anchor: string, cadence: Cadence, periods: number): string {
  if (!Number.isSafeInteger(periods) || periods < 0) throw bad()
  const [y, m, d] = parse(anchor)
  const total = (y * 12 + (m - 1)) + cadenceMonths(cadence) * periods
  const ny = Math.floor(total / 12), nm = (total % 12) + 1
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
/** Billing period containing `at` for subscriptions anchored at `anchor`. */
export function periodBounds(anchor: string, cadence: Cadence, at: string): { start: string; end: string } {
  if (at < anchor) throw bad()
  parse(at)
  let k = Math.max(0, Math.floor(((Number(at.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12) / cadenceMonths(cadence)) - 1)
  while (addCadence(anchor, cadence, k + 1) <= at) k++
  return { start: addCadence(anchor, cadence, k), end: addCadence(anchor, cadence, k + 1) }
}
