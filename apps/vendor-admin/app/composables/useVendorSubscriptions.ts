import { commercialFailure } from '@/utils/vendorCommercial'
import { normalizeQuoteResponse, withoutDraftTerms } from '@/utils/vendorSubscriptions'
import type { TenantDeletionRequest, Adjustment, BranchSummary, ClientList, Quote, SubscriptionView, UsageSnapshot, CustomerTermsRevision, Order, PaymentAttempt } from '@liwan/commercial-contracts'
import type { AdminLoginChange, AdminLoginPreview, VendorCustomer, VendorInvoice, VendorInvoiceList } from '@/utils/vendorSubscriptions'

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
    resendInvitation: (customerId: string) => request<{ id: string; expires_at: string; delivery_status: string }>(`commercial/customers/${seg(customerId)}/invitations`, { method: 'POST', body: {} }),
    createPaymentAttempt: (orderId: string) => request<PaymentAttempt>(`commercial/orders/${seg(orderId)}/payment-attempts`, { method: 'POST', body: {} }),
    paymentAttempts: (orderId: string) => request<{ items: PaymentAttempt[]; total: number }>(`commercial/orders/${seg(orderId)}/payment-attempts`),
    subscription: (id: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}`),
    branches: (subscriptionId: string) => request<BranchSummary>(`commercial/subscriptions/${seg(subscriptionId)}/branches`),
    usage: (subscriptionId: string) => request<UsageSnapshot>(`commercial/subscriptions/${seg(subscriptionId)}/usage`),
    listInvoices: (query: Record<string, unknown>) => request<VendorInvoiceList>('commercial/invoices', { query }),
    invoice: (id: string) => request<VendorInvoice>(`commercial/invoices/${seg(id)}`),
    /** Records a refund the operator made by hand (a bank transfer, or after the system could not refund); nothing is refunded by this call. */
    refundCreditNote: (id: string, body: { external_reference: string; reason: string }) => request<Adjustment>(`commercial/invoice-adjustments/${seg(id)}/refund`, { method: 'POST', body: { external_reference: body.external_reference.trim(), reason: body.reason.trim() } }),
    /** Asks for the full refund of a paid invoice: a credit note the server creates only for the customer's first payment, inside the window; a card payment is then refunded through the provider by the control plane. An invoice with an AI top-up also states the units already spent. Nothing is refunded by this call. */
    requestRefund: (id: string, body: { reason: string; units_used?: number }) => request<Adjustment>(`commercial/invoices/${seg(id)}/refund-request`, { method: 'POST', body: { reason: body.reason.trim(), ...(body.units_used === undefined ? {} : { units_used: body.units_used }) } }),
    // The vendor records a bank transfer that arrived; the control plane then pays the order through its normal path.
    recordBankTransfer: (id: string, body: { reference: string; amount: number; value_date: string }) => request<unknown>(`commercial/invoices/${seg(id)}/bank-transfer`, { method: 'POST', body: { reference: body.reference.trim(), amount: body.amount, value_date: body.value_date } }),
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
    /** Stops the workspace now (users are refused at sign-in); a payment does not lift it, only `resumeSubscription` does. */
    suspendSubscription: (id: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/suspend`, { method: 'POST', body: { reason: reason.trim() } }),
    resumeSubscription: (id: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/resume`, { method: 'POST', body: { reason: reason.trim() } }),
    /** Stops the renewal on the customer's behalf: the paid period stays and the subscription drops to the free base on its renewal date. */
    cancelRenewal: (id: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/cancel-renewal`, { method: 'POST', body: { reason: reason.trim() } }),
    /** Deletes the customer's saved card at the provider first; if that fails the card stays and the control plane answers 503. Automatic renewal stops with it. */
    removePaymentMethod: (id: string, paymentMethodId: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/payment-methods/${seg(paymentMethodId)}/remove`, { method: 'POST', body: { reason: reason.trim() } }),
    /** Stops automatic renewal and keeps the card; the customer's next invoice is paid by hand. */
    disableAutoRenew: (id: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/disable-auto-renew`, { method: 'POST', body: { reason: reason.trim() } }),
    resumeRenewal: (id: string, reason: string) => request<SubscriptionView>(`commercial/subscriptions/${seg(id)}/resume-renewal`, { method: 'POST', body: { reason: reason.trim() } }),
    /** The customer's latest workspace-deletion request (any state), or null. The customer asks for and confirms it; the console only reads it. */
    tenantDeletion: (customerId: string) => request<{ deletion: TenantDeletionRequest | null }>(`commercial/customers/${seg(customerId)}/deletion`),
    /** Withdraws the open deletion request on the customer's behalf, any time before it is due. It never resumes a renewal the deletion stopped. */
    withdrawTenantDeletion: (customerId: string, reason: string) => request<{ deletion: TenantDeletionRequest | null }>(`commercial/customers/${seg(customerId)}/deletion/withdraw`, { method: 'POST', body: { reason: reason.trim() } }),
    /** Changes the address that receives every control-plane mail for the workspace. No Odoo user, password or login changes; both addresses are told. */
    changeAdminLogin: (customerId: string, body: { admin_login: string; reason: string }) => request<{ change: AdminLoginChange }>(`commercial/customers/${seg(customerId)}/admin-login`, { method: 'PATCH', body: { admin_login: body.admin_login.trim(), reason: body.reason.trim() } }),
    /** Writes nothing: refuses a workspace nobody has activated, and says how many other customers already hold the address. */
    previewAdminLogin: (customerId: string, adminLogin: string) => request<{ preview: AdminLoginPreview }>(`commercial/customers/${seg(customerId)}/admin-login`, { method: 'PATCH', body: { admin_login: adminLogin.trim(), dry_run: true } }),
    endTrial: (id: string, body: { reason: string }) => request<{ customer_id: string }>(`commercial/trials/${seg(id)}/end`, { method: 'POST', body }),
  }
}
