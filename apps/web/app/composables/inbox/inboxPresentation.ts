import type { InboxChannelState, InboxConversation, InboxConversationState, InboxDeliveryState, InboxPriority } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

export const CONVERSATION_STATES: readonly InboxConversationState[] = ['open', 'pending', 'resolved', 'closed']
export const PRIORITIES: readonly InboxPriority[] = ['low', 'normal', 'high', 'urgent']

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

/** The calendar day a message belongs to, for the day separators of the thread. */
export function inboxDayKey(value: string): string {
  return value.slice(0, 10)
}
