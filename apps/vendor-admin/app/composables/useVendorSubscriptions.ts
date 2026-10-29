import { commercialFailure } from '@/utils/vendorCommercial'
import { normalizeQuoteResponse, withoutDraftTerms } from '@/utils/vendorSubscriptions'
import type { Adjustment, BranchSummary, ClientList, Quote, SubscriptionView, UsageSnapshot, CustomerTermsRevision, Order, PaymentAttempt } from '@webvue/commercial-contracts'
import type { VendorCustomer, VendorInvoice, VendorInvoiceList } from '@/utils/vendorSubscriptions'

/** Typed access to the vendor customer / subscription / invoice endpoints (proxy /api/vendor/v1 → /v1). Totals and prices always come from the server. */
export function useVendorSubscriptions() {
  const { request } = useVendorApi()
  const seg = encodeURIComponent
  return {
    listClients: (query: Record<string, unknown>) => request<ClientList>('commercial/clients', { query }),
    createCustomer: (body: { name: string; tenant_id?: string; admin_name?: string; admin_login?: string; request_id?: string }) => request<VendorCustomer>('commercial/customers', { method: 'POST', body }),
    customer: async (id: string) => {
      try { return await request<VendorCustomer>(`commercial/customers/${seg(id)}`) }
      catch (cause) { if (commercialFailure(cause).status === 404) return null; throw cause }
    },
    cancelOrder: (id: string, reason: string) => request<Order>(`commercial/orders/${seg(id)}/cancel`, { method: 'POST', body: { reason: reason.trim() } }),
    createPaymentAttempt: (orderId: string) => request<PaymentAttempt>(`commercial/orders/${seg(orderId)}/payment-attempts`, { method: 'POST', body: {} }),
    paymentAttempts: (orderId: string) => request<{ items: PaymentAttempt[]; total: number }>(`commercial/orders/${seg(orderId)}/payment-attempts`),
    subscription: (id: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}`),
    branches: (subscriptionId: string) => request<BranchSummary>(`commercial/subscriptions/${seg(subscriptionId)}/branches`),
    usage: (subscriptionId: string) => request<UsageSnapshot>(`commercial/subscriptions/${seg(subscriptionId)}/usage`),
    listInvoices: (query: Record<string, unknown>) => request<VendorInvoiceList>('commercial/invoices', { query }),
    invoice: (id: string) => request<VendorInvoice>(`commercial/invoices/${seg(id)}`),
    /** Records a refund the operator already made in the provider dashboard; nothing is refunded by this call. */
    refundCreditNote: (id: string, body: { external_reference: string; reason: string }) => request<Adjustment>(`commercial/invoice-adjustments/${seg(id)}/refund`, { method: 'POST', body: { external_reference: body.external_reference.trim(), reason: body.reason.trim() } }),
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
    /** Starts the customer's trial; for a customer with no workspace yet its order provisions one. */
    startTrial: (customerId: string, body: Record<string, unknown>) => request<{ order: Order; subscription: SubscriptionView }>(`commercial/customers/${seg(customerId)}/trial`, { method: 'POST', body }),
    extendTrial: (id: string, body: { days: number; reason: string }) => request<{ customer_id: string; trial_ends_at: string }>(`commercial/trials/${seg(id)}/extend`, { method: 'POST', body }),
    endTrial: (id: string, body: { reason: string }) => request<{ customer_id: string }>(`commercial/trials/${seg(id)}/end`, { method: 'POST', body }),
  }
}
