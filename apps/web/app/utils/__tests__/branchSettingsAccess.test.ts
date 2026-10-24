import { describe, expect, it } from 'vitest'
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
})
