import type { ScheduleMilestone, ScheduleTask } from '@nasq/contracts'
import { isCalendarDate } from '@nasq/ui/app/composables/calendarDate'

export type ScheduleScale = 'week' | 'month'
export type ScheduleAxis = {
  start: string
  end: string
  dates: string[]
  unitDays: number
  columnWidth: number
  totalDays: number
  width: number
}

const DAY = 86_400_000
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

export function daysBetween(start: string, end: string): number {
  return Math.round((dateToUtc(end) - dateToUtc(start)) / DAY)
}

export function formatScheduleDate(value: string, locale: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export function scheduleDatePosition(value: string, axis: Pick<ScheduleAxis, 'start' | 'end' | 'totalDays'>) {
  const total = Math.max(axis.totalDays || daysBetween(axis.start, axis.end), 1)
  const offset = Math.min(Math.max(daysBetween(axis.start, value), 0), total)
  return { insetInlineStart: `${(offset / total) * 100}%` }
}

export type ScheduleColumnSpan = { unit: ScheduleScale; count: number; form: Intl.LDMLPluralRule }

/** How many weeks or months one column covers, with the locale's plural form for its label. */
export function scheduleColumnSpan(axis: Pick<ScheduleAxis, 'unitDays'>, scale: ScheduleScale, locale: string): ScheduleColumnSpan {
  const count = Math.max(Math.round(axis.unitDays / (scale === 'month' ? 30 : 7)), 1)
  return { unit: scale, count, form: new Intl.PluralRules(locale).select(count) }
}

/** The date the timeline opens on: today while it is inside the axis, otherwise the start. */
export function scheduleFocusDate(axis: Pick<ScheduleAxis, 'start' | 'end'>, today: string): string {
  return today && today >= axis.start && today < axis.end ? today : axis.start
}

export function buildScheduleAxis(
  tasks: ScheduleTask[],
  milestones: ScheduleMilestone[],
  scale: ScheduleScale = 'week',
  project?: { start?: string | null; end?: string | null },
): ScheduleAxis {
  const dated = [
    ...tasks.flatMap(task => [task.start, task.end].filter((value): value is string => !!value)),
    ...milestones.flatMap(milestone => milestone.deadline ? [milestone.deadline] : []),
    project?.start,
    project?.end,
  ].filter((value): value is string => !!value).sort()
  const base = scale === 'month' ? 30 : 7
  const start = dated[0] ?? new Date().toISOString().slice(0, 10)
  const rawEnd = dated.at(-1) ?? addCalendarDays(start, scale === 'month' ? 90 : 42)
  const covered = Math.max(daysBetween(start, rawEnd) + 1, base)
  const unitDays = covered / base > 48 ? Math.ceil(covered / 48 / base) * base : base
  const columns = Math.max(Math.ceil(covered / unitDays), 1)
  const totalDays = columns * unitDays
  const end = addCalendarDays(start, totalDays)
  const columnWidth = scale === 'month' ? 120 : 100
  const dates = Array.from({ length: columns }, (_, index) => addCalendarDays(start, index * unitDays))
  return { start, end, dates, unitDays, columnWidth, totalDays, width: Math.min(6000, Math.max(720, columns * columnWidth)) }
}

export function scheduleBarStyle(task: Pick<ScheduleTask, 'start' | 'end'>, axis: ScheduleAxis) {
  if (!task.start || !task.end) return { display: 'none' }
  const total = Math.max(axis.totalDays || daysBetween(axis.start, axis.end), 1)
  const offset = Math.max(daysBetween(axis.start, task.start), 0)
  const duration = Math.max(daysBetween(task.start, task.end) + 1, 1)
  return { insetInlineStart: `${(offset / total) * 100}%`, width: `${Math.min((duration / total) * 100, 100)}%` }
}
