import type { AttentionItem, AttentionKind } from '@webvue/commercial-contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

/** One count of the overview status strip; `to` opens the list it counts. */
export type StatusStat = { id: string, label: string, value: number, to?: string }
export type AttentionLink = { path: string, query?: Record<string, string> }
export type AttentionPresentation = { to: AttentionLink | null, tone: StatusTone, icon: `i-lucide-${string}`, actionKey: string }

const DAY_MS = 86_400_000
const customerTab = (item: AttentionItem, tab: string): AttentionLink | null =>
  item.customer_id ? { path: `/customers/${item.customer_id}`, query: { tab } } : null

/** Whole days between `since` and `now`; negative when `since` is ahead (a renewal still to come). */
export function daysBetween(since: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(since)) / DAY_MS)
}

// The server dates renewals in the business zone (Asia/Riyadh, UTC+3 all year), so days are counted on that calendar.
const BUSINESS_UTC_OFFSET_MS = 3 * 3_600_000
const businessDay = (instant: number) => Math.floor((instant + BUSINESS_UTC_OFFSET_MS) / DAY_MS)

/** Calendar days until a renewal (0 on the day itself, or after it). */
export const daysUntil = (since: string, now: Date) => Math.max(0, businessDay(Date.parse(since)) - businessDay(now.getTime()))

/** Calendar days since a renewal date passed (0 on the day itself). */
export const daysSinceRenewal = (since: string, now: Date) => Math.max(0, businessDay(now.getTime()) - businessDay(Date.parse(since)))

/** The precise page each kind of item is resolved on. */
export function attentionPresentation(item: AttentionItem): AttentionPresentation {
  const action = (kind: AttentionKind) => `vendor.today.actions.${kind}`
  switch (item.kind) {
    case 'past_due':
      return { to: item.invoice_id ? { path: `/invoices/${item.invoice_id}` } : customerTab(item, 'invoices'), tone: 'destructive', icon: 'i-lucide-alarm-clock', actionKey: action(item.kind) }
    case 'stalled_activation':
      return { to: customerTab(item, 'workspace'), tone: 'destructive', icon: 'i-lucide-hourglass', actionKey: action(item.kind) }
    case 'operation_failed':
      return { to: item.operation_id ? { path: `/operations/${item.operation_id}`, query: { source: 'legacy', returnTo: '/overview' } } : null, tone: 'destructive', icon: 'i-lucide-circle-alert', actionKey: action(item.kind) }
    case 'setup_required':
      return { to: customerTab(item, 'subscription'), tone: 'warning', icon: 'i-lucide-wrench', actionKey: action(item.kind) }
    case 'renewal_missed':
      return { to: customerTab(item, 'subscription'), tone: 'warning', icon: 'i-lucide-calendar-x', actionKey: action(item.kind) }
    case 'renewal_soon':
      return { to: customerTab(item, 'subscription'), tone: 'info', icon: 'i-lucide-calendar-clock', actionKey: action(item.kind) }
  }
}

const FAILED_FULFILLMENT = ['failed', 'needs_intervention']

/** The sentence key and its day count for one item; the page translates it. */
export function attentionMessage(item: AttentionItem, now: Date): { key: string, days: number | null, operation: string | null } {
  switch (item.kind) {
    case 'past_due': return { key: 'past_due', days: Math.max(0, daysBetween(item.since, now)), operation: null }
    case 'stalled_activation':
      return FAILED_FULFILLMENT.includes(item.detail ?? '')
        ? { key: 'stalled_failed', days: null, operation: null }
        : { key: 'stalled_waiting', days: Math.max(0, daysBetween(item.since, now)), operation: null }
    case 'operation_failed': return { key: 'operation_failed', days: null, operation: item.detail }
    case 'setup_required': return { key: 'setup_required', days: null, operation: null }
    case 'renewal_missed': return { key: 'renewal_missed', days: daysSinceRenewal(item.since, now), operation: null }
    case 'renewal_soon': return { key: 'renewal_soon', days: daysUntil(item.since, now), operation: null }
  }
}
