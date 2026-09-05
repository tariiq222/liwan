import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

const PRODUCT_SECTIONS = ['nav.tasks', 'nav.projects', 'nav.people']

describe('useNav', () => {
  it('employee sees exactly the three product sections', () => {
    expect(useNav('employee').map(i => i.labelKey)).toEqual(PRODUCT_SECTIONS)
  })

  it('people section routes to /hr', () => {
    expect(useNav('employee').find(i => i.labelKey === 'nav.people')?.to).toBe('/hr')
  })

  // Phase 3a: customer_admin gets an in-app Settings section for project
  // administration, but never a link into the vendor console.
  it('customer_admin sees the three product sections plus Settings', () => {
    expect(useNav('admin').map(i => i.labelKey)).toEqual([...PRODUCT_SECTIONS, 'nav.settings'])
  })

  it('vendor gets Settings and the vendor console last', () => {
    const nav = useNav('vendor')
    expect(nav.map(i => i.labelKey)).toEqual([...PRODUCT_SECTIONS, 'nav.settings', 'nav.console'])
    expect(nav.at(-1)?.to).toBe('/odoo')
  })

  it('every item has a single-key shortcut for ⌘K', () => {
    for (const item of useNav('vendor')) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})
