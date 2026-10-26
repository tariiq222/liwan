import { describe, expect, it } from 'vitest'
import { canReachPath } from '../../../utils/accessPolicy'
import { useNav, visibleSettingsPages } from '../../../composables/nav/shellModules'

// D-6: the payroll settings card is opened by hr.payroll.read (editing stays hr.payroll.config, enforced by the page's
// canEdit and by the server). Without payroll read, or with the hr.payroll sub-feature off, it stays closed.
const FEATURES = ['hr.enabled', 'hr.payroll']
const identity = (capabilities: string[], features = FEATURES) => ({ capabilities, platform: { readable_features: features, writable_features: features } })
const hrParts = (id: ReturnType<typeof identity>) => visibleSettingsPages(id).find(({ page }) => page.id === 'hr')?.parts.map(part => part.id) ?? []
const navTargets = (id: ReturnType<typeof identity>) => useNav(id).map(item => item.to)

describe('payroll settings entry points', () => {
  it('open the card, the settings link and the page to a payroll reader without config', () => {
    const reader = identity(['hr.payroll.read'])
    expect(hrParts(reader)).toEqual(['payroll'])
    expect(canReachPath(reader, '/settings/apps/hr')).toBe(true)
    expect(canReachPath(reader, '/settings/apps/hr#payroll')).toBe(true)
    expect(navTargets(reader)).toContain('/settings/apps/hr#payroll')
  })

  it('stay closed without payroll read, even for an HR employee reader', () => {
    const other = identity(['hr.employees.read'])
    expect(hrParts(other)).toEqual([])
    expect(canReachPath(other, '/settings/apps/hr')).toBe(false)
    expect(navTargets(other)).not.toContain('/settings/apps/hr#payroll')
  })

  it('stay closed when the hr.payroll sub-feature is off', () => {
    const reader = identity(['hr.payroll.read', 'hr.payroll.config'], ['hr.enabled'])
    expect(hrParts(reader)).toEqual([])
    expect(canReachPath(reader, '/settings/apps/hr')).toBe(false)
  })

  it('leave the other HR cards to their own capabilities', () => {
    expect(hrParts(identity(['hr.payroll.read', 'hr.leave.config']))).toEqual(['leave', 'payroll'])
  })
})
