import { describe, expect, it } from 'vitest'
import { visibleSettingsPages } from '../../composables/nav/shellModules'
import { canReachPath, requiredCapabilityForPath } from '../accessPolicy'

describe('branch delegation settings', () => {
  it('requires role assignment permission on both policy and per-user delegation pages', () => {
    for (const path of ['/settings/team/branches', '/settings/team/users/4/branches']) {
      expect(requiredCapabilityForPath(path)).toBe('access.users.assign_roles')
      expect(canReachPath({ capabilities: ['access.users.read'] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['access.users.assign_roles'] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['access.users.assign_roles', 'access.roles.read'] }, path)).toBe(true)
    }
  })

  it('opens the branches page for company administration alone, but never the per-user delegation page', () => {
    const creator = { capabilities: ['settings.company.manage'] }
    expect(canReachPath(creator, '/settings/team/branches')).toBe(true)
    expect(canReachPath(creator, '/settings/team/users/4/branches')).toBe(false)
    expect(canReachPath({ capabilities: ['settings.company.read'] }, '/settings/team/branches')).toBe(false)
  })

  it('requires company administration on the branch create and seat edit routes', () => {
    for (const path of ['/settings/team/branches/new', '/settings/team/branches/7/edit']) {
      expect(requiredCapabilityForPath(path)).toBe('settings.company.manage')
      expect(canReachPath({ capabilities: ['access.users.read'] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['access.users.assign_roles', 'access.roles.read'] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['settings.company.manage'] }, path)).toBe(true)
    }
  })

  it('requires the grant on the members create route, and the delegation keys on its edit route', () => {
    expect(requiredCapabilityForPath('/settings/team/members/new')).toBe('access.users.grant')
    expect(canReachPath({ capabilities: ['access.users.read'] }, '/settings/team/members/new')).toBe(false)
    expect(canReachPath({ capabilities: ['access.users.grant'] }, '/settings/team/members/new')).toBe(true)
    expect(requiredCapabilityForPath('/settings/team/members/9/edit')).toBe('access.users.grant')
    expect(canReachPath({ capabilities: ['access.users.grant'] }, '/settings/team/members/9/edit')).toBe(false)
    expect(canReachPath({ capabilities: ['access.users.grant', 'access.users.assign_roles'] }, '/settings/team/members/9/edit')).toBe(false)
    expect(canReachPath({ capabilities: ['access.users.grant', 'access.users.assign_roles', 'access.roles.read'] }, '/settings/team/members/9/edit')).toBe(true)
  })

  it('lists the branches entry for either right in the team settings', () => {
    const entry = (capabilities: string[]) => visibleSettingsPages({ capabilities }).find(({ page }) => page.id === 'team')?.parts.map(part => part.id) ?? []
    expect(entry(['settings.company.manage'])).toContain('branches')
    expect(entry(['access.users.assign_roles', 'access.roles.read'])).toContain('branches')
    expect(entry(['access.users.read'])).not.toContain('branches')
  })
})
