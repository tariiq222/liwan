/**
 * A `date` column as `YYYY-MM-DD`. node-postgres builds a `date` as local midnight, so the calendar day is read from the local
 * fields: slicing `toISOString()` is a day early in every timezone ahead of UTC (the server may run in Asia/Riyadh).
 */
export function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
}
