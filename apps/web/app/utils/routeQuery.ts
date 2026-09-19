/**
 * Route query values arrive as `string | string[] | undefined`. These two
 * helpers unwrap that shape the same way everywhere: `firstQuery` narrows to
 * a plain string (or `undefined` when the value is missing or not a
 * string), and `parseOffset` reads a non-negative integer pagination offset,
 * defaulting to `0` on anything invalid.
 *
 * Shared by every module: project finance, meeting filters, the legacy tab
 * redirect, admin settings paths and several pages each used to carry their
 * own copy of one or both.
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
