import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

const pageFiles = sources(join(appRoot, 'pages')).filter(file => file.endsWith('.vue'))
const allFiles = ['pages', 'components', 'composables', 'utils'].flatMap(dir => sources(join(appRoot, dir)))

// Pages that sign people in or enroll them are public: they declare no capability.
const PUBLIC_PAGES = ['enroll.vue', 'login.vue']

// Every other page needs vendor.read unless it is listed here.
const STRICTER: Record<string, string> = {
  'audit.vue': 'vendor.audit.read',
  'bundles/[id]/edit.vue': 'vendor.catalog.manage',
  'bundles/new.vue': 'vendor.catalog.manage',
  'customers/[id]/change.vue': 'vendor.subscriptions.manage',
  'customers/new.vue': 'vendor.tenants.manage',
  'customers/[id]/terms/new.vue': 'vendor.pricing.manage',
  'analytics.vue': 'vendor.billing.manage',
  'invoices.vue': 'vendor.billing.manage',
  'invoices/[id].vue': 'vendor.billing.manage',
  'invoices/index.vue': 'vendor.billing.manage',
  'plans/[id]/edit.vue': 'vendor.catalog.manage',
  'plans/new.vue': 'vendor.catalog.manage',
  'team.vue': 'vendor.accounts.manage',
  'team/index.vue': 'vendor.accounts.manage',
  'team/new.vue': 'vendor.accounts.manage',
}

describe('vendor admin routes', () => {
  it('finds the moved pages', () => {
    expect(pageFiles.length).toBeGreaterThan(20)
  })

  it('has no page path literal under the old /vendor prefix', () => {
    const offenders = allFiles.filter(file => /['"`]\/vendor[/'"`?]/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('gates every page with a capability or marks it public', () => {
    const missing = pageFiles.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return !/definePageMeta\(\{[^}]*\b(capability: '[a-z.]+'|public: true)/.test(source)
    })
    expect(missing).toEqual([])
  })

  it('requires the expected capability on each page', () => {
    const pagesRoot = join(appRoot, 'pages')
    const actual = Object.fromEntries(pageFiles.map((file) => {
      const name = file.slice(pagesRoot.length + 1)
      return [name, /definePageMeta\(\{[^}]*\bcapability: '([a-z.]+)'/.exec(readFileSync(file, 'utf8'))?.[1]]
    }))
    const expected = Object.fromEntries(Object.keys(actual).map(name => [name, PUBLIC_PAGES.includes(name) ? undefined : (STRICTER[name] ?? 'vendor.read')]))
    expect(actual).toEqual(expected)
    expect(Object.keys(STRICTER).filter(name => !(name in actual))).toEqual([])
  })

  it('has no leftover vendor middleware meta', () => {
    const offenders = allFiles.filter(file => /vendorCapability|middleware: 'vendor'/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
