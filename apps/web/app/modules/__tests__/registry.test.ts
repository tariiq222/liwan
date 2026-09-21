import { describe, expect, it } from 'vitest'
import { canUse, featureForPath, hasFeature } from '../registry'
import { firstAllowedPath, postLoginPath } from '../../utils/accessPolicy'
import { useNav } from '../../composables/nav/shellModules'

const caps = ['pmo.tasks.read', 'pmo.projects.read', 'meetings.read', 'hr.employees.read']
const withdrawnPmo = {
  role: 'employee',
  capabilities: caps,
  modules: ['nasq_pmo', 'nasq_hr'],
  entitlements: { 'pmo.enabled': false, 'meetings.enabled': true, 'hr.enabled': true, 'chat.enabled': false },
  platform: {
    readable_features: ['meetings.enabled', 'hr.enabled'],
    writable_features: ['meetings.enabled', 'hr.enabled'],
  },
}

describe('module registry', () => {
  it('hides withdrawn project navigation while keeping meetings', () => {
    expect(hasFeature(withdrawnPmo, 'pmo.enabled')).toBe(false)
    expect(useNav(withdrawnPmo).map(item => item.to)).toEqual([
      '/meetings', '/meetings/calendar', '/meetings/series', '/hr',
    ])
    expect(firstAllowedPath(withdrawnPmo)).toBe('/meetings')
    expect(postLoginPath(withdrawnPmo, '/projects')).toBe('/meetings')
  })
  it('does not hide modules when the payload has no tenant policy', () => {
    expect(useNav({ capabilities: caps }).map(item => item.to)).toContain('/projects')
  })
  it('maps write routes to the owning feature', () => {
    expect(featureForPath('/projects/new')).toBe('pmo.enabled')
    expect(canUse(withdrawnPmo, 'pmo.projects.create', true)).toBe(false)
    expect(canUse(withdrawnPmo, 'meetings.create', true)).toBe(true)
  })
})
