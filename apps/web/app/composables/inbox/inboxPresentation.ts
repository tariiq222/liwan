import type { InboxChannelState, InboxConversation, InboxConversationState, InboxDeliveryState, InboxMessageKind, InboxPriority } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const CONVERSATION_STATES: readonly InboxConversationState[] = ['open', 'pending', 'resolved', 'closed']
/** A new conversation is open; the list row names a state only when it differs from this one. */
export const DEFAULT_CONVERSATION_STATE: InboxConversationState = 'open'
export const PRIORITIES: readonly InboxPriority[] = ['low', 'normal', 'high', 'urgent']

/** The priority badge of a list row; a normal priority is the default and shows nothing. */
export const INBOX_PRIORITY_TONE: Partial<Record<InboxPriority, StatusTone>> = { low: 'neutral', high: 'warning', urgent: 'destructive' }

/** The locale key naming the file of a message without a caption (a list row shows it instead of text); null for plain text. */
export function inboxFileKindKey(kind: InboxMessageKind | null): string | null {
  return kind && kind !== 'text' ? `inbox.kinds.${kind}` : null
}

export const CONVERSATION_STATE_TONE: Record<InboxConversationState, StatusTone> = {
  open: 'info', pending: 'warning', resolved: 'success', closed: 'neutral',
}
/** The customer's answer to the satisfaction survey. */
export type CsatScore = NonNullable<InboxConversation['csat']>['score']
export const CSAT_SCORES: readonly CsatScore[] = ['good', 'neutral', 'bad']
export const CSAT_TONE: Record<CsatScore, StatusTone> = { good: 'success', neutral: 'warning', bad: 'destructive' }
export const CHANNEL_STATE_TONE: Record<InboxChannelState, StatusTone> = {
  draft: 'neutral', connected: 'success', error: 'destructive', disabled: 'neutral',
}
export const DELIVERY_ICON: Record<InboxDeliveryState, string> = {
  received: 'i-lucide-check', queued: 'i-lucide-clock', sent: 'i-lucide-check', delivered: 'i-lucide-check-check', read: 'i-lucide-check-check', failed: 'i-lucide-circle-alert',
}

/** The time a list row shows: the clock time for today, the short date for an earlier day. */
export function inboxListTime(value: string | null, locale: string, now: Date = new Date()): string {
  if (!value) return ''
  const date = new Date(value)
  const sameDay = date.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(date)
}

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/** How long ago a message arrived, as a short relative label in the locale: minutes under an hour, hours under a day, days after. */
export function inboxWaitingTime(value: string, locale: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / MINUTE_MS))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (minutes < MINUTES_PER_HOUR) return format.format(-minutes, 'minute')
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return format.format(-hours, 'hour')
  return format.format(-Math.floor(hours / HOURS_PER_DAY), 'day')
}

/** The full date and time of a message, for the hover title of a relative label. */
export function inboxAbsoluteTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/** The calendar day a message belongs to, for the day separators of the thread. */
export function inboxDayKey(value: string): string {
  return value.slice(0, 10)
}
