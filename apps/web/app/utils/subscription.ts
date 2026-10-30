import { daysBetween, riyadhDate, type Invoice, type Money, type Order, type Quote, type SubscriptionDisplayState, type UsageMetric, type UsageSnapshot } from '@liwan/commercial-contracts'

import { invoiceLineQuantities, type InvoiceLineView } from '@liwan/commercial-ui/app/utils/invoiceLines'
import { humanizeId } from '@liwan/ui/app/utils/humanizeId'
import { statusBadgeEntry, type StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

export type { SubscriptionDisplayState }
export const DISPLAY_STATE_KEYS: Record<SubscriptionDisplayState, string> = {
  awaiting_payment: 'subscription.state.awaitingPayment', activating: 'subscription.state.activating',
  active: 'subscription.state.active', failed: 'subscription.state.failed', inactive: 'subscription.state.inactive',
}
const DISPLAY_STATE_TONES: Record<SubscriptionDisplayState, StatusBadgeEntry['tone']> = {
  awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'destructive', inactive: 'neutral',
}

export function subscriptionStateBadge(state: SubscriptionDisplayState): StatusBadgeEntry {
  return statusBadgeEntry(
    Object.fromEntries((Object.keys(DISPLAY_STATE_TONES) as SubscriptionDisplayState[]).map(key => [key, { tone: DISPLAY_STATE_TONES[key], labelKey: DISPLAY_STATE_KEYS[key] }])) as Record<SubscriptionDisplayState, StatusBadgeEntry>,
    state,
  )
}

export function formatSubscriptionMoney(money: Money, locale = 'ar'): string {
  const intl = locale.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US'
  return new Intl.NumberFormat(intl, { style: 'currency', currency: money.currency, minimumFractionDigits: money.exponent, maximumFractionDigits: money.exponent }).format(money.minor / 10 ** money.exponent)
}

/** A usage figure for display. `value: null` means unknown: never rendered as 0. */
export function usageFigure(metric: UsageMetric, freshness: UsageSnapshot['freshness']): { value: number | null; limit: number | null; known: boolean; stale: boolean } {
  const known = freshness !== 'unavailable' && metric.used !== null
  return { value: known ? metric.used : null, limit: metric.limit, known, stale: known && freshness === 'stale' }
}

/** The refusal code `createError({statusCode,data})` produces on the client: the body is nested one level. */
export function refusalCode(cause: unknown): string | null {
  const e = cause as { data?: { code?: string; data?: { code?: string } } } | null
  const code = e?.data?.data?.code ?? e?.data?.code
  return typeof code === 'string' ? code : null
}

/** Refusal codes that need a specific explanation; everything else falls back to the generic message. */
export function refusalKey(code: unknown): string | null {
  return code === 'tenant_upgrade_required' || code === 'tenant_binding_unavailable' || code === 'trial_order_unavailable'
    ? `subscription.trial.${code === 'tenant_upgrade_required' ? 'upgradeRequired' : 'notConfigured'}`
    : null
}

/** The commercial facts of a quote, ignoring its identity and expiry, so a re-quote of the
 * same selection compares equal even though `expires_at` moves the digest. */
export function quoteEconomics(q: Quote) {
  return {
    plan: q.plan_revision_id, bundles: [...q.bundle_revision_ids].sort(), terms: q.terms_revision_id,
    cadence: q.cadence, users: q.requested_users, storage: q.requested_storage_mb,
    branches: q.requested_extra_branches, due: q.due_now.minor, renewal: q.next_renewal.minor,
    lines: q.lines.map(l => [l.kind, l.key, l.amount.minor, l.quantity]),
  }
}

export function sameQuoteEconomics(a: Quote, b: Quote): boolean {
  return JSON.stringify(quoteEconomics(a)) === JSON.stringify(quoteEconomics(b))
}

export const QUOTE_IS_EXPIRED = (quote: Pick<Quote, 'expires_at'>, now = Date.now()): boolean => Date.parse(quote.expires_at) <= now

/** Body for POST /quotes and /branch-quotes never carries tenant/customer identity (the BFF rejects those keys). */
export function sanitizeBody<T extends Record<string, unknown>>(body: T): T {
  const forbidden = new Set(['tenant_id', 'customer_id', 'capabilities', 'principal', 'actor_id'])
  return Object.fromEntries(Object.entries(body).filter(([k]) => !forbidden.has(k))) as T
}

/**
 * One idempotency key per user action, kept in sessionStorage so a retry or page refresh re-sends the same key
 * (the control plane then returns the original order instead of charging again). Call `forget` after the action settles.
 */
/**
 * The double-submit token for a mutation. When the page's first read ran during SSR its Set-Cookie never
 * reached the browser, so a missing cookie is requested once over the browser before the request is sent.
 */
export async function csrfTokenFor(current: string | null | undefined, fetchCookie: () => Promise<void>, read: () => string | null | undefined): Promise<string | null> {
  if (current) return current
  await fetchCookie()
  return read() ?? null
}

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function idempotencyKey(store: KeyStore | null, action: string, make: () => string = () => crypto.randomUUID()): string {
  const name = `liwan:idem:${action}`
  const existing = store?.getItem(name)
  if (existing) return existing
  const fresh = make()
  store?.setItem(name, fresh)
  return fresh
}
export function forgetIdempotencyKey(store: KeyStore | null, action: string) { store?.removeItem(`liwan:idem:${action}`) }

/** Stable action name: same inputs (subscription, revision, request content) → same key across refresh/retry. */
export function safeIdemAction(kind: string, subscriptionId: string, revision: number, content: string): string {
  let h = 5381
  for (const ch of `${subscriptionId}|${revision}|${content}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return `${kind}:${(h >>> 0).toString(36)}`
}

/** Provider redirect is followed only for https URLs (or the local simulator on same origin). */
export function safePaymentRedirect(url: string | null | undefined, origin: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url, origin)
    if (u.protocol === 'https:' || u.origin === origin) return u.toString()
  } catch { /* fall through */ }
  return null
}

/** A usage row's label: its limit key's translation, else its unit's, else a readable id. */
export function usageMetricLabel(metric: Pick<UsageMetric, 'key' | 'unit'>, t: (key: string) => string, te: (key: string) => boolean): string {
  const byKey = `subscription.usage.keys.${metric.key.replace(/\./g, '_')}`
  if (te(byKey)) return t(byKey)
  const byUnit = `subscription.usage.${metric.unit}`
  if (te(byUnit)) return t(byUnit)
  return humanizeId(metric.key)
}

/** The customer invoice: list lines (× quantity · free · paid), the "not official" notice and the totals. */
export function subscriptionInvoiceView(invoice: Invoice, t: (key: string) => string, locale: string) {
  const money = (value: Invoice['total']) => formatSubscriptionMoney(value, locale)
  const lines: InvoiceLineView[] = invoice.lines.map((line) => {
    const q = invoiceLineQuantities(line)
    return {
      id: line.key,
      // Metered quantities are UI labels, not stored descriptions; the priced revision names the rest.
      description: line.kind === 'users' ? t('subscription.invoices.users') : line.kind === 'storage' ? t('subscription.invoices.storage') : line.description,
      cells: [
        { key: 'quantity', label: '', value: `× ${line.quantity}` },
        ...(q.free === null ? [] : [
          { key: 'free', label: t('subscription.invoices.free'), value: String(q.free) },
          { key: 'paid', label: t('subscription.invoices.paidQty'), value: String(q.paid) },
        ]),
      ],
      amount: money(line.amount),
    }
  })
  return {
    lines,
    notice: t('subscription.invoices.notOfficial'),
    totals: [
      { label: t('subscription.invoices.subtotal'), value: money(invoice.subtotal) },
      { label: t('subscription.invoices.tax'), value: money(invoice.tax) },
      { label: t('subscription.invoices.total'), value: money(invoice.total) },
    ],
  }
}

export type OrderOutcome = 'applied' | 'cancelled' | 'awaiting_payment' | 'payment_failed' | 'processing' | 'activation_failed' | 'refund'

/** What the customer should see for an order, whether it is still open or already closed. */
export function orderOutcome(order: Pick<Order, 'payment_state' | 'fulfillment_state'> & { cancelled?: boolean }): OrderOutcome {
  // A refund can follow activation and leaves fulfillment_state as it was, so the payment outcome wins.
  if (order.payment_state === 'refund_pending' || order.payment_state === 'refunded') return 'refund'
  if (order.fulfillment_state === 'applied') return 'applied'
  if (order.fulfillment_state === 'failed' || order.fulfillment_state === 'needs_intervention') return 'activation_failed'
  if (order.cancelled) return 'cancelled'
  if (order.payment_state === 'failed') return 'payment_failed'
  if (order.payment_state === 'awaiting_payment') return 'awaiting_payment'
  return 'processing'
}

/** Whole Riyadh calendar days left until `endsAt`, never below zero. */
export function trialDaysRemaining(endsAt: string | null | undefined, now: Date = new Date()): number | null {
  return endsAt ? Math.max(0, daysBetween(riyadhDate(now), riyadhDate(endsAt))) : null
}
