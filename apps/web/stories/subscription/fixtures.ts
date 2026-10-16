import type { BranchSummary, Invoice, UsageSnapshot } from '@webvue/commercial-contracts'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
export const usageFresh: UsageSnapshot = { tenant_id: 't1', observed_at: '2026-10-02T08:00:00Z', policy_revision_id: id(1), freshness: 'fresh', metrics: [
  { key: 'users', used: 12, limit: 25, unit: 'users', reason: null }, { key: 'projects', used: 0, limit: null, unit: 'projects', reason: null }] }
export const usageStale: UsageSnapshot = { ...usageFresh, freshness: 'stale', observed_at: '2026-09-30T08:00:00Z' }
export const usageUnavailable: UsageSnapshot = { tenant_id: 't1', observed_at: null, policy_revision_id: id(1), freshness: 'unavailable', metrics: [
  { key: 'users', used: null, limit: 25, unit: 'users', reason: 'timeout' }, { key: 'projects', used: null, limit: null, unit: 'projects', reason: 'source_unreachable' }] }
export const branches: BranchSummary = { total: 3, hq: 1, free_extra_used: 1, free_extra_allowed: 1, paid: 1, limit: 5, items: [
  { id: id(10), subscription_id: 's1', tenant_id: 't1', name: 'المقر الرئيسي', kind: 'hq', billing: 'included', state: 'active', odoo_company_id: 1, order_id: null, activated_at: null, archived_at: null },
  { id: id(11), subscription_id: 's1', tenant_id: 't1', name: 'فرع جدة', kind: 'extra', billing: 'free_extra', state: 'active', odoo_company_id: 2, order_id: null, activated_at: null, archived_at: null },
  { id: id(12), subscription_id: 's1', tenant_id: 't1', name: 'فرع الدمام', kind: 'extra', billing: 'paid', state: 'pending', odoo_company_id: null, order_id: 'o1', activated_at: null, archived_at: null }] }
export const invoice: Invoice = { id: 'inv1', number: 'INV-1001', customer_id: 'c1', subscription_id: 's1', order_id: null, kind: 'renewal', status: 'issued', currency: 'SAR',
  lines: [{ key: 'base', kind: 'base', timing: 'now', description: 'الباقة الأساسية', quantity: 1, unit_amount: sar(20000), amount: sar(20000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: id(2) },
    { key: 'br', kind: 'branch', timing: 'now', description: 'فرع إضافي', quantity: 2, free_quantity: 1, unit_amount: sar(6000), amount: sar(6000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: id(2) }],
  subtotal: sar(26000), tax: sar(3900), total: sar(29900), period_start: '2026-10-02', period_end: '2026-11-02', issued_at: '2026-10-02', due_at: null, paid_at: null, tax_label: 'VAT 15% exclusive', official_tax_invoice: false }
