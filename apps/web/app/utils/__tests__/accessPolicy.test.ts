import { describe, expect, it } from 'vitest'
import { canReach, hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, postLoginPath } from '../accessPolicy'

describe('access policy navigation', () => {
  it('fails closed for legacy role names without server capabilities', () => {
    expect(hasCapability({ role: 'admin' }, 'access.users.read')).toBe(false)
    expect(hasCapability(null, 'hr.employees.read')).toBe(false)
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
    expect(postLoginPath({ capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }, undefined)).toBe('/projects/dashboard')
  })
  it('opens the shared inbox for task or meeting readers without granting the other domain', () => {
    const meetingReader = { capabilities: ['meetings.read'] }
    const taskReader = { capabilities: ['pmo.tasks.read'] }
    expect(postLoginPath(meetingReader, '/notifications')).toBe('/notifications')
    expect(postLoginPath(taskReader, '/notifications')).toBe('/notifications')
    expect(postLoginPath({ capabilities: [] }, '/notifications')).toBe('/account')
    expect(postLoginPath({ role: 'admin' }, '/notifications')).toBe('/account')
    expect(postLoginPath(meetingReader, '/tasks?scope=archived')).toBe('/meetings')
    expect(postLoginPath(taskReader, '/meetings')).toBe('/tasks')
  })
  it('honors only local, accessible post-login destinations', () => {
    const admin = { capabilities: ['access.users.read'] }
    expect(postLoginPath(admin, undefined)).toBe('/settings/users')
    expect(postLoginPath(admin, '/tasks')).toBe('/settings/users')
    expect(postLoginPath(admin, '/settings/users?q=ali')).toBe('/settings/users?q=ali')
    expect(postLoginPath(admin, '/settings/users/new')).toBe('/settings/users')
    expect(postLoginPath(admin, '//example.test')).toBe('/settings/users')
    expect(postLoginPath(admin, '/login')).toBe('/settings/users')
    expect(postLoginPath({ capabilities: [] }, '/account')).toBe('/account')
    expect(postLoginPath({ capabilities: [] }, '/settings/appearance')).toBe('/account')
    expect(postLoginPath({ capabilities: [] }, '/settings/branding')).toBe('/account')
  })
  it('does not activate the employee item for departments or documents', () => {
    expect(isNavPathActive('/hr/employees/7/edit', '/hr')).toBe(true)
    expect(isNavPathActive('/hr/departments/7', '/hr')).toBe(false)
    expect(isNavPathActive('/hr/documents', '/hr')).toBe(false)
    expect(isNavPathActive('/hr/departments/7/documents/2', '/hr/documents')).toBe(true)
    expect(isNavPathActive('/hr/departments/7/documents/2', '/hr/departments')).toBe(false)
  })
  it('distinguishes route permissions and rejects unrelated prefix matches', () => {
    expect(requiredCapabilityForPath('/settings/users/new')).toBe('access.users.grant')
    expect(requiredCapabilityForPath('/settings/roles/4/edit')).toBe('access.roles.manage')
    expect(requiredCapabilityForPath('/settings/roles/4')).toBe('access.roles.read')
    expect(requiredCapabilityForPath('/hr/employees/2/edit')).toBe('hr.employees.manage')
    expect(requiredCapabilityForPath('/hr/departments/7/documents/new')).toBe('hr.documents.manage')
    expect(requiredCapabilityForPath('/hr/documents/new')).toBe('hr.documents.manage')
    expect(requiredCapabilityForPath('/tasks/new')).toBe('pmo.tasks.create')
    expect(requiredCapabilityForPath('/projects/7/tasks/new')).toBe('pmo.tasks.create')
    expect(requiredCapabilityForPath('/projects/new')).toBe('pmo.projects.create')
    expect(requiredCapabilityForPath('/meetings/calendar')).toBe('meetings.read')
    expect(requiredCapabilityForPath('/meetings/series/new')).toBe('meetings.create')
    expect(postLoginPath({ capabilities: ['meetings.read'] }, '/meetings/series/new')).toBe('/meetings')
    expect(postLoginPath({ capabilities: ['meetings.read', 'meetings.create'] }, '/meetings/series/new')).toBe('/meetings/series/new')
    expect(isNavPathActive('/meetings/calendar', '/meetings')).toBe(false)
    expect(isNavPathActive('/meetings/calendar', '/meetings/calendar')).toBe(true)
    expect(requiredCapabilityForPath('/account')).toBe(null)
    expect(requiredCapabilityForPath('/projects/settings')).toBe('pmo.settings.manage')
    expect(requiredCapabilityForPath('/projects/settings/catalogs/types/new')).toBe('pmo.settings.manage')
    expect(isNavPathActive('/projects/settings', '/projects')).toBe(false)
  })
  it('keeps /chat for internal Nasq identities and rejects portal or role-only objects', () => {
    const internal = { capabilities: ['access.users.read'] }
    const employee = { capabilities: ['pmo.tasks.read'] }
    expect(requiredCapabilityForPath('/chat')).toBe('nasq.internal')
    expect(requiredCapabilityForPath('/chat/new')).toBe('nasq.internal')
    expect(requiredCapabilityForPath('/chat/42')).toBe('nasq.internal')
    expect(requiredCapabilityForPath('/chat/42/info')).toBe('nasq.internal')
    expect(hasCapability(internal, 'nasq.internal')).toBe(true)
    expect(hasCapability(employee, 'nasq.internal')).toBe(true)
    expect(hasCapability({ role: 'portal' }, 'nasq.internal')).toBe(false)
    expect(hasCapability({ role: 'admin' }, 'nasq.internal')).toBe(false)
    expect(hasCapability(null, 'nasq.internal')).toBe(false)
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
      modules: ['nasq_zz_unregistered'],
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
})
