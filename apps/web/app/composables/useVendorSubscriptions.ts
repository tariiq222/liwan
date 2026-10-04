import { normalizeQuoteResponse, withoutDraftTerms } from '@/utils/vendorSubscriptions'
import type { BranchSummary, Invoice, Quote, SubscriptionView, UsageSnapshot, CustomerTermsRevision, Order } from '@nasq/commercial-contracts'
import type { VendorCustomer, VendorCustomerList, VendorInvoiceList } from '@/utils/vendorSubscriptions'

/** Typed access to the vendor customer / subscription / invoice endpoints (proxy /api/vendor/v1 → /v1). Totals and prices always come from the server. */
export function useVendorSubscriptions() {
  const { request } = useVendorApi()
  const seg = encodeURIComponent
  return {
    listCustomers: (query: Record<string, unknown>) => request<VendorCustomerList>('commercial/customers', { query }),
    createCustomer: (body: { name: string; tenant_id?: string; reason: string }) => request<VendorCustomer>('commercial/customers', { method: 'POST', body }),
    /** No by-id customer route in the contract: page through the list. */
    customer: async (id: string) => {
      for (let offset = 0; offset < 5000; offset += 200) {
        const page = await request<VendorCustomerList>('commercial/customers', { query: { limit: 200, offset } })
        const hit = page.items.find(c => c.id === id)
        if (hit) return hit
        if (offset + 200 >= page.total) break
      }
      return null
    },
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
