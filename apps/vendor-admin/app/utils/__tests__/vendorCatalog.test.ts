import { describe, expect, it } from 'vitest'
import { CATALOG_TABS, catalogTabOf } from '../vendorCatalog'

describe('catalogTabOf', () => {
  it('names the tab of every catalog path, lists, records and forms alike', () => {
    expect(catalogTabOf('/plans')?.key).toBe('plans')
    expect(catalogTabOf('/plans/new')?.key).toBe('plans')
    expect(catalogTabOf('/plans/p-1/edit/')?.key).toBe('plans')
    expect(catalogTabOf('/bundles/b-1')?.key).toBe('bundles')
    expect(catalogTabOf('/catalog/pkg-1')?.key).toBe('packages')
    expect(catalogTabOf('/catalog?status=draft')?.key).toBe('packages')
  })

  it('ignores paths outside the catalog and mere prefixes', () => {
    expect(catalogTabOf('/customers')).toBeNull()
    expect(catalogTabOf('/plansx')).toBeNull()
    expect(catalogTabOf('/')).toBeNull()
  })

  it('offers the three tabs in the fixed order', () => {
    expect(CATALOG_TABS.map(tab => tab.key)).toEqual(['plans', 'bundles', 'packages'])
  })
})
