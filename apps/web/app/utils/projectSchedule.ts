import type { ScheduleMilestone, ScheduleTask } from '@liwan/contracts'
import { isCalendarDate } from '@liwan/ui/app/composables/calendarDate'

export type ScheduleScale = 'week' | 'month'
export type ScheduleAxis = {
  start: string
  end: string
  dates: string[]
  unitDays: number
  columnWidth: number
  totalDays: number
  width: number
  /** Month scale only: the first day of every column plus the first day after the last one (columns + 1 dates). */
  bounds?: string[]
}

const DAY = 86_400_000
/** A month's nominal length in days: only for the grouped-column wording, never for placing a date. */
export const MONTH_DAYS = 30
const MAX_COLUMNS = 48
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/


export function dateToUtc(value: string): number {
  if (!isCalendarDate(value)) throw new Error('Invalid calendar date')
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function addCalendarDays(value: string, days: number): string {
  const result = new Date(dateToUtc(value) + days * DAY)
  return result.toISOString().slice(0, 10)
}

const firstOfMonth = (value: string) => `${value.slice(0, 7)}-01`
const monthNumber = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1

/** The first day of the month `months` after the month of `value`. */
export function addCalendarMonths(value: string, months: number): string {
  const index = monthNumber(value) + months
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

export function daysBetween(start: string, end: string): number {
  return Math.round((dateToUtc(end) - dateToUtc(start)) / DAY)
}

export function formatScheduleDate(value: string, locale: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/** Where a date falls on a calendar-month axis, 0 to 1: columns have equal width, a date sits inside its own month's column. */
function boundsFraction(value: string, bounds: string[]): number {
  const columns = bounds.length - 1
  if (value <= bounds[0]!) return 0
  if (value >= bounds[columns]!) return 1
  const index = bounds.findIndex((bound, i) => i < columns && value < bounds[i + 1]!)
  const from = bounds[index]!
  return (index + daysBetween(from, value) / daysBetween(from, bounds[index + 1]!)) / columns
}

export function scheduleDatePosition(value: string, axis: Pick<ScheduleAxis, 'start' | 'end' | 'totalDays' | 'bounds'>) {
  if (axis.bounds) return { insetInlineStart: `${boundsFraction(value, axis.bounds) * 100}%` }
  const total = Math.max(axis.totalDays || daysBetween(axis.start, axis.end), 1)
  const offset = Math.min(Math.max(daysBetween(axis.start, value), 0), total)
  return { insetInlineStart: `${(offset / total) * 100}%` }
}

export type ScheduleColumnSpan = { unit: ScheduleScale; count: number; form: Intl.LDMLPluralRule }

/** How many weeks or months one column covers, with the locale's plural form for its label. */
export function scheduleColumnSpan(axis: Pick<ScheduleAxis, 'unitDays'>, scale: ScheduleScale, locale: string): ScheduleColumnSpan {
  const count = Math.max(Math.round(axis.unitDays / (scale === 'month' ? MONTH_DAYS : 7)), 1)
  return { unit: scale, count, form: new Intl.PluralRules(locale).select(count) }
}

/** The date the timeline opens on: today while it is inside the axis, otherwise the start. */
export function scheduleFocusDate(axis: Pick<ScheduleAxis, 'start' | 'end'>, today: string): string {
  return today && today >= axis.start && today < axis.end ? today : axis.start
}

/** Calendar months: every column starts on the 1st. A very long project groups several months per column. */
function buildMonthAxis(dated: string[]): ScheduleAxis {
  const start = firstOfMonth(dated[0] ?? new Date().toISOString().slice(0, 10))
  const lastMonth = monthNumber(dated.at(-1) ?? addCalendarMonths(start, 2))
  const covered = Math.max(lastMonth - monthNumber(start) + 1, 1)
  const unitMonths = Math.ceil(covered / MAX_COLUMNS)
  const columns = Math.ceil(covered / unitMonths)
  const bounds = Array.from({ length: columns + 1 }, (_, index) => addCalendarMonths(start, index * unitMonths))
  const end = bounds[columns]!
  const columnWidth = 120
  return {
    start, end, dates: bounds.slice(0, columns), bounds, unitDays: unitMonths * MONTH_DAYS, columnWidth,
    totalDays: daysBetween(start, end), width: Math.min(6000, Math.max(720, columns * columnWidth)),
  }
}

export function buildScheduleAxis(
  tasks: ScheduleTask[],
  milestones: ScheduleMilestone[],
  scale: ScheduleScale = 'week',
  project?: { start?: string | null; end?: string | null },
  /** Further dates the axis must cover, such as the planned dates of a baseline drawn under the live bars. */
  extraDates: readonly string[] = [],
): ScheduleAxis {
  const dated = [
    ...tasks.flatMap(task => [task.start, task.end].filter((value): value is string => !!value)),
    ...milestones.flatMap(milestone => milestone.deadline ? [milestone.deadline] : []),
    project?.start,
    project?.end,
    ...extraDates,
  ].filter((value): value is string => !!value).sort()
  if (scale === 'month') return buildMonthAxis(dated)
  const base = 7
  const start = dated[0] ?? new Date().toISOString().slice(0, 10)
  const rawEnd = dated.at(-1) ?? addCalendarDays(start, 42)
  const covered = Math.max(daysBetween(start, rawEnd) + 1, base)
  const unitDays = covered / base > MAX_COLUMNS ? Math.ceil(covered / MAX_COLUMNS / base) * base : base
  const columns = Math.max(Math.ceil(covered / unitDays), 1)
  const totalDays = columns * unitDays
  const end = addCalendarDays(start, totalDays)
  const columnWidth = 100
  const dates = Array.from({ length: columns }, (_, index) => addCalendarDays(start, index * unitDays))
  return { start, end, dates, unitDays, columnWidth, totalDays, width: Math.min(6000, Math.max(720, columns * columnWidth)) }
}

/** The last day a column covers: the day before the next column starts (a calendar month ends on its own last day). */
export function scheduleColumnLastDay(axis: Pick<ScheduleAxis, 'dates' | 'bounds' | 'unitDays'>, index: number): string {
  const next = axis.bounds?.[index + 1]
  return next ? addCalendarDays(next, -1) : addCalendarDays(axis.dates[index]!, axis.unitDays - 1)
}

export function scheduleBarStyle(task: Pick<ScheduleTask, 'start' | 'end'>, axis: ScheduleAxis) {
  if (!task.start || !task.end) return { display: 'none' }
  if (axis.bounds) {
    const from = boundsFraction(task.start, axis.bounds)
    const to = boundsFraction(addCalendarDays(task.end, 1), axis.bounds)
    return { insetInlineStart: `${from * 100}%`, width: `${Math.max(to - from, 0) * 100}%` }
  }
  const total = Math.max(axis.totalDays || daysBetween(axis.start, axis.end), 1)
  const offset = Math.max(daysBetween(axis.start, task.start), 0)
  const duration = Math.max(daysBetween(task.start, task.end) + 1, 1)
  return { insetInlineStart: `${(offset / total) * 100}%`, width: `${Math.min((duration / total) * 100, 100)}%` }
}
