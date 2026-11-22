import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keyLabel } from '../utils/vendorCommercial'

const vendor = (lang: 'ar' | 'en') => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../i18n/locales/${lang}/vendor.json`), 'utf8')).vendor
const solutions = resolve(import.meta.dirname, '../../../../deploy/catalog/solutions')
const newest = readdirSync(solutions).filter(name => /^platform_v\d+\.json$/.test(name)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0])).at(-1)!
// A descriptor is `boolean:<key>`, `limit:<key>` or `limit:<key>:<ceiling>`; the console labels the key.
const keys = [...new Set((JSON.parse(readFileSync(resolve(solutions, newest), 'utf8')).tiers as { features: string[] }[]).flatMap(tier => tier.features.map(descriptor => descriptor.split(':')[1]!)))]

describe.each(['ar', 'en'] as const)('feature and limit texts (%s)', lang => {
  const texts = vendor(lang).pricing.keys as Record<string, string>
  it(`has a text for every feature and limit of ${newest}`, () => {
    expect(keys.length).toBeGreaterThan(50)
    expect(keys.filter(key => !texts[key.replace(/\./g, '_')]?.trim())).toEqual([])
  })
  it('keeps one namespace for the labels: the operations pages and the policy comparison read pricing.keys through keyLabel', () => {
    expect(vendor(lang).features).toBeUndefined()
    expect(keyLabel('crm.import', path => `T:${path}`, () => true)).toBe('T:vendor.pricing.keys.crm_import')
  })
})
