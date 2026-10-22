/**
 * Parse a record id out of a route param or query value.
 *
 * Route values arrive as `string | string[] | undefined`, so an array takes its
 * first entry. Only a canonical positive integer is accepted: `'08'`, `'1e2'`,
 * `'3.2'`, `'0'` and `'-3'` are not ids a server route would have produced, and
 * silently coercing them makes two different URLs address the same record.
 *
 * Keep this parser shared and uniquely named so Nuxt auto-imports expose one
 * consistent validation policy to every module.
 */
export function parsePositiveId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}
