import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

const PRODUCT_SECTIONS = ['nav.today', 'nav.tasks', 'nav.projects', 'nav.people', 'nav.reports']

describe('useNav', () => {
  it('employee sees exactly the five product sections', () => {
    expect(useNav('employee').map(i => i.labelKey)).toEqual(PRODUCT_SECTIONS)
  })

  it('people section routes to /hr', () => {
    expect(useNav('employee').find(i => i.labelKey === 'nav.people')?.to).toBe('/hr')
  })

  // The spec is explicit: nobody at the customer opens Odoo. customer_admin gets
  // an in-app Settings section in phase 3, not a link into the vendor console.
  it('customer_admin sees exactly the five product sections', () => {
    expect(useNav('admin').map(i => i.labelKey)).toEqual(PRODUCT_SECTIONS)
  })

  it('vendor gets the vendor console last', () => {
    const nav = useNav('vendor')
    expect(nav.map(i => i.labelKey)).toEqual([...PRODUCT_SECTIONS, 'nav.console'])
    expect(nav.at(-1)?.to).toBe('/odoo')
  })

  it('every item has a single-key shortcut for ⌘K', () => {
    for (const item of useNav('vendor')) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})
