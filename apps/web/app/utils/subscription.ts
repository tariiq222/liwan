import type { Invoice, Money, Quote, SubscriptionDisplayState, UsageMetric, UsageSnapshot } from '@webvue/commercial-contracts'

import { invoiceLineQuantities, type InvoiceLineView } from '@webvue/commercial-ui/app/utils/invoiceLines'
import { humanizeId } from '@webvue/ui/app/utils/humanizeId'
import { statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

export type { SubscriptionDisplayState }
export const DISPLAY_STATE_KEYS: Record<SubscriptionDisplayState, string> = {
  awaiting_payment: 'subscription.state.awaitingPayment', activating: 'subscription.state.activating',
  active: 'subscription.state.active', failed: 'subscription.state.failed', inactive: 'subscription.state.inactive',
}
export const DISPLAY_STATE_COLORS: Record<SubscriptionDisplayState, 'warning' | 'info' | 'success' | 'error' | 'neutral'> = {
  awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'error', inactive: 'neutral',
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
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function idempotencyKey(store: KeyStore | null, action: string, make: () => string = () => crypto.randomUUID()): string {
  const name = `webvue:idem:${action}`
  const existing = store?.getItem(name)
  if (existing) return existing
  const fresh = make()
  store?.setItem(name, fresh)
  return fresh
}
export function forgetIdempotencyKey(store: KeyStore | null, action: string) { store?.removeItem(`webvue:idem:${action}`) }

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
      description: line.description,
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
