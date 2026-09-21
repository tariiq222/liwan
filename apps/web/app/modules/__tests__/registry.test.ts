import { describe, expect, it } from 'vitest'
import { MeSchema } from '@nasq/contracts'
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
  it('lands a parsed task-reader identity with pmo enabled on /tasks', () => {
    const me = MeSchema.parse({
      id: 1, name: 'Admin', login: 'admin', email: '', lang: 'ar_001', tz: '',
      role: 'admin', company: { id: 1, name: 'nasq' },
      roles: [], capabilities: ['pmo.tasks.read'], access_policy_version: 1,
      modules: ['nasq_pmo'],
      entitlements: { 'pmo.enabled': true },
      platform: {
        schema_version: 1, policy_revision: 1, state: 'active',
        valid_until: null, read_only: false,
        readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'],
      },
      terminology: { ar: {}, en: {} },
    })
    expect(firstAllowedPath(me)).toBe('/tasks')
    expect(postLoginPath(me, undefined)).toBe('/tasks')
  })
  it('maps write routes to the owning feature', () => {
    expect(featureForPath('/projects/new')).toBe('pmo.enabled')
    expect(canUse(withdrawnPmo, 'pmo.projects.create', true)).toBe(false)
    expect(canUse(withdrawnPmo, 'meetings.create', true)).toBe(true)
  })
})
