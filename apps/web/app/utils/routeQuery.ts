/**
 * Route query values arrive as `string | string[] | undefined`. These two
 * helpers unwrap that shape the same way everywhere: `firstQuery` narrows to
 * a plain string (or `undefined` when the value is missing or not a
 * string), and `parseOffset` reads a non-negative integer pagination offset,
 * defaulting to `0` on anything invalid. `lastPageOffset` clamps a
 * past-the-end offset back to the last page for a list's page size.
 *
 * Shared across modules so route query values follow one parsing policy.
 */
export function firstQuery(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : undefined
}

export function parseOffset(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : 0
  if (!Number.isInteger(n) || n < 0) return 0
  return n
}

/** The offset of the last page that still has rows (0 for an empty list): where a past-the-end offset lands. */
export function lastPageOffset(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(total / pageSize) - 1) * pageSize
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The first non-empty string of a route query value, trimmed; null otherwise. */
export function queryText(value: unknown): string | null {
  const first = firstQuery(value)?.trim()
  return first || null
}

/** A `YYYY-MM-DD` day of a route query value, or null for anything else. */
export function queryDay(value: unknown): string | null {
  const parsed = queryText(value)
  return parsed && DAY.test(parsed) ? parsed : null
}

/** A positive integer of a route query value, or null for anything else. */
export function queryPositiveInt(value: unknown): number | null {
  const parsed = Number(queryText(value))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
