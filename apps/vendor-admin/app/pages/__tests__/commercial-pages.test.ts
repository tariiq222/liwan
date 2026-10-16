import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = (p: string) => read(`app/pages/${p}`)
const comp = (p: string) => read(`app/components/vendor/${p}`)
const commercial = (lang: string) => JSON.parse(read(`../../packages/commercial-ui/i18n/locales/${lang}/commercial.json`)).commercial
const json = (lang: string) => JSON.parse(read(`i18n/locales/${lang}/vendor.json`)).vendor
const flat = (o: unknown, prefix = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)])

describe('vendor commercial pages: structure and gating', () => {
  it('uses the route-backed parent pattern for /new like catalog', () => {
    expect(page('bundles.vue')).toContain("=== '/bundles/new'"); expect(page('plans.vue')).toContain("=== '/plans/new'")
    expect(page('bundles/new.vue')).toContain('SharedCreatePanel'); expect(page('plans/new.vue')).toContain('SharedCreatePanel')
  })
  it('gates reads on vendor.read and writes on catalog (plans also pricing)', () => {
    expect(page('bundles/index.vue')).toContain("capability: 'vendor.read'"); expect(page('plans/[id].vue')).toContain("capability: 'vendor.read'")
    expect(page('bundles/new.vue')).toContain("capability: 'vendor.catalog.manage'"); expect(page('bundles/[id]/edit.vue')).toContain("capability: 'vendor.catalog.manage'")
    expect(page('plans/new.vue')).toMatch(/can\('vendor\.catalog\.manage'\) && can\('vendor\.pricing\.manage'\)/)
    expect(page('plans/[id]/edit.vue')).toMatch(/can\('vendor\.catalog\.manage'\) && can\('vendor\.pricing\.manage'\)/)
    expect(page('plans/index.vue')).toMatch(/can\('vendor\.catalog\.manage'\) && can\('vendor\.pricing\.manage'\)/)
  })
  it('keeps filters in the URL and preserves them on return', () => {
    const list = page('bundles/index.vue')
    expect(list).toContain('route.query'); expect(list).toContain('returnTo'); expect(list).toMatch(/router\.replace\(\{ path: '\/bundles'/)
    expect(page('bundles/[id].vue')).toContain("catalogReturn(route.query.returnTo, 'bundles')")
  })
  it('edit is a page with reason and draft protection; forms guard unsaved changes', () => {
    expect(page('bundles/[id]/edit.vue')).toContain('require-reason'); expect(page('plans/[id]/edit.vue')).toContain('require-reason')
    expect(comp('BundleForm.vue')).toContain('SharedUnsavedChanges'); expect(comp('PlanForm.vue')).toContain('SharedUnsavedChanges'); expect(comp('LifecyclePanel.vue')).toContain('SharedUnsavedChanges')
  })
  it('create release flow asks for a reason when no release exists', () => {
    const p = page('bundles/new.vue')
    expect(p).toContain('releases.length'); expect(p).toContain('createRelease'); expect(p).toMatch(/relReason\.value\.trim\(\)\.length < 3/)
  })
  it('create release guide explains the missing release in two steps and replaces the bundle form until one exists', () => {
    const p = page('bundles/new.vue')
    expect(p.indexOf('v-else-if="!releases.length"')).toBeGreaterThan(p.indexOf("v-if=\"!can('vendor.catalog.manage')\""))
    expect(p.indexOf('<VendorBundleForm v-else')).toBeGreaterThan(p.indexOf('v-else-if="!releases.length"'))
    for (const key of ['title', 'why', 'steps', 'step1', 'step2']) expect(p).toContain(`vendor.bundles.guide.${key}`)
    expect(p).toContain('aria-current="step"'); expect(p).toContain('data-testid="release-create"'); expect(p).toContain('vendor.bundles.createRelease')
    for (const lang of ['en', 'ar']) {
      const guide = json(lang).bundles.guide
      for (const key of ['title', 'why', 'steps', 'step1', 'step2']) expect(guide[key], `${lang}.${key}`).toBeTruthy()
    }
  })
  it('bundle detail lists every plan version using it, with its version and state, and says when plans could not load', () => {
    const p = page('bundles/[id].vue')
    expect(p).toContain('plansUsingBundle(page => api.listPlans(page), view.id)'); expect(p).not.toContain('limit: 200')
    const section = p.slice(p.indexOf('data-testid="bundle-plans"'), p.indexOf('<VendorLifecyclePanel'))
    expect(section).toContain('v-if="!data.usedBy"'); expect(section).toContain('vendor.bundles.usedByUnavailable')
    expect(section).toContain('vendor.bundles.usedByNone'); expect(section).toContain("vendor.pricing.version', { count: p.version }"); expect(section).toContain('lifecycleBadge(p)')
    for (const lang of ['en', 'ar']) expect(json(lang).bundles.usedByUnavailable, lang).toBeTruthy()
  })
  it('bundle detail states the status and the customer count once, and all prices through the fact', () => {
    const p = page('bundles/[id].vue')
    expect(p.match(/lifecycleBadge\(view\)\.tone/g)).toHaveLength(1)
    expect(p.match(/vendor\.pricing\.customers'/g)).toHaveLength(1); expect(p).not.toContain('view.customer_count')
    expect(p).toContain('priceFact(v.prices'); expect(p).not.toContain('v.prices[0]')
  })
  it('plan and bundle pages return to the catalog tab they were opened from', () => {
    for (const f of ['plans/[id].vue', 'bundles/[id].vue']) expect(page(f)).toContain(':back-label="t(back.labelKey)"')
    for (const f of ['plans/[id]/edit.vue', 'bundles/[id]/edit.vue']) expect(page(f)).toContain('catalogReturn(route.query.returnTo')
  })
  it('detail shows technical digests only under a details section and recomputes quote via server only', () => {
    expect(page('bundles/[id].vue')).toMatch(/<details[\s\S]*content_digest/); expect(page('bundles/[id].vue').indexOf('content_digest')).toBeGreaterThan(page('bundles/[id].vue').indexOf('<details'))
    const plan = page('plans/[id].vue')
    expect(plan).toContain('api.quote(quoteRequestBody'); expect(plan).toMatch(/setTimeout\(\(\) => void recompute\(\), 350\)/); expect(plan).toContain('mine === seq')
    expect(plan).not.toMatch(/due_now\.minor\s*[+*]/)
  })
  it('uses only logical, themed classes', () => {
    for (const f of ['bundles/index.vue', 'bundles/[id].vue', 'plans/index.vue', 'plans/[id].vue']) expect(page(f)).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b/)
    for (const f of ['BundleForm.vue', 'PlanForm.vue', 'EntitlementSummary.vue', 'LifecyclePanel.vue']) expect(comp(f)).not.toMatch(/\b(ml|mr|pl|pr)-\d|text-(left|right)\b|#[0-9a-f]{3,6}\b/i)
    expect(read('../../packages/commercial-ui/app/components/shared/commerce/PriceBreakdown.vue')).not.toMatch(/\b(ml|mr|pl|pr)-\d|text-(left|right)\b|#[0-9a-f]{3,6}\b/i)
  })
})

describe('lifecycle panel behavior contract', () => {
  const src = comp('LifecyclePanel.vue')
  it('shows conflict with reload, field issues, disabled blocked actions with reason', () => {
    expect(src).toContain('parsed?.conflict'); expect(src).toContain("emit('reload')"); expect(src).toContain('data-reason-for'); expect(src).toMatch(/Boolean\(blocked\(a\)\)/)
    expect(src).toContain('issues'); expect(src).toContain('errors.atField')
  })
  it('requires 3+ char reason before acting, confirms destructive inline, waits for hydration', () => {
    expect(src).toContain('reason.value.trim().length < 3'); expect(src).toContain('SharedInlineConfirm'); expect(src).toContain('!hydrated.value')
    expect(src).toMatch(/destructive = \(a: LifecycleAction\) => a === 'delete' \|\| a === 'withdraw'/)
  })
})

describe('forms: explicit values', () => {
  it('plan form has no silent defaults for the choice fields', () => {
    const f = comp('PlanForm.vue')
    for (const k of ['auto_suspend', 'auto_renew_allowed', 'trial_days', 'grace_days']) expect(f).toContain(k)
    expect(f).toContain('vendor.pricing.plan.storageHint'); expect(f).toContain('vendor.pricing.plan.hq'); expect(f).toContain('policy?.timezone')
  })
  it('bundle form shows dependency hints and locked included features', () => {
    const f = comp('BundleForm.vue'); expect(f).toContain('dependencyHints'); expect(f).toContain('i-lucide-lock'); expect(f).toContain('hints.missing'); expect(f).toContain('hints.conflicts')
  })
  it('every field is wrapped in UFormField', () => { for (const f of ['BundleForm.vue', 'PlanForm.vue']) expect(comp(f)).toContain('<UFormField') })
})

describe('locale parity for vendor.bundles/plans/pricing', () => {
  it('ar and en have identical key sets', () => {
    for (const ns of ['bundles', 'plans', 'pricing']) expect(flat(json('ar')[ns]).sort()).toEqual(flat(json('en')[ns]).sort())
  })
  it('every status and cadence label exists in Arabic', () => {
    const ar = json('ar').pricing
    expect(ar.status).toEqual({ draft: 'مسودة', validated: 'جاهزة للاعتماد', published: 'منشورة ومتاحة', withdrawn: 'موقوفة' })
    expect(json('ar').bundles.title).toBe('الحزم'); expect(json('ar').plans.title).toBe('الباقات')
  })
  it('storage is labelled as counted attachments, not database', () => { expect(json('ar').pricing.keys.storage_limit_mb).toContain('المرفقات'); expect(json('ar').pricing.plan.storageHint).toContain('قاعدة البيانات') })
  it('every t() key used by the new pages exists', () => {
    const files = ['bundles/index.vue', 'bundles/new.vue', 'bundles/[id].vue', 'bundles/[id]/edit.vue', 'plans/index.vue', 'plans/new.vue', 'plans/[id].vue', 'plans/[id]/edit.vue'].map(page)
      .concat(['BundleForm.vue', 'PlanForm.vue', 'EntitlementSummary.vue', 'LifecyclePanel.vue', 'PriceListEditor.vue', 'CapacityLimitsEditor.vue', 'LimitControl.vue'].map(comp)).concat(read('../../packages/commercial-ui/app/components/shared/commerce/PriceBreakdown.vue'))
    const have = new Set(flat({ vendor: json('en'), commercial: commercial('en') }))
    const missing: string[] = []
    for (const src of files) for (const m of src.matchAll(/\bt\('((?:vendor|commercial)\.[a-zA-Z0-9_.]+)'/g)) if (!have.has(m[1]!)) missing.push(m[1]!)
    expect(missing).toEqual([])
  })
})
