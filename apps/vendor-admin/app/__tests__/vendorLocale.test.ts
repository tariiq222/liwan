import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { invoiceLineSchema } from '@liwan/commercial-contracts'

const appRoot = resolve(import.meta.dirname, '..')
const localesRoot = resolve(appRoot, '../i18n/locales')
const layerLocales = resolve(appRoot, '../../../packages/commercial-ui/i18n/locales')

type Messages = { [key: string]: string | Messages }

function flatten(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`))
}

const load = (root: string, lang: string, file: string): string[] =>
  flatten(JSON.parse(readFileSync(join(root, lang, file), 'utf8')) as Messages)

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

const vendorKeys = { ar: new Set(load(localesRoot, 'ar', 'vendor.json')), en: new Set(load(localesRoot, 'en', 'vendor.json')) }
const commercialKeys = new Set(load(layerLocales, 'en', 'commercial.json'))

// Keys under these prefixes are chosen by a helper from a value the pages pass in.
const DECLARED_DYNAMIC_PREFIXES = ['vendor.invoices.status']

describe('vendor locale', () => {
  it('ships the same keys in ar and en', () => {
    expect([...vendorKeys.ar].sort()).toEqual([...vendorKeys.en].sort())
  })

  it('does not repeat a key the commercial layer owns', () => {
    expect([...vendorKeys.en].filter(key => commercialKeys.has(key))).toEqual([])
  })

  it('resolves every literal translation key used by the app', () => {
    const used = new Set<string>()
    for (const dir of ['pages', 'components', 'composables', 'utils']) {
      for (const file of sources(join(appRoot, dir))) {
        for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'((?:vendor|commercial)\.[A-Za-z0-9_.]*[A-Za-z0-9_])'/g)) used.add(match[1]!)
      }
    }
    expect([...used].filter(key => !vendorKeys.en.has(key) && !vendorKeys.ar.has(key) && !commercialKeys.has(key)).sort()).toEqual([])
  })

  it('has no key that nothing references', () => {
    const literals = new Set<string>()
    for (const dir of ['pages', 'components', 'composables', 'utils', 'middleware']) {
      for (const file of sources(join(appRoot, dir))) {
        for (const match of readFileSync(file, 'utf8').matchAll(/(vendor\.[A-Za-z0-9_.]*)/g)) literals.add(match[1]!)
      }
    }
    // A literal ending in "." is the prefix of a key built at run time (`vendor.x.${value}`); the declared prefixes are
    // passed to helpers as arguments and extended there.
    const prefixes = [...literals].filter(literal => literal.endsWith('.')).concat(DECLARED_DYNAMIC_PREFIXES.map(prefix => `${prefix}.`))
    const unused = [...vendorKeys.en].filter(key => !literals.has(key) && !prefixes.some(prefix => key.startsWith(prefix)))
    expect(unused.sort()).toEqual([])
  })

  it('names the section in the nav and its three tabs apart', () => {
    const nav = (lang: string) => (JSON.parse(readFileSync(join(localesRoot, lang, 'app.json'), 'utf8')) as { app: { nav: { catalog: string } } }).app.nav.catalog
    expect(nav('ar')).toBe('تطبيقات ليوان')
    expect(nav('en')).toBe('Liwan applications')
    const titles = (lang: string) => (JSON.parse(readFileSync(join(localesRoot, lang, 'vendor.json'), 'utf8')) as {
      vendor: { plans: { title: string }, bundles: { title: string }, catalog: { applications: string } }
    }).vendor
    for (const lang of ['ar', 'en']) {
      const v = titles(lang)
      expect(new Set([v.catalog.applications, v.plans.title, v.bundles.title]).size).toBe(3)
    }
    expect([titles('ar').catalog.applications, titles('ar').bundles.title, titles('ar').plans.title]).toEqual(['التطبيقات', 'الإضافات', 'الباقات'])
    expect([titles('en').catalog.applications, titles('en').bundles.title, titles('en').plans.title]).toEqual(['Applications', 'Add-ons', 'Plans'])
  })

  it('has a text in both languages for every invoice line kind the contract names', () => {
    for (const lang of ['ar', 'en'] as const) {
      const keys = lang === 'ar' ? vendorKeys.ar : vendorKeys.en
      expect(invoiceLineSchema.shape.kind.options.filter(kind => !keys.has(`vendor.invoices.lineKind.${kind}`)), lang).toEqual([])
    }
  })

  // The stages the control plane can put on an operation: the shared-job feed (operation-feed.ts: the job states and the
  // `shared_job_events` stages) and the legacy queue's own stages (worker.ts: the lease, the guards, the operator receipt
  // failures). A stage the operator's receipt names itself is open-ended and the pages show it as it is.
  const OPERATION_STAGES = [
    'queued', 'running', 'prepared', 'started', 'verified', 'needs_intervention', 'failed',
    'claimed', 'lease_expired', 'reconciliation_required', 'shared_execution_unavailable', 'grant_revoked', 'tenant_missing', 'target_not_authorized',
    'approval_revoked', 'receipt_unverified', 'worker_error', 'deployment_incomplete', 'operator_failed', 'operator_timeout',
    'operator_output_limit', 'operator_group_unconfirmed', 'operator_output_invalid',
  ]
  it('has a text in both languages for every operation stage the control plane can emit', () => {
    for (const lang of ['ar', 'en'] as const) {
      const keys = lang === 'ar' ? vendorKeys.ar : vendorKeys.en
      expect(OPERATION_STAGES.filter(stage => !keys.has(`vendor.operations.stages.${stage}`)), lang).toEqual([])
    }
  })
})
