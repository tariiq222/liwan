import type { Money, Quote, SubscriptionDisplayState, UsageMetric, UsageSnapshot } from '@nasq/commercial-contracts'

export type { SubscriptionDisplayState }
export const DISPLAY_STATE_KEYS: Record<SubscriptionDisplayState, string> = {
  awaiting_payment: 'subscription.state.awaitingPayment', activating: 'subscription.state.activating',
  active: 'subscription.state.active', failed: 'subscription.state.failed', inactive: 'subscription.state.inactive',
}
export const DISPLAY_STATE_COLORS: Record<SubscriptionDisplayState, 'warning' | 'info' | 'success' | 'error' | 'neutral'> = {
  awaiting_payment: 'warning', activating: 'info', active: 'success', failed: 'error', inactive: 'neutral',
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
  const name = `nasq:idem:${action}`
  const existing = store?.getItem(name)
  if (existing) return existing
  const fresh = make()
  store?.setItem(name, fresh)
  return fresh
}
export function forgetIdempotencyKey(store: KeyStore | null, action: string) { store?.removeItem(`nasq:idem:${action}`) }

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
