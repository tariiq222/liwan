import { MeetingNotificationSchema, NotificationKindSchema, TaskNotificationKindSchema, type NotificationKind } from '@nasq/contracts'

/** Today's kinds keep their literal type; a newer application's kind is any other string. */
export type NotificationPreviewKind = NotificationKind | (string & {})

const KNOWN_KINDS: ReadonlySet<string> = new Set(NotificationKindSchema.options)
const MEETING_KINDS: ReadonlySet<string> = new Set(MeetingNotificationSchema.shape.kind.options)
const TASK_KINDS: ReadonlySet<string> = new Set(TaskNotificationKindSchema.options)

export function isKnownNotificationKind(kind: string): boolean {
  return KNOWN_KINDS.has(kind)
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
  locale: string,
  timeZone = 'UTC',
): { datetime: string; label: string } | null {
  const date = parseNotificationDate(value)
  if (!date) return null

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      timeZone,
    })
  } catch {
    // Keep formatting deterministic when a stale or unsupported user timezone
    // reaches the client. UTC is also the parser's explicit fallback.
    try {
      formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        calendar: 'gregory',
        timeZone: 'UTC',
      })
    } catch {
      formatter = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        calendar: 'gregory',
        timeZone: 'UTC',
      })
    }
  }

  return { datetime: date.toISOString(), label: formatter.format(date) }
}

export function notificationPreviewCaptionKey(kind: NotificationPreviewKind): string {
  if (kind === 'overdue_digest') return 'tasks.digest.kind'
  if (MEETING_KINDS.has(kind)) return `meetingsUi.notify.${kind}`
  if (TASK_KINDS.has(kind)) return `notifications.preview.${kind}`
  return 'notifications.preview.other'
}

/** Title and secondary line of a newer application's row: both set shows both; neither shows the generic caption. */
export function genericNotificationText(item: { title?: string | null; body?: string | null }, caption: string): { title: string; secondary: string } {
  const title = item.title || item.body || caption
  return { title, secondary: item.title && item.body ? item.body : '' }
}
