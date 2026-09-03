import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

const PRODUCT_SECTIONS = ['اليوم', 'مهامي', 'المشاريع', 'الأشخاص', 'التقارير']

describe('useNav', () => {
  it('employee sees exactly the five product sections', () => {
    expect(useNav('employee').map(i => i.label)).toEqual(PRODUCT_SECTIONS)
  })

  // The spec is explicit: nobody at the customer opens Odoo. customer_admin gets
  // an in-app Settings section in phase 3, not a link into the vendor console.
  it('customer_admin sees exactly the five product sections', () => {
    expect(useNav('admin').map(i => i.label)).toEqual(PRODUCT_SECTIONS)
  })

  it('vendor gets the vendor console last', () => {
    const nav = useNav('vendor')
    expect(nav.map(i => i.label)).toEqual([...PRODUCT_SECTIONS, 'وحدة التحكم'])
    expect(nav.at(-1)?.to).toBe('/odoo')
  })

  it('every item has a single-key shortcut for ⌘K', () => {
    for (const item of useNav('vendor')) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})
