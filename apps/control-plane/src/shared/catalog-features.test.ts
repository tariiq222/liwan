import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogInvalidError, DESCRIPTOR_GRAMMAR_V2, parseCatalogTiers, parseFeatureDescriptor } from '@nasq/commercial-contracts'
import { deriveFeatures } from './catalog-features.js'
import { deriveSharedPolicy } from './job-store.js'
import { derivePackagePolicy } from '../packages.js'

const root = join(import.meta.dirname, '../../../..')
const read = (name: string) => JSON.parse(readFileSync(join(root, 'deploy/catalog/solutions', name), 'utf8'))

const fixture = JSON.parse(readFileSync(join(root, 'deploy/catalog/fixtures/descriptor_parity.json'), 'utf8')) as {
  grammar_v2: string; cases: Array<{ name: string; catalog: any; expect: 'accept' | 'reject'; error?: string; runtimes?: string[] }>
}

describe('shared descriptor parity fixture (same file as tools/test_managed_policy.py)', () => {
  it('grammar constant equals the fixture string', () => { expect(DESCRIPTOR_GRAMMAR_V2).toBe(fixture.grammar_v2) })
  it('python-only cases are explicitly flagged and documented', () => {
    const skipped = fixture.cases.filter(c => c.runtimes && !c.runtimes.includes('ts'))
    expect(skipped.map(c => c.name)).toEqual(['schema_version_float_2_0'])
  })
  for (const c of fixture.cases.filter(c => !c.runtimes || c.runtimes.includes('ts'))) {
    it(`${c.expect}: ${c.name}`, () => {
      const run = () => deriveFeatures(c.catalog, { id: c.catalog.tiers?.[0]?.id ?? 'core' })
      const all = () => parseCatalogTiers(c.catalog)
      if (c.expect === 'accept') { expect(all).not.toThrow(); expect(run).not.toThrow() }
      else expect(all).toThrow(expect.objectContaining({ code: c.error }))
    })
  }
})

describe('catalog feature descriptor grammar', () => {
  it('parses three-part limits as explicit ceilings, 0 verbatim (schema 2)', () => {
    expect(parseFeatureDescriptor('limit:branches.extra_limit:0', 2)).toEqual({ key: 'branches.extra_limit', kind: 'limit', value: 0 })
    expect(parseFeatureDescriptor('limit:users.limit:25', 2).value).toBe(25)
  })
  it('keeps two-part semantics', () => {
    expect(parseFeatureDescriptor('limit:users.limit', 1).value).toBeNull()
    expect(parseFeatureDescriptor('boolean:pmo.enabled', 2).value).toBe(true)
  })
  it.each(['limit:a.b:1:2', 'limit:a.b:-1', 'limit:a.b:x', 'limit:a.b:1.5', 'limit:a.b:01', 'limit:a.b:2000000000', 'boolean:a.b:1', 'limit:nodot', 'limit:a.b:'])('rejects %s as catalog_invalid', (entry) => {
    expect(() => parseFeatureDescriptor(entry, 2)).toThrow(CatalogInvalidError)
  })
  it('refuses a numeric ceiling under schema 1 and unknown schemas', () => {
    expect(() => parseFeatureDescriptor('limit:a.b:1', 1)).toThrow(CatalogInvalidError)
    expect(() => parseFeatureDescriptor('limit:a.b', 3)).toThrow(CatalogInvalidError)
  })
})

describe('policy derivation per catalog version', () => {
  it('legacy bytes still derive the two-limit policy (platform.json)', () => {
    const policy = deriveSharedPolicy(read('platform.json'), 'core')
    expect(policy.features).toEqual({ 'users.limit': null, 'storage.limit_mb': null })
  })
  it('v2 bytes derive the complete policy including branches.extra_limit=0', () => {
    const policy = deriveSharedPolicy(read('platform_v2.json'), 'core')
    expect(policy.features).toEqual({ 'users.limit': null, 'storage.limit_mb': null, 'branches.extra_limit': 0 })
    expect(deriveSharedPolicy(read('platform_v2.json'), 'projects').features['branches.extra_limit']).toBe(0)
  })
  it('legacy catalog without tiers inheriting is unchanged for non-core tiers', () => {
    const legacy = read('platform.json')
    expect(deriveFeatures(legacy, legacy.tiers[1]).features).toEqual({ 'users.limit': null, 'storage.limit_mb': null, 'pmo.enabled': true, 'meetings.enabled': true, 'projects.max_projects': null })
  })
  it('malformed four-part descriptor throws catalog_feature_invalid', () => {
    const bad = { ...read('platform_v2.json'), tiers: [{ id: 'core', modules: [], features: ['limit:users.limit:1:2'] }] }
    expect(() => deriveSharedPolicy(bad, 'core')).toThrow('catalog_invalid')
  })
  it('rejects cases the Python gate rejects (parity)', () => {
    const v2 = read('platform_v2.json')
    const tierOf = (features: string[]) => ({ id: 'core', modules: [], features })
    // Duplicate core keys overwrite silently otherwise.
    expect(() => deriveFeatures({ ...v2, tiers: [tierOf(['limit:users.limit:5', 'limit:users.limit:7'])] }, tierOf(['limit:users.limit:5', 'limit:users.limit:7']))).toThrow('catalog_invalid')
    // Schema-1 bytes never carry numeric ceilings.
    expect(() => deriveFeatures({ ...read('platform.json'), tiers: [tierOf(['limit:users.limit:5'])] }, tierOf(['limit:users.limit:5']))).toThrow('catalog_invalid')
    // Unknown schema versions refuse outright.
    expect(() => deriveFeatures({ ...v2, schema_version: 3 }, v2.tiers[0])).toThrow('catalog_invalid')
    // Schema-2 core must declare both required platform limits.
    expect(() => deriveFeatures({ ...v2, tiers: [tierOf(['limit:users.limit:5'])] }, tierOf(['limit:users.limit:5']))).toThrow('catalog_invalid')
    // The required limits are limits, never booleans.
    expect(() => deriveFeatures({ ...v2, tiers: [tierOf(['boolean:users.limit', 'limit:storage.limit_mb'])] }, tierOf(['boolean:users.limit', 'limit:storage.limit_mb']))).toThrow('catalog_invalid')
  })
  it('package policy: catalog ceiling is not operator-overridable; limits cover only null keys', () => {
    const v2 = read('platform_v2.json')
    const ok = derivePackagePolicy(v2, 'core', { 'users.limit': 5, 'storage.limit_mb': 100 })
    expect(ok.features['branches.extra_limit']).toBe(0)
    expect(() => derivePackagePolicy(v2, 'core', { 'users.limit': 5, 'storage.limit_mb': 100, 'branches.extra_limit': 3 })).toThrow('package_limits_invalid')
    expect(() => derivePackagePolicy(v2, 'core', { 'users.limit': 5 })).toThrow('package_limits_invalid')
  })
})
