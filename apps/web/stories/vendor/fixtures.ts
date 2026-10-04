import type { CatalogRelease, Quote } from '@nasq/commercial-contracts'
const sha = 'a'.repeat(64)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const release: CatalogRelease = {
  id: id(1), version: '2026.10', source_digest: sha, artifact_digest: sha,
  applications: [
    { id: 'core', name_ar: 'المنصة', name_en: 'Platform', modules: ['nasq_core'], requires_apps: [], conflicts_with_apps: [], selectable: false, features: [
      { key: 'users.limit', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] }] },
    { id: 'projects', name_ar: 'المشاريع والاجتماعات', name_en: 'Projects & meetings', modules: ['nasq_pmo'], requires_apps: [], conflicts_with_apps: [], selectable: true, features: [
      { key: 'pmo.enabled', kind: 'boolean', selectable: false, requires: [], enforcement_refs: [] },
      { key: 'meetings.enabled', kind: 'boolean', selectable: true, requires: [], enforcement_refs: [] },
      { key: 'projects.max_projects', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] }] },
    { id: 'people', name_ar: 'الموارد البشرية', name_en: 'People', modules: ['nasq_hr'], requires_apps: ['projects'], conflicts_with_apps: [], selectable: true, features: [
      { key: 'hr.enabled', kind: 'boolean', selectable: false, requires: [], enforcement_refs: [] }] },
  ],
}
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

import type { BundleView } from '@nasq/commercial-contracts'
export const bundleView = (over: Partial<BundleView> = {}): BundleView => ({
  id: id(3), bundle_id: id(30), version: 1, edit_revision: 1, name: 'حزمة المشاريع', description: 'المشاريع والاجتماعات', status: 'draft', available: false,
  audience: { kind: 'public' }, catalog_release_id: id(1), selections: [{ app_id: 'projects', feature_keys: ['meetings.enabled'] }], domain_limits: { 'projects.max_projects': 20 },
  prices: [{ cadence: { unit: 'month', count: 1 }, amount: sar(10000) }], content_digest: sha, validated_digest: null, customer_count: 0,
  created_at: '2026-10-02T09:00:00Z', published_at: null, issues: [], ...over,
} as BundleView)
