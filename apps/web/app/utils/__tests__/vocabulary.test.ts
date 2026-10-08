import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const load = (locale: string, file: string) => JSON.parse(readFileSync(resolve(root, `i18n/locales/${locale}/${file}.json`), 'utf8'))
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}
// Every locale file a customer sees (vendor.json is the vendor console).
const CUSTOMER_FILES = ['subscription', 'common', 'settings', 'access', 'invite']

describe('owner decision O2: «باقة» is the plan, «حزمة» is a vendor-only bundle', () => {
  it('no customer string says «حزمة» or bundle/package', () => {
    const offending = CUSTOMER_FILES.flatMap(file => [
      ...strings(load('ar', file)).filter(([, v]) => /حزم/.test(v)).map(([k]) => `ar/${file}:${k}`),
      ...strings(load('en', file)).filter(([, v]) => /\b(bundle|package)s?\b/i.test(v)).map(([k]) => `en/${file}:${k}`),
    ])
    expect(offending).toEqual([])
  })
  it('the vendor console names plans and bundles once each, and the legacy page apart', () => {
    for (const locale of ['ar', 'en']) {
      const v = load(locale, 'vendor').vendor
      const titles = [v.plans.title, v.bundles.title, v.packages.title]
      expect(new Set(titles).size).toBe(3)
      expect(v.catalog.title).toBe(v.packages.title)
    }
    expect(load('ar', 'vendor').vendor.plans.title).toBe('الباقات')
    expect(load('ar', 'vendor').vendor.bundles.title).toBe('الحزم')
    expect(load('en', 'vendor').vendor.plans.title).toBe('Plans')
    expect(load('en', 'vendor').vendor.bundles.title).toBe('Bundles')
  })
})
