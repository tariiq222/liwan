export type RecurrenceEndMode = 'count' | 'date'

export function normalizeRecurrenceEnd(input: {
  mode: RecurrenceEndMode
  count: string
  date: string
}): { until_count: number | undefined; until_date: string | undefined } {
  if (input.mode === 'count') {
    const count = Number(input.count)
    return { until_count: Number.isInteger(count) && count >= 1 && count <= 60 ? count : undefined, until_date: undefined }
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : undefined
  return { until_count: undefined, until_date: validDate }
}
