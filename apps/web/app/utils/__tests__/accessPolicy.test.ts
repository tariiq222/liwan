import { describe, expect, it } from 'vitest'
import { canReach, canReachPath, hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, requiredFeatureForPath, postLoginPath } from '../accessPolicy'

describe('access policy navigation', () => {
  it('fails closed for legacy role names without server capabilities', () => {
    expect(hasCapability({ role: 'admin' }, 'access.users.read')).toBe(false)
    expect(hasCapability(null, 'hr.employees.read')).toBe(false)
  })
  it('opens the bell for a project reader without tasks.read (charter rows are delivered on projects.read)', () => {
    expect(hasCapability({ capabilities: ['pmo.projects.read'] }, 'webvue.notifications')).toBe(true)
    expect(hasCapability({ capabilities: ['hr.employees.read'] }, 'webvue.notifications')).toBe(false)
  })
  it('checks the named capability without elevating other domains', () => {
    const hr = { capabilities: ['hr.employees.read', 'hr.employees.manage'] }
    expect(hasCapability(hr, 'hr.employees.manage')).toBe(true)
    expect(hasCapability(hr, 'access.users.grant')).toBe(false)
  })
  it('chooses an accessible home and has an account-only fallback', () => {
    expect(firstAllowedPath({ capabilities: ['meetings.read'] })).toBe('/meetings')
    expect(firstAllowedPath({ capabilities: ['pmo.projects.read', 'pmo.tasks.read'] })).toBe('/projects/dashboard')
    expect(firstAllowedPath({ capabilities: ['pmo.projects.read'] })).toBe('/projects/dashboard')
    expect(firstAllowedPath({ capabilities: ['pmo.tasks.read'] })).toBe('/tasks')
    expect(firstAllowedPath({ capabilities: ['tasks.tasks.read'] })).toBe('/my-tasks')
    expect(firstAllowedPath({ capabilities: ['hr.employees.read'] })).toBe('/hr')
    expect(firstAllowedPath({ capabilities: ['access.users.read'] })).toBe('/settings/users')
    expect(firstAllowedPath({ capabilities: [] })).toBe('/account')
    expect(requiredCapabilityForPath('/projects/dashboard')).toBe('pmo.projects.read')
    expect(isNavPathActive('/projects/dashboard', '/projects')).toBe(false)
    expect(postLoginPath({ capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }, undefined)).toBe('/')
  })
  it('opens the shared inbox for task or meeting readers without granting the other domain', () => {
    const meetingReader = { capabilities: ['meetings.read'] }
    const taskReader = { capabilities: ['pmo.tasks.read'] }
    expect(postLoginPath(meetingReader, '/notifications')).toBe('/notifications')
    expect(postLoginPath(taskReader, '/notifications')).toBe('/notifications')
    expect(postLoginPath({ capabilities: [] }, '/notifications')).toBe('/')
    expect(postLoginPath({ role: 'admin' }, '/notifications')).toBe('/account')
    expect(postLoginPath(meetingReader, '/tasks?scope=archived')).toBe('/')
    expect(postLoginPath(taskReader, '/meetings')).toBe('/')
  })
  it('honors only local, accessible post-login destinations', () => {
    const admin = { capabilities: ['access.users.read'] }
    expect(postLoginPath(admin, undefined)).toBe('/')
    expect(postLoginPath(admin, '/tasks')).toBe('/')
    expect(postLoginPath(admin, '/settings/users?q=ali')).toBe('/settings/users?q=ali')
    expect(postLoginPath(admin, '/settings/users/new')).toBe('/')
    expect(postLoginPath(admin, '//example.test')).toBe('/')
    expect(postLoginPath(admin, '/login')).toBe('/')
    expect(postLoginPath({ capabilities: [] }, '/account')).toBe('/account')
    expect(postLoginPath({ capabilities: [] }, '/settings/appearance')).toBe('/')
    expect(postLoginPath({ capabilities: [] }, '/settings/branding')).toBe('/')
  })
  it('does not activate the employee item for departments or documents', () => {
    expect(isNavPathActive('/hr/employees/7/edit', '/hr')).toBe(true)
    expect(isNavPathActive('/hr/departments/7', '/hr')).toBe(false)
    expect(isNavPathActive('/hr/documents', '/hr')).toBe(false)
    expect(isNavPathActive('/documents/2', '/documents')).toBe(true)
    expect(isNavPathActive('/documents/2', '/hr/departments')).toBe(false)
  })
  it('distinguishes route permissions and rejects unrelated prefix matches', () => {
    expect(requiredCapabilityForPath('/settings/users/new')).toBe('access.users.grant')
    expect(requiredCapabilityForPath('/settings/roles/4/edit')).toBe('access.roles.manage')
    expect(requiredCapabilityForPath('/settings/roles/4')).toBe('access.roles.read')
    expect(requiredCapabilityForPath('/hr/employees/2/edit')).toBe('hr.employees.manage')
    expect(requiredCapabilityForPath('/documents/7/edit')).toBe('documents.items.manage')
    expect(requiredCapabilityForPath('/documents/new')).toBe('documents.items.manage')
    expect(requiredCapabilityForPath('/tasks/new')).toBe('pmo.tasks.create')
    expect(requiredCapabilityForPath('/projects/7/tasks/new')).toBe('pmo.tasks.create')
    expect(requiredCapabilityForPath('/projects/new')).toBe('pmo.projects.create')
    expect(requiredCapabilityForPath('/meetings/calendar')).toBe('meetings.read')
    expect(requiredCapabilityForPath('/meetings/series/new')).toBe('meetings.create')
    expect(postLoginPath({ capabilities: ['meetings.read'] }, '/meetings/series/new')).toBe('/')
    expect(postLoginPath({ capabilities: ['meetings.read', 'meetings.create'] }, '/meetings/series/new')).toBe('/meetings/series/new')
    expect(isNavPathActive('/meetings/calendar', '/meetings')).toBe(true)
    expect(isNavPathActive('/meetings/calendar', '/meetings/calendar')).toBe(true)
    expect(requiredCapabilityForPath('/account')).toBe(null)
    expect(requiredCapabilityForPath('/projects/settings')).toBe('pmo.settings.manage')
    expect(requiredCapabilityForPath('/projects/settings/catalogs/types/new')).toBe('pmo.settings.manage')
    expect(isNavPathActive('/projects/settings', '/projects')).toBe(false)
  })
  it('keeps /chat for internal WebVue identities and rejects portal or role-only objects', () => {
    const internal = { capabilities: ['access.users.read'] }
    const employee = { capabilities: ['pmo.tasks.read'] }
    expect(requiredCapabilityForPath('/chat')).toBe('webvue.internal')
    expect(requiredCapabilityForPath('/chat/new')).toBe('webvue.internal')
    expect(requiredCapabilityForPath('/chat/42')).toBe('webvue.internal')
    expect(requiredCapabilityForPath('/chat/42/info')).toBe('webvue.internal')
    expect(hasCapability(internal, 'webvue.internal')).toBe(true)
    expect(hasCapability(employee, 'webvue.internal')).toBe(true)
    expect(hasCapability({ role: 'portal' }, 'webvue.internal')).toBe(false)
    expect(hasCapability({ role: 'admin' }, 'webvue.internal')).toBe(false)
    expect(hasCapability(null, 'webvue.internal')).toBe(false)
    expect(postLoginPath(internal, '/chat')).toBe('/chat')
    expect(postLoginPath(employee, '/chat/42?q=ops&filter=unread')).toBe('/chat/42?q=ops&filter=unread')
    expect(postLoginPath(internal, '/chat/new')).toBe('/chat/new')
    expect(postLoginPath({ role: 'portal' }, '/chat')).toBe('/account')
    expect(postLoginPath({ capabilities: [] }, '/chat')).toBe('/chat')
    expect(isNavPathActive('/chat/42/info', '/chat')).toBe(true)
  })
  it("reaches a newer application's capability through its own feature, without navigation", () => {
    const unregistered = (readable: string[], writable: string[]) => ({
      capabilities: ['zz_unregistered.orders.read', 'zz_unregistered.orders.write'],
      modules: ['webvue_zz_unregistered'],
      entitlements: { 'zz_unregistered.enabled': readable.includes('zz_unregistered.enabled') },
      platform: { readable_features: readable, writable_features: writable },
    })
    expect(canReach(unregistered(['zz_unregistered.enabled'], ['zz_unregistered.enabled']), 'zz_unregistered.orders.write')).toBe(true)
    expect(canReach(unregistered(['zz_unregistered.enabled'], []), 'zz_unregistered.orders.read')).toBe(true)
    expect(canReach(unregistered(['zz_unregistered.enabled'], []), 'zz_unregistered.orders.write')).toBe(false)
    expect(canReach(unregistered([], []), 'zz_unregistered.orders.read')).toBe(false)
    expect(canReach({ capabilities: ['zz_unregistered.orders.read'] }, 'zz_unregistered.orders.write')).toBe(false)
    // An application with no registered manifest has no nav entries or landing page (a manifest adds them): an unregistered-app-only user lands on /account.
    expect(firstAllowedPath(unregistered(['zz_unregistered.enabled'], ['zz_unregistered.enabled']))).toBe('/account')
    expect(requiredCapabilityForPath('/zz_unregistered/orders')).toBeNull()
  })
  describe('explicit feature on a route rule', () => {
    const hrTenant = (features: string[]) => ({
      capabilities: ['hr.employees.read', 'hr.assets.read'],
      platform: { readable_features: features, writable_features: features },
    })
    it('denies /hr/assets/mine when hr.assets is off, though hr.employees.read is held', () => {
      expect(requiredCapabilityForPath('/hr/assets/mine')).toBe('hr.employees.read')
      expect(requiredFeatureForPath('/hr/assets/mine')).toBe('hr.assets')
      expect(canReachPath(hrTenant(['hr.enabled']), '/hr/assets/mine')).toBe(false)
    })
    it('allows /hr/assets/mine when hr.assets is on, and ungated routes stay as before', () => {
      expect(canReachPath(hrTenant(['hr.enabled', 'hr.assets']), '/hr/assets/mine')).toBe(true)
      expect(requiredFeatureForPath('/hr')).toBeUndefined()
      expect(canReachPath(hrTenant(['hr.enabled']), '/hr')).toBe(true)
    })
    it('canReach adds the explicit feature to the capability gates only when given', () => {
      const off = hrTenant(['hr.enabled'])
      expect(canReach(off, 'hr.employees.read', '/hr/assets/mine')).toBe(true)
      expect(canReach(off, 'hr.employees.read', '/hr/assets/mine', 'hr.assets')).toBe(false)
      expect(canReach(hrTenant(['hr.enabled', 'hr.assets']), 'hr.employees.read', '/hr/assets/mine', 'hr.assets')).toBe(true)
    })
  })
})
