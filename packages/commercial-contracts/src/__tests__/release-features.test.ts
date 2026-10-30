import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveCatalogPolicy, releaseModules, parseFeatureDescriptor } from '../commercial/feature-descriptor.js'

type Case = { name: string; catalog: unknown; tier: string; modules: string[]; features: Record<string, boolean | number | null> }
const fixture = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/fixtures/release_features.json', import.meta.url), 'utf8')) as { cases: Case[] }

describe('release-complete derivation (same file as tools/test_managed_policy.py)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const policy = deriveCatalogPolicy(c.catalog, c.tier)
      expect(policy.modules).toEqual(c.modules)
      expect(policy.features).toEqual(c.features)
    })
  }
  it('lists the release modules once, base first', () => {
    expect(releaseModules(fixture.cases[0]!.catalog)).toEqual(['liwan_core', 'liwan_platform', 'liwan_api', 'liwan_pmo', 'liwan_meetings', 'liwan_hr'])
  })
  it('accepts a ceiling under schema 3 and refuses schema 4', () => {
    expect(parseFeatureDescriptor('limit:a.b:3', 3).value).toBe(3)
    expect(() => parseFeatureDescriptor('limit:a.b', 4)).toThrow('catalog_invalid')
  })
})
