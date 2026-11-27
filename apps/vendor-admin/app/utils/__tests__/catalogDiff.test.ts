import { describe, expect, it } from 'vitest'
import { catalogDiff, catalogDiffSummary, parseFeature, type CatalogDiff } from '../catalogDiff'
import type { CatalogVersion, CatalogVersionTier } from '../vendorCatalogVersions'

const tier = (id: string, over: Partial<CatalogVersionTier> = {}): CatalogVersionTier => ({ id, name: id, ...over })
const version = (tiers: CatalogVersionTier[], baseModules: string[] = ['liwan_core']): CatalogVersion => ({ id: 'v', version: '2026.12', status: 'validated', created_at: '2026-12-01T00:00:00Z', solution: { base_modules: baseModules, tiers } })
const app = (diff: CatalogDiff, id: string) => diff.apps.find(item => item.appId === id)

describe('parseFeature', () => {
  it('reads the descriptor grammar the same way the shared parser does', () => {
    expect(parseFeature('boolean:crm.enabled')).toEqual({ raw: 'boolean:crm.enabled', kind: 'boolean', key: 'crm.enabled' })
    expect(parseFeature('limit:crm.records:100')).toEqual({ raw: 'limit:crm.records:100', kind: 'limit', key: 'crm.records', ceiling: 100 })
    expect(parseFeature('limit:crm.records')).toEqual({ raw: 'limit:crm.records', kind: 'limit', key: 'crm.records' })
  })

  it('keeps anything the parser refuses opaque instead of throwing', () => {
    for (const raw of ['not a descriptor', 'limit:crm.records:lots', '', 'BOOL:crm.enabled']) {
      expect(() => parseFeature(raw), raw).not.toThrow()
      expect(parseFeature(raw), raw).toEqual({ raw, kind: 'opaque' })
    }
  })
})

describe('catalogDiff applications', () => {
  it('reports the applications one version adds and the ones it drops', () => {
    const diff = catalogDiff(version([tier('crm'), tier('hr')]), version([tier('hr'), tier('inbox')]))
    expect(diff.appsAdded).toEqual(['crm'])
    expect(diff.appsRemoved).toEqual(['inbox'])
    expect(app(diff, 'hr')).toBeUndefined()
    const crm = app(diff, 'crm')!
    expect(crm.added).toBe(true)
    expect(crm.featuresAdded).toEqual([])
    expect(crm.modulesAdded).toEqual([])
  })

  it('treats the first version as every application added', () => {
    const diff = catalogDiff(version([tier('crm', { features: ['boolean:crm.enabled'], modules: ['liwan_crm'] })], ['liwan_core', 'liwan_crm']), undefined)
    expect(diff.appsAdded).toEqual(['crm'])
    expect(diff.appsRemoved).toEqual([])
    expect(diff.baseModulesAdded).toEqual(['liwan_core', 'liwan_crm'])
    expect(diff.baseModulesRemoved).toEqual([])
    expect(app(diff, 'crm')).toMatchObject({ added: true, featuresAdded: [{ raw: 'boolean:crm.enabled', kind: 'boolean', key: 'crm.enabled' }], modulesAdded: ['liwan_crm'], modulesRemoved: [] })
  })

  it('has nothing to compare when neither version is given', () => {
    expect(catalogDiff(undefined, undefined)).toEqual({ appsAdded: [], appsRemoved: [], baseModulesAdded: [], baseModulesRemoved: [], apps: [] })
    expect(catalogDiff(version([]), undefined).appsAdded).toEqual([])
  })

  it('reports every application removed when the newer version is missing', () => {
    const diff = catalogDiff(undefined, version([tier('crm')], ['liwan_core']))
    expect(diff.appsRemoved).toEqual(['crm'])
    expect(diff.baseModulesRemoved).toEqual(['liwan_core'])
  })
})

describe('catalogDiff features and limits', () => {
  it('reports the feature descriptors one version adds and removes', () => {
    const diff = catalogDiff(
      version([tier('crm', { features: ['boolean:crm.enabled', 'boolean:crm.api'] })]),
      version([tier('crm', { features: ['boolean:crm.enabled', 'boolean:crm.export'] })]),
    )
    expect(app(diff, 'crm')!.featuresAdded.map(feature => feature.raw)).toEqual(['boolean:crm.api'])
    expect(app(diff, 'crm')!.featuresRemoved.map(feature => feature.raw)).toEqual(['boolean:crm.export'])
  })

  it('reports a changed ceiling from the limit descriptor and from the limits map alike', () => {
    const fromDescriptor = catalogDiff(version([tier('crm', { features: ['limit:crm.records:500'] })]), version([tier('crm', { features: ['limit:crm.records:100'] })]))
    expect(app(fromDescriptor, 'crm')!.limitChanges).toEqual([{ key: 'crm.records', from: 100, to: 500 }])
    const fromMap = catalogDiff(version([tier('crm', { limits: { 'crm.records': 500 } })]), version([tier('crm', { limits: { 'crm.records': 100 } })]))
    expect(app(fromMap, 'crm')!.limitChanges).toEqual([{ key: 'crm.records', from: 100, to: 500 }])
  })

  it('reads a descriptor without a number against the recorded value and reports dropping the value', () => {
    const kept = catalogDiff(version([tier('crm', { limits: { 'crm.records': 500 }, features: ['limit:crm.records'] })]), version([tier('crm', { limits: { 'crm.records': 100 }, features: ['limit:crm.records'] })]))
    expect(app(kept, 'crm')!.limitChanges).toEqual([{ key: 'crm.records', from: 100, to: 500 }])
    const dropped = catalogDiff(version([tier('crm', { features: ['limit:crm.records'] })]), version([tier('crm', { limits: { 'crm.records': 100 } })]))
    expect(app(dropped, 'crm')!.limitChanges).toEqual([{ key: 'crm.records', from: 100, to: undefined }])
    const undeclared = catalogDiff(version([tier('crm')]), version([tier('crm', { features: ['limit:crm.records'] })]))
    expect(app(undeclared, 'crm')!.featuresRemoved.map(feature => feature.raw)).toEqual(['limit:crm.records'])
    expect(app(undeclared, 'crm')!.limitChanges).toEqual([])
  })

  it('reports a sellable flip and stays quiet when the flag does not move, including two absences', () => {
    const flipped = catalogDiff(version([tier('crm', { sellable: true })]), version([tier('crm', { sellable: false })]))
    expect(app(flipped, 'crm')).toMatchObject({ sellableFrom: false, sellableTo: true })
    expect(catalogDiff(version([tier('crm', { sellable: true })]), version([tier('crm', { sellable: true })])).apps).toEqual([])
    expect(catalogDiff(version([tier('crm')]), version([tier('crm')])).apps).toEqual([])
  })

  it('compares an unparsable descriptor as an opaque string without throwing', () => {
    const diff = catalogDiff(
      version([tier('crm', { features: ['not a descriptor', 'limit:crm.records:lots'] })]),
      version([tier('crm', { features: ['not a descriptor'] })]),
    )
    expect(app(diff, 'crm')!.featuresAdded.map(feature => [feature.raw, feature.kind])).toEqual([['limit:crm.records:lots', 'opaque']])
    expect(app(diff, 'crm')!.featuresRemoved).toEqual([])
    expect(catalogDiff(version([tier('crm', { features: ['not a descriptor'] })]), version([tier('crm', { features: ['not a descriptor'] })])).apps).toEqual([])
  })
})

describe('catalogDiff modules', () => {
  it('reports the modules one application adds and removes', () => {
    const diff = catalogDiff(
      version([tier('crm', { modules: ['liwan_crm', 'liwan_crm_api'] })]),
      version([tier('crm', { modules: ['liwan_crm', 'liwan_crm_report'] })]),
    )
    expect(app(diff, 'crm')).toMatchObject({ modulesAdded: ['liwan_crm_api'], modulesRemoved: ['liwan_crm_report'] })
  })

  it('reports the base modules the whole catalog adds and removes', () => {
    const diff = catalogDiff(version([], ['liwan_core', 'liwan_crm']), version([], ['liwan_core', 'liwan_pmo']))
    expect(diff.baseModulesAdded).toEqual(['liwan_crm'])
    expect(diff.baseModulesRemoved).toEqual(['liwan_pmo'])
  })
})

describe('catalogDiffSummary', () => {
  it('counts only the changed families, in the fixed chip order', () => {
    const diff = catalogDiff(
      version([tier('crm', { features: ['boolean:crm.enabled', 'limit:crm.records:100'], modules: ['liwan_crm'] }), tier('pmo', { sellable: true, modules: ['liwan_pmo'] })], ['liwan_core', 'liwan_crm']),
      version([tier('pmo', { sellable: false, modules: ['liwan_pmo'] })], ['liwan_core']),
    )
    expect(catalogDiffSummary(diff)).toEqual([
      { key: 'appsAdded', count: 1 },
      { key: 'featuresAdded', count: 2 },
      { key: 'sellableChanged', count: 1 },
      { key: 'modulesChanged', count: 2 },
    ])
  })

  it('answers an empty summary when nothing changed', () => {
    expect(catalogDiffSummary(catalogDiff(version([tier('crm')]), version([tier('crm')])))).toEqual([])
  })
})
