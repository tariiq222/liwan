import { MeetingNotificationSchema, NotificationKindSchema, ProjectNotificationKindSchema, TaskNotificationKindSchema, type NotificationKind } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'

/** Today's kinds keep their literal type; a newer application's kind is any other string. */
export type NotificationPreviewKind = NotificationKind | (string & {})

const KNOWN_KINDS: ReadonlySet<string> = new Set(NotificationKindSchema.options)
const MEETING_KINDS: ReadonlySet<string> = new Set(MeetingNotificationSchema.shape.kind.options)
const TASK_KINDS: ReadonlySet<string> = new Set(TaskNotificationKindSchema.options)
const PROJECT_KINDS: ReadonlySet<string> = new Set(ProjectNotificationKindSchema.options)

export function isKnownNotificationKind(kind: string): boolean {
  return KNOWN_KINDS.has(kind)
}

export function isProjectNotificationKind(kind: string): boolean {
  return PROJECT_KINDS.has(kind)
}

/** Kinds whose server body is text a person wrote; every other body is server wording and is not shown. */
export function isUserWrittenNotificationKind(kind: string): boolean {
  return kind === 'comment' || kind === 'mention'
}

export function isMeetingNotificationKind(kind: string): boolean {
  return MEETING_KINDS.has(kind)
}

const notificationDatePattern = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)$/i

function hasValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= lastDay
}

export function parseNotificationDate(value: string | null | undefined): Date | null {
  if (!value || typeof value !== 'string') return null
  const input = value.trim()
  const match = notificationDatePattern.exec(input)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!hasValidCalendarDate(year, month, day)) return null

  const normalized = input.replace(' ', 'T')
  const hasTime = normalized.includes('T')
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const date = new Date(hasTime ? (hasTimeZone ? normalized : `${normalized}Z`) : `${normalized}T00:00:00Z`)
  return Number.isNaN(date.valueOf()) ? null : date
}

export function formatNotificationTimestamp(
  value: string | null | undefined,
  _locale: string,
  timeZone = 'UTC',
): { datetime: string; label: string } | null {
  const date = parseNotificationDate(value)
  if (!date) return null

  return { datetime: date.toISOString(), label: formatDateTime(date, timeZone) }
}

export function notificationPreviewCaptionKey(kind: NotificationPreviewKind): string {
  if (kind === 'overdue_digest') return 'tasks.digest.kind'
  if (MEETING_KINDS.has(kind)) return `meetingsUi.notify.${kind}`
  if (TASK_KINDS.has(kind) || PROJECT_KINDS.has(kind)) return `notifications.preview.${kind}`
  return 'notifications.preview.other'
}

/** Title and secondary line of a newer application's row: both set shows both; neither leaves the title empty so only the caption shows. */
export function genericNotificationText(item: { title?: string | null; body?: string | null }): { title: string; secondary: string } {
  const title = item.title || item.body || ''
  return { title, secondary: item.title && item.body ? item.body : '' }
}
