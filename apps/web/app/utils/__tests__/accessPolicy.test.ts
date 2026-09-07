import { describe, expect, it } from 'vitest'
import { hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, postLoginPath } from '../accessPolicy'

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
    expect(firstAllowedPath({ capabilities: ['pmo.tasks.read'] })).toBe('/tasks')
    expect(firstAllowedPath({ capabilities: ['hr.employees.read'] })).toBe('/hr')
    expect(firstAllowedPath({ capabilities: ['access.users.read'] })).toBe('/settings/users')
    expect(firstAllowedPath({ capabilities: [] })).toBe('/account')
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
    expect(postLoginPath({ capabilities: [] }, '/settings/appearance')).toBe('/settings/appearance')
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
    expect(requiredCapabilityForPath('/account')).toBe(null)
  })
  it('gates template editing and retains accessible template deep links after login', () => {
    expect(requiredCapabilityForPath('/project-templates')).toBe('pmo.projects.read')
    expect(requiredCapabilityForPath('/project-templates/7')).toBe('pmo.projects.read')
    expect(requiredCapabilityForPath('/project-templates/7/use')).toBe('pmo.projects.read')
    expect(requiredCapabilityForPath('/project-templates/new')).toBe('pmo.settings.manage')
    expect(requiredCapabilityForPath('/project-templates/7/edit')).toBe('pmo.settings.manage')
    const reader = { capabilities: ['pmo.projects.read'] }
    expect(postLoginPath(reader, '/project-templates/7?returnTo=%2Fprojects')).toBe('/project-templates/7?returnTo=%2Fprojects')
    expect(postLoginPath(reader, '/project-templates/7/edit')).toBe('/projects')
    expect(postLoginPath({ capabilities: [] }, '/project-templates')).toBe('/account')
  })
})
