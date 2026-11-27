import { describe, expect, it } from 'vitest'
import { publishedVersions, sellableTiers, type CatalogVersion } from '../vendorCatalogVersions'

const version = (status: CatalogVersion['status'], tiers: NonNullable<CatalogVersion['solution']['tiers']> = []): CatalogVersion => ({ id: `c-${status}`, version: '2026.11', status, created_at: '2026-11-01T08:00:00Z', solution: { tiers } })

describe('sellableTiers', () => {
  it('lists only the applications flagged for sale and never core', () => {
    const tiers = [{ id: 'core', name: 'Core', sellable: true }, { id: 'crm', name: 'CRM', sellable: true }, { id: 'hr', name: 'HR', sellable: false }, { id: 'chat', name: 'Chat' }]
    expect(sellableTiers(version('draft', tiers)).map(tier => tier.id)).toEqual(['crm'])
  })
  it('sells nothing when a version declares no tiers', () => {
    expect(sellableTiers({ solution: {} })).toEqual([])
  })
})

describe('publishedVersions', () => {
  it('keeps only published versions', () => {
    expect(publishedVersions([version('draft'), version('validated'), version('published')]).map(item => item.status)).toEqual(['published'])
  })
})
