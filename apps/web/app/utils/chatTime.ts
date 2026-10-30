import { formatDate, formatTime } from '@liwan/ui/app/utils/formatDate'

const DAY_MS = 86_400_000
const WEEK_DAYS = 6

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * The last-message label of a conversation row: the time today, `yesterday` the day before, the weekday within the
 * last week, else the date. Returns '' for an empty or invalid value.
 */
export function chatListTime(value: string | null | undefined, opts: { now?: Date; locale: string; yesterday: string }): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const age = Math.round((dayStart(opts.now ?? new Date()) - dayStart(date)) / DAY_MS)
  if (age <= 0) return formatTime(date)
  if (age === 1) return opts.yesterday
  if (age <= WEEK_DAYS) return new Intl.DateTimeFormat(opts.locale, { weekday: 'long', calendar: 'gregory' }).format(date)
  return formatDate(date)
}
