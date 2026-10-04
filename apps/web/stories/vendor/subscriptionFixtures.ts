import type { Invoice, Order, SubscriptionView, UsageSnapshot } from '@nasq/commercial-contracts'
const sha = 'a'.repeat(64)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
export const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', customer_id: 'c1', subscription_id: 's1', kind: 'change', quote_id: 'q1', target_revision_id: id(11), expected_applied_revision_id: id(10),
  payment_state: 'awaiting_payment', fulfillment_state: 'not_started', effective_at: null, idempotency_key: 'k1', request_digest: 'd', due_now: sar(41400), created_at: '2026-10-02T09:00:00Z', ...over,
})
const rev = (n: number) => ({
  id: id(n), subscription_id: 's1', revision: 1, customer_id: 'c1', tenant_id: 't1', plan_revision_id: id(2), bundle_revision_ids: [id(3)], terms_revision_id: null, policy_revision_id: id(4),
  cadence: { unit: 'month' as const, count: 1 }, term_start: '2026-10-02', term_end: '2027-10-02', period_start: '2026-10-02', period_end: '2026-11-02', included_extra_branches: 2, extra_branch_count: 3,
  entitlement: { catalog_release_id: id(1), modules: ['projects'], features: {}, compiler_version: '1', digest: sha }, quote_id: 'q1', created_at: '2026-10-02T09:00:00Z',
})
export const subscription = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: 's1', customer_id: 'c1', tenant_id: 't1', state: 'active', applied: rev(10), target: rev(10), pending_order: null, revision: 3, renewal_at: '2026-11-02',
  auto_renew: { enabled: true, consent_at: '2026-10-02T09:00:00Z', token_ref_present: true }, trial_ends_at: null, grace_ends_at: null, ...over,
})
export const usage = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenant_id: 't1', observed_at: '2026-10-02T09:00:00Z', policy_revision_id: id(4), freshness: 'fresh', metrics: [
    { key: 'users', used: 12, limit: 50, unit: 'users', reason: null }, { key: 'storage', used: 5_242_880, limit: 10_737_418_240, unit: 'attachment_bytes', reason: null },
    { key: 'projects', used: null, limit: null, unit: 'projects', reason: 'timeout' }], ...over,
})
export const invoice: Invoice = {
  id: 'i1', number: 'INV-0001', customer_id: 'c1', subscription_id: 's1', order_id: 'o1', kind: 'initial', status: 'issued', currency: 'SAR',
  lines: [
    { key: 'base', kind: 'base', timing: 'now', description: 'الباقة الأساسية', quantity: 1, unit_amount: sar(20000), amount: sar(20000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: id(2) },
    { key: 'branch', kind: 'branch', timing: 'now', description: 'فروع إضافية', quantity: 1, free_quantity: 2, unit_amount: sar(3000), amount: sar(3000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: id(2) },
  ], subtotal: sar(23000), tax: sar(3450), total: sar(26450), period_start: '2026-10-02', period_end: '2026-11-02', issued_at: '2026-10-02T09:00:00Z', due_at: '2026-10-09T09:00:00Z', paid_at: null,
  tax_label: 'VAT 15% exclusive', official_tax_invoice: false,
}
