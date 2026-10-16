import { formatDate } from '@webvue/ui/app/utils/formatDate'

type TimelineTranslate = (key: string, params?: Record<string, unknown>) => string

const FIELD_LABELS: Record<string, string> = {
  name: 'tasks.columns.title',
  title: 'tasks.columns.title',
  date_deadline: 'tasks.columns.deadline',
  deadline: 'tasks.columns.deadline',
  state: 'tasks.columns.state',
  priority: 'tasks.columns.priority',
  stage_id: 'tasks.columns.stage',
  personal_stage_type_id: 'tasks.columns.stage',
  project_id: 'tasks.columns.project',
  user_ids: 'tasks.columns.assignees',
  allocated_hours: 'tasks.drawer.allocatedHours',
  description: 'tasks.drawer.description',
  active: 'tasks.activity.activeField',
  is_closed: 'tasks.filters.closed',
}

const BOOLEAN_FIELDS = new Set(['active', 'is_closed'])
const DATE_FIELDS = new Set(['date_deadline', 'deadline', 'date_start', 'date_end'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unset(t: TimelineTranslate): string {
  return t('tasks.activity.unset')
}

export function timelineFieldLabel(field: string, serverLabel: string, t: TimelineTranslate): string {
  const key = FIELD_LABELS[field]
  return key ? t(key) : (serverLabel || t('tasks.activity.unknownField'))
}

function formatTimelineDate(value: string, _locale: string, t: TimelineTranslate): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const year = Number(dateOnly[1]); const month = Number(dateOnly[2]); const day = Number(dateOnly[3])
    const check = new Date(Date.UTC(year, month - 1, day))
    if (month < 1 || month > 12 || day < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return t('tasks.activity.invalidValue')
  }
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(value)
  if (Number.isNaN(date.getTime())) return t('tasks.activity.invalidValue')
  return formatDate(dateOnly ? value : date, 'UTC')
}

function formatEnum(field: string, value: string, t: TimelineTranslate): string | null {
  if (field === 'state') {
    const state = ({
      '01_in_progress': 'in_progress',
      '02_changes_requested': 'changes_requested',
      '03_approved': 'approved',
      '04_waiting_normal': 'waiting',
      '1_done': 'done',
      '1_canceled': 'cancelled',
    } as Record<string, string>)[value] ?? value
    if (['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled'].includes(state)) return t(`tasks.state.${state}`)
  }
  if (field === 'priority') {
    const priority = ({ normal: '0', important: '1', high: '2', urgent: '3' } as Record<string, string>)[value] ?? value
    if (['0', '1', '2', '3'].includes(priority)) return t(`tasks.priority.${priority}`)
  }
  return null
}

function formatObject(value: Record<string, unknown>, t: TimelineTranslate): string {
  for (const key of ['name', 'display_name', 'title', 'label']) {
    if (typeof value[key] === 'string' && value[key]) return value[key]
  }
  if (typeof value.id === 'number' || typeof value.id === 'string') return String(value.id)
  try {
    return JSON.stringify(value)
  }
  catch {
    return t('tasks.activity.invalidValue')
  }
}

export function formatTimelineValue(field: string, value: unknown, locale: string, t: TimelineTranslate): string {
  if (value === null || value === undefined || value === '') return unset(t)
  if (typeof value === 'boolean') {
    if (!BOOLEAN_FIELDS.has(field)) return unset(t)
    return t(value ? 'tasks.activity.booleanTrue' : 'tasks.activity.booleanFalse')
  }
  if (DATE_FIELDS.has(field)) {
    if (typeof value !== 'string') return t('tasks.activity.invalidValue')
    return formatTimelineDate(value, locale, t)
  }
  if (typeof value === 'string') return formatEnum(field, value, t) ?? value
  if (typeof value === 'number') return formatEnum(field, String(value), t) ?? String(value)
  if (typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(item => formatTimelineValue(field, item, locale, t)).join(', ')
  if (isRecord(value)) return formatObject(value, t)
  return String(value)
}

export function formatTimelineChange(
  change: { field: string; label: string; old: unknown; new: unknown },
  locale: string,
  t: TimelineTranslate,
): string {
  const field = timelineFieldLabel(change.field, change.label, t)
  const hasValue = (value: unknown) => value !== null && value !== undefined && value !== '' && (value !== false || BOOLEAN_FIELDS.has(change.field))
  const hasNew = hasValue(change.new)
  const hasOld = hasValue(change.old)
  if (!hasNew) return t('tasks.activity.cleared', { field })
  const next = formatTimelineValue(change.field, change.new, locale, t)
  if (!hasOld) return t('tasks.activity.set', { field, new: next })
  const previous = formatTimelineValue(change.field, change.old, locale, t)
  return t('tasks.activity.changed', { field, old: previous, new: next })
}
