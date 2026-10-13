import { describe, it, expect, vi } from 'vitest'
import { allNavItems, contextLinksForModule, featureForRailModule, hidePinnedNewProject, shellModuleList, visibleShellModules, useNav } from '../shellModules'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'
import { activeShellModule } from '../activeRoute'

const employee = { role: 'employee', capabilities: ['pmo.tasks.read', 'pmo.projects.read', 'meetings.read', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read'] }
const admin = { role: 'admin', capabilities: [...employee.capabilities, 'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage'] }
const full = { role: 'admin', capabilities: ['nasq.internal', 'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read', 'pmo.settings.manage', 'access.users.read', 'access.roles.read', 'access.audit.read'] }

describe('capability-based navigation', () => {
  it('has no links before authenticated capabilities arrive', () => {
    expect(useNav(undefined)).toEqual([])
    expect(useNav({ role: 'admin' })).toEqual([])
  })
  it('groups the employee product pages without administrative links', () => {
    const nav = useNav(employee)
    expect(nav.map(item => item.to)).toEqual(['/projects/dashboard', '/projects', '/tasks', '/project-templates', '/meetings', '/meetings/calendar', '/meetings/series', '/chat', '/hr', '/hr/departments', '/hr/documents'])
    expect(nav.filter(item => item.group === 'hr')).toHaveLength(3)
    expect(nav.filter(item => item.group === 'chat')).toHaveLength(1)
    // Account and appearance live in the header, so an employee has no settings module.
    expect(nav.filter(item => item.group === 'settings')).toEqual([])
    expect(visibleShellModules(employee).map(module => module.id)).not.toContain('settings')
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).toEqual(['/projects/dashboard', '/projects', '/tasks', '/project-templates'])
    expect(nav.map(item => item.to)).not.toContain('/projects/settings')
    expect(nav.find(item => item.to === '/projects/dashboard')?.module).toBe('home')
    expect(nav.find(item => item.to === '/projects')?.module).toBe('projects')
  })
  it('an access administrator does not inherit project settings', () => {
    const nav = useNav(admin)
    const paths = nav.map(item => item.to)
    expect(paths).toContain('/settings/users')
    expect(paths).toContain('/settings/roles')
    expect(paths).not.toContain('/settings/appearance')
    expect(paths).toContain('/settings/branding')
    expect(visibleShellModules(admin).find(module => module.id === 'settings')?.to).toBe('/settings/users')
    expect(paths).not.toContain('/projects/settings')
    expect(paths).not.toContain('/odoo')
    // The subscription page is the approved in-workspace commercial surface; the flag is off in tests, and /settings/billing stays absent.
    expect(paths).not.toContain('/subscription')
    expect(paths).not.toContain('/settings/billing')
    expect(paths.some(path => path.startsWith('/settings/billing'))).toBe(false)
    expect(nav.find(item => item.to === '/settings/users')?.group).toBe('settings')
  })
  it('puts project settings last in the projects group, never in settings', () => {
    const nav = useNav({ ...admin, capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    const projects = nav.find(item => item.to === '/projects/settings')
    expect(projects?.group).toBe('projects')
    expect(projects?.module).toBe('projects')
    expect(projects?.labelKey).toBe('settings.projects.title')
    expect(nav.filter(item => item.group === 'projects').map(item => item.to).at(-1)).toBe('/projects/settings')
    expect(nav.filter(item => item.group === 'settings').map(item => item.to)).not.toContain('/projects/settings')
  })
  it('combines capabilities without duplicate paths or shortcuts', () => {
    const nav = useNav({ ...admin, role: 'vendor', capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    expect(nav.at(-1)?.to).toBe('/odoo')
    expect(new Set(nav.map(item => item.to)).size).toBe(nav.length)
    expect(new Set(nav.map(item => item.shortcut)).size).toBe(nav.length)
    for (const item of nav) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})

describe('subscription navigation', () => {
  const settingsAdmin = { role: 'admin', capabilities: ['settings.branding.manage', 'access.users.read'] }
  it('is shown to settings readers only when the customer commercial flag is on', () => {
    expect(useNav(settingsAdmin).map(i => i.to)).not.toContain('/subscription')
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { customerCommercialEnabled: true } }))
    try {
      const nav = useNav(settingsAdmin)
      expect(nav.find(i => i.to === '/subscription')).toMatchObject({ group: 'settings', module: 'settings', labelKey: 'subscription.nav' })
      expect(useNav({ role: 'employee', capabilities: ['pmo.tasks.read'] }).map(i => i.to)).not.toContain('/subscription')
      expect(nav.map(i => i.to)).not.toContain('/settings/billing')
      expect(new Set(nav.map(i => i.shortcut)).size).toBe(nav.length)
      expect(activeShellModule('/subscription/invoices/1')).toBe('settings')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('contextual module links', () => {
  it('gates and pins meeting and chat creation links', () => {
    const internal = { capabilities: ['nasq.internal', 'meetings.read', 'meetings.create'] }
    expect(contextLinksForModule('meetings', internal)[0]).toMatchObject({ id: 'new-meeting', pinned: true, capability: 'meetings.create' })
    expect(contextLinksForModule('meetings', employee).some(link => link.id === 'new-meeting')).toBe(false)
    expect(contextLinksForModule('chat', internal)[0]).toMatchObject({ id: 'new-chat', pinned: true, capability: 'nasq.internal' })
  })

  it('keeps task creation out of the sidebar and selects one HR action for each context', () => {
    const taskCreator = { capabilities: ['pmo.tasks.read', 'pmo.tasks.create'] }
    expect(contextLinksForModule('projects', taskCreator).map(link => link.id)).toEqual(['tasks'])
    expect(contextLinksForModule('projects', full).some(link => link.id === 'new-task')).toBe(false)

    const hrManager = { capabilities: ['hr.employees.read', 'hr.employees.manage', 'hr.departments.read', 'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage'] }
    expect(contextLinksForModule('hr', hrManager, '/hr').filter(link => link.pinned).map(link => link.id)).toEqual(['new-employee'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments').filter(link => link.pinned).map(link => link.id)).toEqual(['new-department'])
    expect(contextLinksForModule('hr', hrManager, '/hr/documents').filter(link => link.pinned).map(link => link.id)).toEqual(['new-document'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments/7/documents').filter(link => link.pinned).map(link => link.id)).toEqual(['new-document'])
  })

  it('keeps settings links in one flat capability-gated order', () => {
    expect(contextLinksForModule('settings', employee)).toEqual([])
    expect(contextLinksForModule('settings', full).map(link => link.id)).toEqual(['users', 'roles', 'access-log'])
    expect(contextLinksForModule('projects', full).map(link => link.id).at(-1)).toBe('project-settings')
    expect(contextLinksForModule('projects', employee).map(link => link.id)).not.toContain('project-settings')
    expect(contextLinksForModule('settings', admin).map(link => link.id)).toEqual(['users', 'roles', 'access-log', 'branding'])
  })
})

// Additional applications may join the rail without editing these tests: compare only today's module ids.
const TODAY = ['home', 'projects', 'meetings', 'chat', 'hr', 'settings', 'management', 'vendor']
const today = (ids: string[]) => ids.filter(id => TODAY.includes(id))

describe('tasks app navigation', () => {
  const taskUser = { role: 'employee', capabilities: ['tasks.tasks.read'] }
  it('shows /my-tasks in the nav and the rail for tasks.tasks.read', () => {
    expect(useNav(taskUser).map(item => item.to)).toContain('/my-tasks')
    expect(visibleShellModules(taskUser).find(item => item.id === 'tasks')?.to).toBe('/my-tasks')
    expect(useNav(employee).map(item => item.to)).not.toContain('/my-tasks')
  })
})

describe('module rail', () => {
  it('orders rail modules home, projects, meetings, chat, organization with utilities anchored after them', () => {
    expect(today(visibleShellModules(full).map(item => item.id))).toEqual(['home', 'projects', 'meetings', 'chat', 'hr', 'settings'])
    expect(today(visibleShellModules({ ...full, role: 'vendor' }).map(item => item.id))).toEqual(['home', 'projects', 'meetings', 'chat', 'hr', 'settings', 'vendor'])
    expect(visibleShellModules(full).find(item => item.id === 'home')?.to).toBe('/projects/dashboard')
    expect(visibleShellModules(full).find(item => item.id === 'projects')?.to).toBe('/projects')
    expect(visibleShellModules(full).find(item => item.id === 'hr')?.labelKey).toBe('nav.organization')
    expect(visibleShellModules(full).map(item => item.id as string)).not.toContain('tasks')
    expect(visibleShellModules(full).map(item => item.id as string)).not.toContain('reports')
  })

  it('selects permitted module destinations without legacy group leakage', () => {
    const taskOnly = visibleShellModules({ capabilities: ['pmo.tasks.read'] })
    expect(today(taskOnly.map(item => item.id))).toEqual(['projects', 'chat'])
    expect(taskOnly.find(item => item.id === 'projects')?.to).toBe('/tasks')
    const departmentOnly = visibleShellModules({ capabilities: ['hr.departments.read'] })
    expect(departmentOnly.find(item => item.id === 'hr')?.to).toBe('/hr/departments')
    expect(visibleShellModules(undefined)).toEqual([])
  })
})

describe('projects dashboard navigation', () => {
  it('opens Home at the dashboard and Projects at the list without a separate Reports module', () => {
    const modules = visibleShellModules(employee)
    expect(modules.find(item => item.id === 'home')?.to).toBe('/projects/dashboard')
    expect(modules.find(item => item.id === 'projects')?.to).toBe('/projects')
    expect(modules.map(item => item.id as string)).not.toContain('reports')
    expect(activeShellModule('/reports')).toBe('projects')
    expect(activeShellModule('/projects/dashboard')).toBe('home')
  })
  it('orders creation, overview, all projects, my tasks and templates with real capability gates', () => {
    const creator = { capabilities: ['pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read'] }
    expect(contextLinksForModule('projects', creator).map(link => link.id)).toEqual(['new-project', 'project-dashboard', 'projects', 'tasks', 'project-templates'])
    expect(contextLinksForModule('home', creator)).toEqual(contextLinksForModule('projects', creator))
    expect(contextLinksForModule('projects', employee).map(link => link.id)).toEqual(['project-dashboard', 'projects', 'tasks', 'project-templates'])
    expect(contextLinksForModule('projects', { capabilities: ['pmo.projects.read'] }).map(link => link.id)).toEqual(['project-dashboard', 'projects', 'project-templates'])
    expect(contextLinksForModule('projects', employee).map(link => link.labelKey)).toEqual(['nav.projectDashboard', 'nav.allProjects', 'nav.tasks', 'nav.projectTemplates'])
    expect(contextLinksForModule('projects', full).some(link => ['my-projects', 'archived-tasks', 'project-system-settings', 'summary', 'current-project-settings'].includes(link.id))).toBe(false)
    expect(contextLinksForModule('projects', undefined)).toEqual([])
  })
  it('hides the pinned new-project action on the list, create form and inside a project', () => {
    expect(hidePinnedNewProject('/projects')).toBe(true)
    expect(hidePinnedNewProject('/projects/new')).toBe(true)
    expect(hidePinnedNewProject('/projects/40')).toBe(true)
    expect(hidePinnedNewProject('/projects/40/tasks/701')).toBe(true)
    expect(hidePinnedNewProject('/projects/dashboard')).toBe(false)
    expect(hidePinnedNewProject('/project-templates')).toBe(false)
    // hidePinnedNewProject shares normalizedPath with the route helpers, so a
    // trailing slash or a query string must not reopen the pinned action.
    expect(hidePinnedNewProject('/projects/')).toBe(true)
    expect(hidePinnedNewProject('/projects?mine=1')).toBe(true)
    expect(hidePinnedNewProject('/projects/40/?tab=tasks')).toBe(true)
  })
  it('orders meetings as list, calendar, recurring series after the pinned create action', () => {
    expect(contextLinksForModule('meetings', full).map(link => link.id)).toEqual(['new-meeting', 'meetings', 'meeting-calendar', 'meeting-series'])
    expect(contextLinksForModule('hr', full, '/hr').map(link => link.labelKey)).toEqual(['nav.employees', 'nav.departments', 'nav.documents'])
  })
})

const crm: AppManifest = {
  id: 'crm',
  feature: 'crm.enabled',
  routePrefixes: ['/crm'],
  rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 60 }],
  nav: [
    { to: '/crm', labelKey: 'nav.crmLeads', icon: 'i-lucide-handshake', shortcut: 'j', capability: 'crm.leads.read' },
    { to: '/crm/deals', labelKey: 'nav.crmDeals', icon: 'i-lucide-banknote', shortcut: 'd', capability: 'crm.deals.read' },
  ],
  contextLinks: () => [{ id: 'new-lead', labelKey: 'nav.newLead', icon: 'i-lucide-plus', to: '/crm/leads/new', capability: 'crm.leads.create', pinned: true }],
}
const crmIdentity = {
  role: 'employee',
  capabilities: ['crm.leads.read', 'crm.leads.create', 'crm.deals.read'],
  platform: { readable_features: ['crm.enabled'], writable_features: ['crm.enabled'] },
}

describe('navigation built from app manifests', () => {
  it('keeps shortcuts unique across manifests and foundation items', () => {
    const shortcuts = allNavItems().map(item => item.shortcut).filter(Boolean)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const shortcut of shortcuts) expect(shortcut).toMatch(/^[a-z0-9]$/)
  })
  it('lists the rail in order from the manifests', () => {
    const ids = shellModuleList().map(module => module.id as string)
    // Today's modules keep their relative order; the tasks module (order 15) sits between home and projects,
    // and any other additional application sits between hr and the foundation modules.
    expect(today(ids)).toEqual(TODAY)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('tasks')).toBe(ids.indexOf('home') + 1)
    expect(ids.indexOf('projects')).toBe(ids.indexOf('tasks') + 1)
    const firstFoundation = ids.indexOf('settings')
    for (const id of ids.filter(id => !TODAY.includes(id) && id !== 'tasks')) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('hr'))
      expect(ids.indexOf(id)).toBeLessThan(firstFoundation)
    }
  })
  it('shows a new application in the rail, nav, sidebar and active module with no foundation edit', () => {
    withManifests([...appManifests, crm], () => {
      expect(useNav(crmIdentity).map(item => [item.to, item.group, item.module])).toEqual([['/crm', 'crm', 'crm'], ['/crm/deals', 'crm', 'crm']])
      expect(shellModuleList().map(module => module.id)).toContain('crm')
      expect(visibleShellModules(crmIdentity).map(module => module.id)).toEqual(['crm'])
      expect(activeShellModule('/crm/deals/4')).toBe('crm')
      expect(contextLinksForModule('crm', crmIdentity).map(link => link.id)).toEqual(['new-lead'])
      expect(featureForRailModule('crm')).toBe('crm.enabled')
    })
    expect(activeShellModule('/crm')).toBeNull()
    expect(useNav(crmIdentity)).toEqual([])
    expect(shellModuleList().map(module => module.id)).not.toContain('crm')
  })
  it('hides a new application whose feature is closed and treats unknown rail modules as gated', () => {
    withManifests([...appManifests, crm], () => {
      const closed = { ...crmIdentity, platform: { readable_features: ['hr.enabled'], writable_features: [] } }
      expect(useNav(closed)).toEqual([])
      expect(featureForRailModule('nope')).toBeUndefined()
      expect(featureForRailModule('settings')).toBeNull()
    })
  })
  it('hides an internal-access item whose rail module no manifest declares', () => {
    const ghost: AppManifest = { ...crm, nav: [{ to: '/crm/ghost', labelKey: 'nav.ghost', icon: 'i-lucide-ghost', shortcut: '', capability: 'nasq.internal', module: 'ghost' }] }
    withManifests([...appManifests, ghost], () => {
      expect(featureForRailModule('ghost')).toBeUndefined()
      expect(useNav(crmIdentity).map(item => item.to)).not.toContain('/crm/ghost')
    })
  })
})
