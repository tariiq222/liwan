import { commercialFailure } from '@/utils/vendorCommercial'
import { normalizeQuoteResponse, withoutDraftTerms } from '@/utils/vendorSubscriptions'
import type { BranchSummary, Invoice, Quote, SubscriptionView, UsageSnapshot, CustomerTermsRevision, Order, PaymentAttempt } from '@nasq/commercial-contracts'
import type { VendorCustomer, VendorCustomerList, VendorInvoiceList } from '@/utils/vendorSubscriptions'

/** Typed access to the vendor customer / subscription / invoice endpoints (proxy /api/vendor/v1 → /v1). Totals and prices always come from the server. */
export function useVendorSubscriptions() {
  const { request } = useVendorApi()
  const seg = encodeURIComponent
  return {
    listCustomers: (query: Record<string, unknown>) => request<VendorCustomerList>('commercial/customers', { query }),
    createCustomer: (body: { name: string; tenant_id?: string; admin_name?: string; admin_login?: string; request_id?: string }) => request<VendorCustomer>('commercial/customers', { method: 'POST', body }),
    customer: async (id: string) => {
      try { return await request<VendorCustomer>(`commercial/customers/${seg(id)}`) }
      catch (cause) { if (commercialFailure(cause).status === 404) return null; throw cause }
    },
    cancelOrder: (id: string, reason: string) => request<Order>(`commercial/orders/${seg(id)}/cancel`, { method: 'POST', body: { reason: reason.trim() } }),
    paymentAttempts: (orderId: string) => request<{ items: PaymentAttempt[]; total: number }>(`commercial/orders/${seg(orderId)}/payment-attempts`),
    subscription: (id: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}`),
    branches: (subscriptionId: string) => request<BranchSummary>(`commercial/subscriptions/${seg(subscriptionId)}/branches`),
    usage: (subscriptionId: string) => request<UsageSnapshot>(`commercial/subscriptions/${seg(subscriptionId)}/usage`),
    listInvoices: (query: Record<string, unknown>) => request<VendorInvoiceList>('commercial/invoices', { query }),
    invoice: (id: string) => request<Invoice>(`commercial/invoices/${seg(id)}`),
    saveTerms: (body: unknown) => request<CustomerTermsRevision>('commercial/customer-terms', { method: 'POST', body }),
    /** Draft `terms` bodies return a preview only (never persisted, never acceptable). */
    customerQuote: async (body: Record<string, unknown>) => normalizeQuoteResponse<Quote>(await request<unknown>('commercial/customer-quotes', { method: 'POST', body })),
    /** Real quote for a subscription change: never sends draft terms; rejects preview responses. */
    changeQuote: async (body: Record<string, unknown>) => {
      const r = normalizeQuoteResponse<Quote>(await request<unknown>('commercial/customer-quotes', { method: 'POST', body: withoutDraftTerms(body) }))
      if (r.preview) throw Object.assign(new Error('preview_quote'), { code: 'preview_quote' })
      return r.quote
    },
    placeOrder: (body: { quote_id: string; expected_subscription_revision: number; idempotency_key: string }) => request<Order>('commercial/orders', { method: 'POST', body }),
  }
}
