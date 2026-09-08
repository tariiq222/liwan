/** Convert a datetime-local input (in the browser's local timezone) to the UTC wire format. */
export function toUtcDateTime(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/** Convert a UTC API instant to the local, minute-precision input value. */
export function fromUtcDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function formatLocalDateTime(value: string | null | undefined): string {
  const input = fromUtcDateTimeInput(value)
  return input ? input.replace('T', ' ') : ''
}
