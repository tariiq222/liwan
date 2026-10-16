import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = (p: string) => read(`app/pages/${p}`)
const json = (lang: string) => JSON.parse(read(`i18n/locales/${lang}/vendor.json`)).vendor
const flat = (o: unknown, prefix = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)])

describe('vendor commercial customers and invoices pages', () => {
  it('gates reads on vendor.read and terms/change on the manage capabilities', () => {
    for (const p of ['customers.vue', 'customers/index.vue', 'customers/[id].vue']) expect(page(p)).toContain("capability: 'vendor.read'")
    for (const p of ['invoices.vue', 'invoices/index.vue', 'invoices/[id].vue']) expect(page(p)).toContain("capability: 'vendor.billing.manage'")
    expect(page('customers/[id]/terms/new.vue')).toContain("capability: 'vendor.pricing.manage'")
    expect(page('customers/[id]/terms/new.vue')).toMatch(/can\('vendor\.pricing\.manage'\) && can\('vendor\.subscriptions\.manage'\)/)
    expect(page('customers/[id]/change.vue')).toContain("capability: 'vendor.subscriptions.manage'")
  })
  it('terms is a route-backed create panel that previews before vs after and requires a reason', () => {
    const p = page('customers/[id]/terms/new.vue')
    expect(p).toContain('SharedCreatePanel'); expect(p).toContain('customerQuote'); expect(p).toContain('terms.before'); expect(p).toContain('terms.after'); expect(p).toContain('SharedCommercePriceBreakdown')
    expect(read('app/components/vendor/CustomerTermsForm.vue')).toMatch(/reasonRequired/); expect(read('app/components/vendor/CustomerTermsForm.vue')).toContain('SharedUnsavedChanges'); expect(read('app/components/vendor/CustomerTermsForm.vue')).toContain('terms.isolation')
  })
  it('change subscription quotes then orders with an idempotency key from server ids only', () => {
    const p = page('customers/[id]/change.vue')
    expect(p).toContain('customerQuote'); expect(p).toContain('placeOrder'); expect(p).toContain('crypto.randomUUID()'); expect(p).toContain('quote.value.id')
  })
  it('keeps list filters in the URL and handles 404/501 as not available yet', () => {
    for (const p of ['customers/index.vue', 'invoices/index.vue']) { expect(page(p)).toContain('route.query'); expect(page(p)).toContain('isNotAvailable'); expect(page(p)).toContain('returnTo') }
    expect(page('customers/index.vue')).toMatch(/router\.replace\(\{ path: '\/customers'/)
  })
  it('customer profile has the required sections and hides technical ids under details', () => {
    const p = page('customers/[id].vue')
    for (const s of ['subscription', 'services', 'branches', 'usage', 'invoices', 'terms', 'audit']) expect(p).toContain(`sections.${s}`)
    expect(p.indexOf('view.id')).toBeGreaterThan(p.indexOf('<details'))
    expect(p).toContain('VendorEntitlementSummary'); expect(p).toContain('VendorUsageMeters')
  })
  it('invoices are labelled not official and show payment attempts and adjustments', () => {
    const p = page('invoices/[id].vue')
    expect(p).toContain('notOfficial'); expect(p).toContain('attempts'); expect(p).toContain('adjustments'); expect(p).toContain('SharedInvoiceLines')
  })
  it('overview computes commercial metrics from list endpoints, not price lists', () => {
    const p = page('overview.vue')
    expect(p).toContain('commercialMetrics'); expect(p).toContain('listCustomers'); expect(p).not.toMatch(/revenue|prices/)
  })
  it('uses logical properties only', () => {
    for (const p of ['customers/index.vue', 'customers/[id].vue', 'invoices/index.vue', 'invoices/[id].vue']) expect(page(p)).not.toMatch(/\b(ml|mr|pl|pr)-\d|\btext-left\b|\bleft-\d/)
  })
  it('ar and en carry the same new namespaces', () => {
    for (const ns of ['customers', 'invoices', 'overviewCommercial']) expect(flat(json('ar')[ns]).sort()).toEqual(flat(json('en')[ns]).sort())
  })
  it('change page never sends terms and only accepts non-preview quotes; terms page saves without accepting', () => {
    const c = page('customers/[id]/change.vue'); const n = page('customers/[id]/terms/new.vue'); const api = read('app/composables/useVendorSubscriptions.ts')
    expect(c).toContain('changeQuote'); expect(c).not.toMatch(/\bterms\b\s*[:,}]/); expect(c).toContain('.preview')
    expect(api).toContain('withoutDraftTerms(body)'); expect(api).toContain("'preview_quote'")
    expect(n).not.toContain('placeOrder'); expect(n).toContain('saveTerms'); expect(n).toContain('terms-saved')
  })
})
