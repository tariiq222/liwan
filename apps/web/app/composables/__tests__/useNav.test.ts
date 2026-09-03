import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

describe('useNav', () => {
  it('employee sees the five product sections and no settings', () => {
    const labels = useNav('employee').map(i => i.label)
    expect(labels).toEqual(['اليوم', 'مهامي', 'المشاريع', 'الأشخاص', 'التقارير'])
  })
  it('admin and vendor get a settings item last', () => {
    expect(useNav('admin').at(-1)?.label).toBe('الإعدادات')
    expect(useNav('vendor').at(-1)?.to).toBe('/odoo')
  })
  it('every item has a single-key shortcut for ⌘K', () => {
    for (const item of useNav('admin')) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})
