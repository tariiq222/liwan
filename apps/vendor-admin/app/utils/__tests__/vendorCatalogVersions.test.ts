import { describe, expect, it } from 'vitest'
import ar from '../../../i18n/locales/ar/vendor.json'
import en from '../../../i18n/locales/en/vendor.json'
import { catalogActionErrorKey, catalogActionPath, currentCatalogVersion, nextCatalogAction, publishedVersions, sellableTiers, type CatalogVersion } from '../vendorCatalogVersions'

const version = (status: CatalogVersion['status'], tiers: NonNullable<CatalogVersion['solution']['tiers']> = [], id = `c-${status}`): CatalogVersion => ({ id, version: '2026.11', status, created_at: '2026-11-01T08:00:00Z', solution: { tiers } })

describe('nextCatalogAction', () => {
  it('publishes a validated version and has no step after publishing', () => {
    expect(nextCatalogAction('validated')).toBe('publish')
    expect(nextCatalogAction('published')).toBeNull()
  })
})

describe('currentCatalogVersion', () => {
  it('prefers the newest published version over a newer import still waiting for publishing', () => {
    const offer = currentCatalogVersion([version('validated', [], 'new-import'), version('published', [], 'offer')])
    expect(offer?.id).toBe('offer')
  })
  it('falls back to the newest import when nothing is published yet', () => {
    expect(currentCatalogVersion([version('validated', [], 'newest'), version('validated', [], 'older')])?.id).toBe('newest')
  })
  it('answers null for an empty list', () => {
    expect(currentCatalogVersion([])).toBeNull()
  })
})

describe('sellableTiers', () => {
  it('lists only the applications flagged for sale and never core', () => {
    const tiers = [{ id: 'core', name: 'Core', sellable: true }, { id: 'crm', name: 'CRM', sellable: true }, { id: 'hr', name: 'HR', sellable: false }, { id: 'chat', name: 'Chat' }]
    expect(sellableTiers(version('validated', tiers)).map(tier => tier.id)).toEqual(['crm'])
  })
  it('sells nothing when a version declares no tiers', () => {
    expect(sellableTiers({ solution: {} })).toEqual([])
  })
})

describe('publishedVersions', () => {
  it('keeps only published versions, in the order the server sent them', () => {
    expect(publishedVersions([version('validated', [], 'a'), version('published', [], 'b'), version('published', [], 'c')]).map(item => item.id)).toEqual(['b', 'c'])
  })
})

describe('catalogActionPath', () => {
  it('addresses the step of one entry', () => {
    expect(catalogActionPath('a/b', 'publish')).toBe('catalog/a%2Fb/publish')
  })
})

describe('catalogActionErrorKey', () => {
  it('names the codes of the publish route in both languages', () => {
    for (const [code, key] of [['conflict', 'vendor.catalog.errors.conflict'], ['catalog_invalid', 'vendor.catalog.errors.catalog_invalid'], ['catalog_source_not_publishable', 'vendor.pricing.errors.catalog_source_not_publishable'], ['not_found', 'vendor.pricing.errors.not_found'], ['step_up_required', 'vendor.pricing.errors.step_up_required'], ['boom', 'vendor.pricing.errors.generic']]) {
      const resolved = catalogActionErrorKey({ data: { code } })
      expect(resolved, code).toBe(key)
      for (const locale of [ar, en]) expect(resolved.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale), `${code} ${resolved}`).toBeTruthy()
    }
  })
})
