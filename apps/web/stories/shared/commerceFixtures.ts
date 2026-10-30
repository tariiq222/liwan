import type { Quote } from '@liwan/commercial-contracts'
const sha = 'a'.repeat(64)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = (key: string, kind: Quote['lines'][number]['kind'], timing: 'now' | 'renewal', description: string, quantity: number, minor: number) =>
  ({ key, kind, timing, description, quantity, amount: sar(minor), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: id(2) })
export const quote: Quote = {
  id: 'q1', customer_id: 'preview', subscription_id: null, expected_subscription_revision: 0, plan_revision_id: id(2), bundle_revision_ids: [id(3)],
  terms_revision_id: null, entitlement_digest: sha, requested_extra_branches: 3, cadence: { unit: 'month', count: 1 }, effective_date: '2026-10-02', policy_revision_id: id(4),
  lines: [line('base', 'base', 'now', 'الباقة الأساسية', 1, 20000), line('b1', 'bundle', 'now', 'حزمة المشاريع', 1, 10000), line('br', 'branch', 'now', 'فرع إضافي', 2, 6000), line('vat', 'tax', 'now', 'ضريبة القيمة المضافة 15٪', 1, 5400),
    line('r1', 'base', 'renewal', 'الباقة الأساسية', 1, 20000)],
  due_now: sar(41400), next_renewal: sar(41400), next_renewal_at: '2026-11-02', expires_at: '2026-10-02T12:00:00Z', digest: sha,
}
