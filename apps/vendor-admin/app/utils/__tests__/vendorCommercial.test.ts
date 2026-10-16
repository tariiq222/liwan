import { describe, expect, it } from 'vitest'
import { actionBlockedReason, appName, availableActions, audienceFromDraft, bundleCreatePayload, bundleDraftFromView, bundleEditPayload, bundleLimitKeys, commercialFailure, commercialErrorKey, commercialReturnTo, dependencyHints, emptyBundleDraft, emptyPlanDraft, fieldIssue, limitFromDraft, limitToDraft, lifecycleStatus, lifecycleUrl, keyLabel, minorToInput, parseVendorMoneyInput, planCreatePayload, planDraftFromView, planEditPayload, priceRowErrors, pricesFromDrafts, quoteRequestBody } from '../vendorCommercial'

const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const release = { id: rid(1), version: '1', source_digest: 'a'.repeat(64), artifact_digest: 'a'.repeat(64), applications: [
  { id: 'core', name_ar: 'أ', name_en: 'Core', modules: [], requires_apps: [], conflicts_with_apps: [], selectable: false, features: [] },
  { id: 'projects', name_ar: 'م', name_en: 'Projects', modules: [], requires_apps: [], conflicts_with_apps: ['people'], selectable: true, features: [
    { key: 'projects.max_projects', kind: 'limit' as const, selectable: false, requires: [], enforcement_refs: [] }, { key: 'users.limit', kind: 'limit' as const, selectable: false, requires: [], enforcement_refs: [] }] },
  { id: 'people', name_ar: 'ب', name_en: 'People', modules: [], requires_apps: ['payroll'], conflicts_with_apps: ['projects'], selectable: true, features: [] },
] }

type ErrorMessages = { vendor: { pricing: { errors: Record<string, string> } } }

describe('money', () => {
  it('parses SAR to halalas without float error and rejects bad input', () => {
    expect(parseVendorMoneyInput('12.5')).toBe(1250)
    expect(parseVendorMoneyInput('0.07')).toBe(7)
    expect(parseVendorMoneyInput('19.99')).toBe(1999)
    expect(parseVendorMoneyInput('١٢٫٥٠')).toBe(1250)
    expect(parseVendorMoneyInput('1,200.00')).toBe(120000)
    for (const bad of ['', '  ', '-1', '1.234', 'abc', '1.2.3', '.'] ) expect(parseVendorMoneyInput(bad)).toBeNull()
    expect(parseVendorMoneyInput('0')).toBe(0)
  })
  it('round-trips', () => {
    expect(minorToInput(1999)).toBe('19.99')
  })
})
describe('limit tri-state', () => {
  it('maps unlimited→null, none→0, number→n and never blank→0', () => {
    expect(limitFromDraft({ mode: 'unlimited', value: '' })).toBeNull()
    expect(limitFromDraft({ mode: 'none', value: '' })).toBe(0)
    expect(limitFromDraft({ mode: 'number', value: '25' })).toBe(25)
    expect(() => limitFromDraft({ mode: '', value: '' })).toThrow()
    expect(() => limitFromDraft({ mode: 'number', value: '' })).toThrow()
    expect(() => limitFromDraft({ mode: 'number', value: '0' })).toThrow()
    expect(() => limitFromDraft(undefined)).toThrow()
  })
  it('round-trips null, 0, n and missing', () => {
    expect(limitToDraft(null).mode).toBe('unlimited'); expect(limitToDraft(0).mode).toBe('none')
    expect(limitToDraft(7)).toEqual({ mode: 'number', value: '7' }); expect(limitToDraft(undefined).mode).toBe('')
  })
})
describe('prices', () => {
  it('validates rows and converts to minor units', () => {
    expect(priceRowErrors([{ unit: '', count: '1', amount: '1' }])).toEqual(['cadence'])
    expect(priceRowErrors([{ unit: 'month', count: '1', amount: '' }])).toEqual(['amount'])
    expect(priceRowErrors([{ unit: 'month', count: '1', amount: '1' }, { unit: 'month', count: '1', amount: '2' }])).toEqual([null, 'duplicate'])
    expect(pricesFromDrafts([{ unit: 'year', count: '1', amount: '1200.00' }])).toEqual([{ cadence: { unit: 'year', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 120000 } }])
    expect(() => pricesFromDrafts([{ unit: 'year', count: '13', amount: '1' }])).toThrow()
  })
})
describe('catalog helpers', () => {
  it('limit keys exclude platform-owned limits', () => { expect(bundleLimitKeys(release, ['projects'])).toEqual(['projects.max_projects']) })
  it('reports missing deps and conflicts once', () => {
    const h = dependencyHints(release, ['projects', 'people'])
    expect(h.missing).toEqual([{ app: 'people', requires: 'payroll' }]); expect(h.conflicts).toHaveLength(1)
    expect(dependencyHints(release, ['projects'])).toEqual({ missing: [], conflicts: [] })
  })
})
describe('bundle form ↔ payload', () => {
  const filled = () => ({ ...emptyBundleDraft(), name: ' حزمة ', description: 'وصف', catalog_release_id: release.id,
    apps: { projects: { selected: true, features: ['b.x', 'a.y'] } }, limits: { 'projects.max_projects': { mode: 'none' as const, value: '' } }, prices: [{ unit: 'month' as const, count: '1', amount: '10' }] })
  it('builds a contract-valid payload with null vs 0 preserved', () => {
    const p = bundleCreatePayload(filled(), release)
    expect(p.domain_limits).toEqual({ 'projects.max_projects': 0 }); expect(p.selections[0]!.feature_keys).toEqual(['a.y', 'b.x']); expect(p.name).toBe('حزمة')
    expect(p).not.toHaveProperty('reason')
    expect(bundleCreatePayload({ ...filled(), limits: { 'projects.max_projects': { mode: 'unlimited', value: '' } } }, release).domain_limits['projects.max_projects']).toBeNull()
  })
  it('refuses missing limit choice and requires reason on edit', () => {
    expect(() => bundleCreatePayload({ ...filled(), limits: {} }, release)).toThrow()
    expect(() => bundleEditPayload(filled(), release, 3)).toThrow()
    expect(bundleEditPayload({ ...filled(), reason: 'تعديل' }, release, 3).edit_revision).toBe(3)
  })
  it('loads a view into a draft', () => {
    const d = bundleDraftFromView({ id: rid(2), version: 1, edit_revision: 1, name: 'n', status: 'draft', available: false, audience: { kind: 'customer', customer_id: 'c1' }, prices: [], bundle_id: 'b', description: 'd', catalog_release_id: release.id, selections: [{ app_id: 'projects', feature_keys: [] }], domain_limits: { 'projects.max_projects': null } })
    expect(d.audience).toEqual({ kind: 'customer', customer_id: 'c1' }); expect(d.limits['projects.max_projects']!.mode).toBe('unlimited'); expect(audienceFromDraft(d.audience)).toEqual({ kind: 'customer', customer_id: 'c1' })
  })
})
describe('plan form ↔ payload', () => {
  const filled = () => ({ ...emptyPlanDraft(), name: 'P', term_months: '12', prices: [{ unit: 'month' as const, count: '1', amount: '100' }], included: [rid(5)], optional: [rid(5), rid(6)],
    platform: { 'users.limit': { mode: 'number' as const, value: '10' }, 'storage.limit_mb': { mode: 'unlimited' as const, value: '' } }, included_extra_branches: '0',
    extra_branch_prices: [{ unit: 'month' as const, count: '1', amount: '20' }], extra_branches_limit: { mode: 'unlimited' as const, value: '' }, trial_days: '0', grace_days: '7', auto_suspend: 'true' as const, auto_renew_allowed: 'false' as const })
  it('maps explicit values (0 free branches, false renew) and drops optional dupes', () => {
    const p = planCreatePayload(filled(), rid(9))
    expect(p.included_extra_branches).toBe(0); expect(p.trial_days).toBe(0); expect(p.auto_renew_allowed).toBe(false); expect(p.extra_branches_limit).toBeNull()
    expect(p.optional_bundle_revision_ids).toEqual([rid(6)]); expect(p.currency).toBe('SAR'); expect(p.platform_limits['storage.limit_mb']).toBeNull()
  })
  it('rejects empty explicit choices instead of defaulting', () => {
    for (const patch of [{ auto_suspend: '' }, { auto_renew_allowed: '' }, { trial_days: '' }, { grace_days: '' }, { included_extra_branches: '' }, { term_months: '' }, { extra_branches_limit: { mode: '', value: '' } }])
      expect(() => planCreatePayload({ ...filled(), ...patch } as never, rid(9))).toThrow()
  })
  it('edit requires reason; draft from view starts empty for unknown and maps back', () => {
    expect(() => planEditPayload(filled(), rid(9), 2)).toThrow()
    expect(planEditPayload({ ...filled(), reason: 'سبب' }, rid(9), 2).edit_revision).toBe(2)
    expect(emptyPlanDraft().auto_suspend).toBe(''); expect(emptyPlanDraft().trial_days).toBe('')
    const p = planCreatePayload(filled(), rid(9))
    const d = planDraftFromView({ ...p, id: rid(1), plan_id: 'p', version: 1, edit_revision: 1, status: 'draft', available: false } as never)
    expect(d.auto_renew_allowed).toBe('false'); expect(d.extra_branches_limit.mode).toBe('unlimited')
  })
})
describe('lifecycle', () => {
  it('derives status and actions', () => {
    expect(lifecycleStatus({ status: 'published', available: false })).toBe('withdrawn')
    expect(availableActions('draft')).toEqual(['validate', 'delete']); expect(availableActions('withdrawn')).toContain('restore')
  })
  it('gates plans on both capabilities and bundle publish on pricing', () => {
    const only = (...c: string[]) => (x: string) => c.includes(x)
    expect(actionBlockedReason('plan', 'validate', only('vendor.catalog.manage') as never)).toBe('pricing')
    expect(actionBlockedReason('bundle', 'validate', only('vendor.catalog.manage') as never)).toBeNull()
    expect(actionBlockedReason('bundle', 'publish', only('vendor.catalog.manage') as never)).toBe('pricing')
    expect(actionBlockedReason('bundle', 'withdraw', only('vendor.catalog.manage') as never)).toBe('pricing')
    expect(actionBlockedReason('bundle', 'restore', only('vendor.catalog.manage') as never)).toBe('pricing')
    expect(actionBlockedReason('bundle', 'validate', only() as never)).toBe('catalog')
    expect(availableActions('validated')).toEqual(['publish'])
  })
  it('builds URLs', () => {
    expect(lifecycleUrl('bundle', 'a/b', 'delete')).toEqual({ path: 'commercial/bundles/a%2Fb', method: 'DELETE' })
    expect(lifecycleUrl('plan', 'x', 'revisions')).toEqual({ path: 'commercial/plans/x/revisions', method: 'POST' })
  })
})
describe('errors and routing', () => {
  it('classifies conflict/forbidden/field issues', () => {
    const c = commercialFailure({ status: 409, data: { code: 'revision_conflict' } })
    expect(c.conflict).toBe(true); expect(commercialFailure({ response: { status: 403, _data: { code: 'forbidden' } } }).forbidden).toBe(true)
    const f = commercialFailure({ status: 422, data: { code: 'price_missing', field: 'prices[0]' } })
    expect(fieldIssue(f, 'prices')).toBe('price_missing'); expect(fieldIssue(f, 'name')).toBeUndefined()
    expect(commercialErrorKey({ data: { code: 'price_missing' } })).toBe('vendor.pricing.errors.price_missing'); expect(commercialErrorKey({ data: { code: 'zzz' } })).toBe('vendor.pricing.errors.generic')
  })
  it('keeps return targets inside the list', () => {
    expect(commercialReturnTo('/bundles?status=draft', '/bundles')).toBe('/bundles?status=draft')
    expect(commercialReturnTo('/plans', '/bundles')).toBe('/bundles'); expect(commercialReturnTo('//evil.com', '/plans')).toBe('/plans')
    expect(commercialReturnTo('/bundles/new', '/bundles')).toBe('/bundles')
  })
})
describe('quote request', () => {
  it('sends ids and counts only', () => {
    const body = quoteRequestBody({ plan: { id: rid(1), included_bundle_revision_ids: [rid(2)] } as never, cadence: { unit: 'month', count: 1 }, extraBranches: 2, optionalBundleIds: [rid(3)] })
    expect(body).toEqual({ kind: 'new', plan_revision_id: rid(1), bundle_revision_ids: [rid(2), rid(3)], cadence: { unit: 'month', count: 1 }, requested_extra_branches: 2 })
  })
})

describe('error codes', () => {
  it('has ar and en strings for every known code', async () => {
    const { COMMERCIAL_ERROR_CODES } = await import('../vendorCommercial')
    const ar = (await import('../../../i18n/locales/ar/vendor.json')).default as ErrorMessages, en = (await import('../../../i18n/locales/en/vendor.json')).default as ErrorMessages
    for (const code of COMMERCIAL_ERROR_CODES) { expect(ar.vendor.pricing.errors[code], code).toBeTruthy(); expect(en.vendor.pricing.errors[code], code).toBeTruthy(); expect(commercialErrorKey({ code })).toBe(`vendor.pricing.errors.${code}`) }
  })
  it('shows an application that only registered its keys and got a catalog tier (spec 3.6 acceptance 4)', () => {
    const release = { id: 'r', version: 'v', source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64), applications: [
      { id: 'probe', name_ar: 'Probe', name_en: 'Probe', modules: ['nasq_registry_probe'], requires_apps: [], conflicts_with_apps: [], selectable: true,
        features: [{ key: 'probe.enabled', kind: 'boolean', selectable: true, requires: [], enforcement_refs: [] }, { key: 'probe.max_items', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] }] },
    ] } as never
    expect(appName((release as { applications: never[] }).applications[0]!, 'ar')).toBe('Probe')
    expect(bundleLimitKeys(release, ['probe'])).toEqual(['probe.max_items'])
    // An unregistered label falls back to the raw key; a registered one is translated.
    expect(keyLabel('probe.enabled', k => `T:${k}`, () => false)).toBe('probe.enabled')
    expect(keyLabel('probe.enabled', k => `T:${k}`, path => path === 'vendor.pricing.keys.probe_enabled')).toBe('T:vendor.pricing.keys.probe_enabled')
  })
})
