import type { Branch, BranchSummary, Invoice, PaymentAttempt, Quote, SubscriptionView, UsageSnapshot } from '@webvue/commercial-contracts'
import { deriveCustomerCapabilities } from '@/utils/customerCapabilities'
import { forgetIdempotencyKey, idempotencyKey, safePaymentRedirect, sanitizeBody } from '@/utils/subscription'

export type SubscriptionList<T> = { items: T[]; total: number }
export type CustomerCatalog = { plans: Array<Record<string, any>>; bundles: Array<Record<string, any>>; release?: Record<string, any> | null }
export type CustomerOrderResult = { order: NonNullable<SubscriptionView['pending_order']> }
const CSRF_COOKIE = 'webvue_csrf'

export function useSubscriptionApi() {
  const headers = import.meta.server ? useRequestHeaders(['cookie', 'host', 'x-webvue-proxy-token', 'x-webvue-tenant-revision']) : undefined
  const csrf = useCookie(CSRF_COOKIE)
  async function request<T>(path: string, options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}): Promise<T> {
    const mutation = (options.method ?? 'GET') !== 'GET'
    return await $fetch<unknown>(`/api/commercial/v1/${path.replace(/^\/+/, '')}`, {
      method: (options.method ?? 'GET') as any,
      body: options.body ? sanitizeBody(options.body as Record<string, unknown>) as any : undefined,
      query: options.query,
      headers: { ...(headers ?? {}), ...(mutation && csrf.value ? { 'x-webvue-csrf': csrf.value } : {}) },
    }) as T
  }
  const store = (): Storage | null => (import.meta.client ? window.sessionStorage : null)
  return {
    subscription: () => request<SubscriptionView>('subscription'),
    catalog: () => request<CustomerCatalog>('catalog'),
    usage: () => request<UsageSnapshot>('usage'),
    invoices: () => request<SubscriptionList<Invoice>>('invoices'),
    invoice: (id: string) => request<Invoice>(`invoices/${encodeURIComponent(id)}`),
    branches: () => request<BranchSummary>('branches'),
    quote: (body: unknown) => request<Quote>('quotes', { method: 'POST', body }),
    /** Prices the same request in memory; the control plane never writes a quote row for it. */
    preview: (body: unknown) => request<Quote>('preview', { method: 'POST', body }),
    startTrial: (body: unknown) => request<{ order: NonNullable<SubscriptionView['pending_order']>; subscription: SubscriptionView }>('trial', { method: 'POST', body }),
    branchQuote: (body: unknown) => request<Quote & { branches?: Branch[] }>('branch-quotes', { method: 'POST', body }),
    /** Accepting reuses the stored key for `action` until `done()` so refresh/retry cannot create a second order. */
    accept: (action: string, body: { quote_id: string; expected_subscription_revision: number }) =>
      request<CustomerOrderResult>('orders', { method: 'POST', body: { ...body, idempotency_key: idempotencyKey(store(), action) } }),
    payment: (orderId: string, action: string) =>
      request<PaymentAttempt>(`orders/${encodeURIComponent(orderId)}/payment-attempts`, { method: 'POST', body: { idempotency_key: idempotencyKey(store(), `${action}:pay`) } }),
    done: (action: string) => { forgetIdempotencyKey(store(), action); forgetIdempotencyKey(store(), `${action}:pay`) },
    setAutoRenew: (enabled: boolean) => request<SubscriptionView>('auto-renew', { method: 'POST', body: { enabled, consent: true } }),
  }
}

/** Customer commercial capabilities for display gating only; the BFF recomputes them from the session. */
export function useCustomerCapabilities() {
  const { capabilities } = useAccess()
  const caps = computed(() => deriveCustomerCapabilities(capabilities.value))
  return { caps, can: (c: string) => (caps.value as string[]).includes(c) }
}
