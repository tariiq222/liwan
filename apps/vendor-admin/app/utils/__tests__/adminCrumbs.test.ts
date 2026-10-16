import { describe, expect, it } from 'vitest'
import { adminCrumbs } from '../adminCrumbs'
import { CATALOG_TABS, catalogTabOf } from '../vendorCatalog'

const catalog = { label: 'Catalog', to: '/plans' }
const bundlesTab = { label: 'Bundles', to: '/bundles' }

describe('adminCrumbs', () => {
  it('shows only the section, unlinked, on a landing page', () => {
    expect(adminCrumbs({ section: catalog, tab: null, title: 'Catalog' })).toEqual([{ label: 'Catalog', to: undefined }])
    expect(adminCrumbs({ section: catalog, tab: null, title: null })).toEqual([{ label: 'Catalog', to: undefined }])
  })

  it('links the section and the tab once the page is deeper, and ends on the title', () => {
    expect(adminCrumbs({ section: catalog, tab: bundlesTab, title: 'Starter bundle' })).toEqual([
      { label: 'Catalog', to: '/plans' }, { label: 'Bundles', to: '/bundles' }, { label: 'Starter bundle' },
    ])
  })

  it('keeps the section and the tab unlinked on a tab list page, whose title is the section name', () => {
    expect(adminCrumbs({ section: catalog, tab: bundlesTab, title: 'Catalog' })).toEqual([{ label: 'Catalog', to: undefined }, { label: 'Bundles', to: undefined }])
  })

  it('leaves the tab level out until it is known (before hydration)', () => {
    expect(adminCrumbs({ section: catalog, tab: null, title: null })).toEqual([{ label: 'Catalog', to: undefined }])
  })

  it('shows just the title when no section is active', () => {
    expect(adminCrumbs({ section: null, tab: null, title: 'Anything' })).toEqual([{ label: 'Anything' }])
    expect(adminCrumbs({ section: null, tab: bundlesTab, title: null })).toEqual([])
  })

  it('takes the tab level from the path: every catalog path has one, other sections none', () => {
    for (const tab of CATALOG_TABS) expect(catalogTabOf(`${tab.to}/x/edit`)).toBe(tab)
    expect(catalogTabOf('/customers/1')).toBeNull()
  })
})
