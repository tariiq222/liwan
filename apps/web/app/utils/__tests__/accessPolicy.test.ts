import { describe, expect, it } from 'vitest'
import { appRootFallback, canReach, canReachPath, hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, requiredFeatureForPath, postLoginPath, planDenialCode } from '../accessPolicy'

describe('access policy navigation', () => {
  it('fails closed for legacy role names without server capabilities', () => {
    expect(hasCapability({ role: 'admin' }, 'access.users.read')).toBe(false)
    expect(hasCapability(null, 'hr.employees.read')).toBe(false)
  })
  it('opens the bell for a project reader without tasks.read (charter rows are delivered on projects.read)', () => {
    expect(hasCapability({ capabilities: ['pmo.projects.read'] }, 'liwan.notifications')).toBe(true)
    expect(hasCapability({ capabilities: ['hr.employees.read'] }, 'liwan.notifications')).toBe(false)
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
    expect(firstAllowedPath({ capabilities: ['access.users.read'] })).toBe('/settings/team/users')
    expect(firstAllowedPath({ capabilities: [] })).toBe('/account')
    expect(requiredCapabilityForPath('/projects/dashboard')).toBe('pmo.projects.read')
    expect(isNavPathActive('/projects/dashboard', '/projects')).toBe(false)
    expect(postLoginPath({ capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }, undefined)).toBe('/')
  })
  it('returns to «مهامي» (with its tab) for a task reader and to «خدماتي» for anyone signed in', () => {
    const taskReader = { capabilities: ['tasks.tasks.read'], platform: { readable_features: ['tasks.enabled'], writable_features: ['tasks.enabled'] } }
    expect(postLoginPath(taskReader, '/work?tab=decide')).toBe('/work?tab=decide')
    expect(postLoginPath({ capabilities: [] }, '/work?tab=decide')).toBe('/')
    expect(postLoginPath({ capabilities: [] }, '/account')).toBe('/account')
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
    expect(postLoginPath(admin, '/settings/team/users?q=ali')).toBe('/settings/team/users?q=ali')
    expect(postLoginPath(admin, '/settings/team/users/new')).toBe('/')
    expect(postLoginPath(admin, '//example.test')).toBe('/')
    expect(postLoginPath(admin, '/login')).toBe('/')
    expect(postLoginPath({ capabilities: [] }, '/account')).toBe('/account')
    expect(postLoginPath({ capabilities: [] }, '/settings/appearance')).toBe('/')
    expect(postLoginPath({ capabilities: [] }, '/settings/company')).toBe('/')
  })
  it('lands on / for a forbidden next while the identity is not loaded yet', () => {
    expect(postLoginPath(null, '/finance/partners')).toBe('/')
    expect(postLoginPath(undefined, undefined)).toBe('/')
  })
  it('sends a user to a settings page when any of its cards is theirs, not only the first', () => {
    expect(postLoginPath({ capabilities: ['settings.branding.manage'] }, '/settings/company')).toBe('/settings/company')
    expect(postLoginPath({ capabilities: ['settings.maintenance.manage'] }, '/settings/system')).toBe('/settings/system')
    expect(postLoginPath({ capabilities: ['finance.analytic.read'] }, '/settings/apps/finance')).toBe('/settings/apps/finance')
    expect(postLoginPath({ capabilities: ['settings.maintenance.manage'] }, '/settings/company')).toBe('/')
  })
  it('does not activate the employee item for departments or documents', () => {
    expect(isNavPathActive('/hr/employees/7/edit', '/hr')).toBe(true)
    expect(isNavPathActive('/hr/departments/7', '/hr')).toBe(false)
    expect(isNavPathActive('/hr/documents', '/hr')).toBe(false)
    expect(isNavPathActive('/documents/2', '/documents')).toBe(true)
    expect(isNavPathActive('/documents/2', '/hr/departments')).toBe(false)
  })
  it('distinguishes route permissions and rejects unrelated prefix matches', () => {
    expect(requiredCapabilityForPath('/settings/team/users/new')).toBe('access.users.grant')
    expect(requiredCapabilityForPath('/settings/team/roles/4/edit')).toBe('access.roles.manage')
    expect(requiredCapabilityForPath('/settings/team/roles/4')).toBe('access.roles.read')
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
    expect(requiredCapabilityForPath('/settings/apps/projects')).toBe('pmo.settings.manage')
    expect(requiredCapabilityForPath('/settings/apps/projects/catalogs/types/new')).toBe('pmo.settings.manage')
    expect(isNavPathActive('/settings/apps/projects/catalogs/types', '/settings/apps/projects')).toBe(true)
    expect(isNavPathActive('/settings/team/users', '/settings')).toBe(false)
    expect(isNavPathActive('/settings', '/settings')).toBe(true)
  })
  it('opens a settings page to anyone who may see one of its cards, and gates its full pages separately', () => {
    expect(canReachPath({ capabilities: ['integrations.read'] }, '/settings/system')).toBe(true)
    expect(canReachPath({ capabilities: ['settings.maintenance.manage'] }, '/settings/system')).toBe(true)
    expect(canReachPath({ capabilities: ['access.users.read'] }, '/settings/system')).toBe(false)
    expect(canReachPath({ capabilities: ['pmo.settings.manage'] }, '/settings/apps/projects')).toBe(true)
    expect(canReachPath({ capabilities: ['finance.audit.read'] }, '/settings/apps/finance/audit')).toBe(true)
    expect(canReachPath({ capabilities: ['finance.audit.read'] }, '/settings/apps/finance')).toBe(true)
    expect(canReachPath({ capabilities: ['finance.invoices.read'] }, '/settings/apps/finance')).toBe(false)
    expect(canReachPath({ capabilities: ['access.roles.read'] }, '/settings/team')).toBe(true)
    expect(canReachPath({ capabilities: ['access.roles.read'] }, '/settings/team/users')).toBe(false)
    expect(requiredCapabilityForPath('/settings/system')).toBe('integrations.read')
    expect(firstAllowedPath({ capabilities: ['settings.maintenance.manage'] })).toBe('/settings/system')
  })
  it('keeps /chat for internal LiwanOS identities and rejects portal or role-only objects', () => {
    const internal = { capabilities: ['access.users.read'] }
    const employee = { capabilities: ['pmo.tasks.read'] }
    expect(requiredCapabilityForPath('/chat')).toBe('liwan.internal')
    expect(requiredCapabilityForPath('/chat/new')).toBe('liwan.internal')
    expect(requiredCapabilityForPath('/chat/42')).toBe('liwan.internal')
    expect(requiredCapabilityForPath('/chat/42/info')).toBe('liwan.internal')
    expect(hasCapability(internal, 'liwan.internal')).toBe(true)
    expect(hasCapability(employee, 'liwan.internal')).toBe(true)
    expect(hasCapability({ role: 'portal' }, 'liwan.internal')).toBe(false)
    expect(hasCapability({ role: 'admin' }, 'liwan.internal')).toBe(false)
    expect(hasCapability(null, 'liwan.internal')).toBe(false)
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
      modules: ['liwan_zz_unregistered'],
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
    it('denies /account/assets when hr.assets is off, though hr.employees.read is held', () => {
      expect(requiredCapabilityForPath('/account/assets')).toBe('hr.employees.read')
      expect(requiredFeatureForPath('/account/assets')).toBe('hr.assets')
      expect(canReachPath(hrTenant(['hr.enabled']), '/account/assets')).toBe(false)
    })
    it('allows /account/assets when hr.assets is on, and ungated routes stay as before', () => {
      expect(canReachPath(hrTenant(['hr.enabled', 'hr.assets']), '/account/assets')).toBe(true)
      expect(requiredFeatureForPath('/hr')).toBeUndefined()
      expect(canReachPath(hrTenant(['hr.enabled']), '/hr')).toBe(true)
    })
    it('canReach adds the explicit feature to the capability gates only when given', () => {
      const off = hrTenant(['hr.enabled'])
      expect(canReach(off, 'hr.employees.read', '/account/assets')).toBe(true)
      expect(canReach(off, 'hr.employees.read', '/account/assets', 'hr.assets')).toBe(false)
      expect(canReach(hrTenant(['hr.enabled', 'hr.assets']), 'hr.employees.read', '/account/assets', 'hr.assets')).toBe(true)
    })
  })
})


describe('personal and HR management route boundaries', () => {
  it('lets staff see their own leave while requiring an administrative role for the HR queue', () => {
    const employee = { capabilities: ['hr.employees.read', 'hr.leave.read'] }
    expect(canReachPath(employee, '/account/leave')).toBe(true)
    expect(canReachPath(employee, '/hr/leave')).toBe(false)
    for (const role of ['hr.leave.manage', 'hr.leave.approve']) {
      expect(canReachPath({ capabilities: [...employee.capabilities, role] }, '/hr/leave')).toBe(true)
    }
    expect(firstAllowedPath({ capabilities: ['hr.leave.read'] })).toBe('/account')
  })
  it('retains administrative read access in a read-only tenant without enabling a new own request', () => {
    const identity = { capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.manage', 'hr.leave.request'], platform: { readable_features: ['hr.enabled'], writable_features: [] } }
    expect(canReachPath(identity, '/hr/leave')).toBe(true)
    expect(canReachPath(identity, '/account/leave/new')).toBe(false)
  })
})

describe('an application root an identity cannot open', () => {
  it('sends a partial finance role to its first finance page (#171)', () => {
    expect(appRootFallback({ capabilities: ['finance.payments.read'] }, '/finance')).toBe('/finance/payments')
    expect(appRootFallback({ capabilities: ['finance.statements.read'] }, '/finance')).toBe('/finance/reports/trial-balance')
    expect(appRootFallback({ capabilities: ['finance.reports.read'] }, '/finance')).toBe('/finance/reports/vat')
  })

  it('leaves reachable roots, other paths and empty applications alone', () => {
    expect(appRootFallback({ capabilities: ['finance.invoices.read'] }, '/finance')).toBeNull()
    expect(appRootFallback({ capabilities: ['finance.payments.read'] }, '/finance/sales/invoices')).toBeNull()
    expect(appRootFallback({ capabilities: ['hr.employees.read'] }, '/finance')).toBeNull()
  })
})

describe('why a closed page is closed', () => {
  const hr = ['hr.employees.read', 'hr.leave.read', 'hr.leave.request']
  it('names the plan when the application is off for the tenant, whatever the user holds', () => {
    const off = { capabilities: hr, platform: { readable_features: [], writable_features: [] } }
    expect(canReachPath(off, '/hr')).toBe(false)
    expect(planDenialCode(off, '/hr')).toBe('feature_not_included')
  })
  it('names a read-only tenant when only the write page is closed', () => {
    const readOnly = { capabilities: hr, platform: { readable_features: ['hr.enabled'], writable_features: [], read_only: true } }
    expect(canReachPath(readOnly, '/account/leave/new')).toBe(false)
    expect(planDenialCode(readOnly, '/account/leave/new')).toBe('tenant_read_only')
  })
  it('stays silent when the user simply lacks the permission', () => {
    const on = { capabilities: ['hr.employees.read'], platform: { readable_features: ['hr.enabled'], writable_features: ['hr.enabled'] } }
    expect(canReachPath(on, '/hr/leave')).toBe(false)
    expect(planDenialCode(on, '/hr/leave')).toBeNull()
  })
})
