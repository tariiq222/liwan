import type { ScheduleMilestone, ScheduleTask } from '@nasq/contracts'

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

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function dateToUtc(value: string): number {
  if (!isCalendarDate(value)) throw new Error('Invalid calendar date')
  const [year, month, day] = value.split('-').map(Number)
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

function datesInRange(start: string, end: string, step: number): string[] {
  const span = Math.max(daysBetween(start, end), 0)
  const boundedStep = Math.max(step, Math.ceil(span / 364 / step) * step)
  const dates: string[] = []
  for (let offset = 0; offset <= span; offset += boundedStep) dates.push(addCalendarDays(start, offset))
  if (dates.at(-1) !== end) dates.push(end)
  return dates
}

export function buildScheduleAxis(tasks: ScheduleTask[], milestones: ScheduleMilestone[], scale: ScheduleScale = 'week'): ScheduleAxis {
  const dated = [
    ...tasks.flatMap(task => [task.start, task.end].filter((value): value is string => !!value)),
    ...milestones.flatMap(milestone => milestone.deadline ? [milestone.deadline] : []),
  ].sort()
  const rawStart = dated[0] ?? new Date().toISOString().slice(0, 10)
  const rawEnd = dated.at(-1) ?? addCalendarDays(rawStart, scale === 'month' ? 90 : 28)
  const unitDays = scale === 'month' ? 30 : 7
  const start = addCalendarDays(rawStart, -unitDays)
  const end = addCalendarDays(rawEnd, unitDays)
  const totalDays = Math.max(daysBetween(start, end), 1)
  const columnWidth = scale === 'month' ? 120 : 100
  const width = Math.min(6000, Math.max(720, (totalDays / unitDays) * columnWidth))
  return { start, end, dates: datesInRange(start, end, unitDays), unitDays, columnWidth, totalDays, width }
}

export function scheduleBarStyle(task: Pick<ScheduleTask, 'start' | 'end'>, axis: ScheduleAxis) {
  if (!task.start || !task.end) return { display: 'none' }
  const total = Math.max(axis.totalDays || daysBetween(axis.start, axis.end), 1)
  const offset = Math.max(daysBetween(axis.start, task.start), 0)
  const duration = Math.max(daysBetween(task.start, task.end) + 1, 1)
  return { insetInlineStart: `${(offset / total) * 100}%`, width: `${Math.min((duration / total) * 100, 100)}%` }
}
