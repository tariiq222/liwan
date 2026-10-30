import { describe, it, expect, vi } from 'vitest'
import { allNavItems, areaLabelKey, contextLinksForModule, featureForRailModule, hidePinnedNewProject, shellModuleList, visibleSettingsPages, visibleShellModules, useNav } from '../shellModules'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'
import { activeShellModule } from '../activeRoute'

const employee = { role: 'employee', capabilities: ['pmo.tasks.read', 'pmo.projects.read', 'meetings.read', 'hr.employees.read', 'hr.departments.read', 'documents.items.read'] }
const admin = { role: 'admin', capabilities: [...employee.capabilities, 'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage'] }
const full = { role: 'admin', capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'documents.items.read', 'pmo.settings.manage', 'access.users.read', 'access.roles.read', 'access.audit.read'] }

describe('capability-based navigation', () => {
  it('has no links before authenticated capabilities arrive', () => {
    expect(useNav(undefined)).toEqual([])
    expect(useNav({ role: 'admin' })).toEqual([])
  })
  it('groups the employee product pages without administrative links', () => {
    const nav = useNav(employee)
    expect(nav.map(item => item.to)).toEqual(['/', '/projects/dashboard', '/projects', '/tasks', '/meetings', '/meetings/follow-up', '/meetings/calendar', '/meetings/series', '/chat', '/hr', '/hr/departments', '/documents'])
    expect(nav.filter(item => item.group === 'hr')).toHaveLength(2)
    expect(nav.filter(item => item.group === 'chat')).toHaveLength(1)
    // Account and appearance live in the header, so an employee has no settings module.
    expect(nav.filter(item => item.group === 'settings')).toEqual([])
    expect(visibleShellModules(employee).map(module => module.id)).not.toContain('settings')
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).toEqual(['/projects/dashboard', '/projects', '/tasks'])
    expect(nav.map(item => item.to)).not.toContain('/settings/apps/projects')
    expect(nav.find(item => item.to === '/projects/dashboard')?.module).toBe('projects')
    expect(nav.find(item => item.to === '/projects')?.module).toBe('projects')
  })
  it('an access administrator does not inherit project settings', () => {
    const nav = useNav(admin)
    const paths = nav.map(item => item.to)
    expect(paths).toContain('/settings/team/users')
    expect(paths).toContain('/settings/team/roles')
    expect(paths).not.toContain('/settings/appearance')
    expect(paths).toContain('/settings/company#branding')
    expect(visibleShellModules(admin).find(module => module.id === 'settings')?.to).toBe('/settings')
    expect(paths.some(path => path.startsWith('/settings/apps/projects'))).toBe(false)
    // The subscription page is the approved in-workspace commercial surface; the flag is off in tests, and /settings/billing stays absent.
    expect(paths).not.toContain('/subscription')
    expect(paths).not.toContain('/settings/billing')
    expect(paths.some(path => path.startsWith('/settings/billing'))).toBe(false)
    expect(nav.find(item => item.to === '/settings/team/users')?.group).toBe('settings')
  })
  it('lists project settings under settings (apps), never in the projects group', () => {
    const nav = useNav({ ...admin, capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    const projects = nav.find(item => item.to === '/settings/apps/projects#project-creation')
    expect(projects?.group).toBe('settings')
    expect(projects?.module).toBe('settings')
    expect(projects?.labelKey).toBe('settings.projects.creation.title')
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).not.toContain('/settings/apps/projects#project-creation')
  })
  it('combines capabilities without duplicate paths or shortcuts; registered settings pages carry no shortcut', () => {
    const nav = useNav({ ...admin, capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    expect(new Set(nav.map(item => item.to)).size).toBe(nav.length)
    const shortcuts = nav.map(item => item.shortcut).filter(Boolean)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const shortcut of shortcuts) expect(shortcut).toMatch(/^[a-z0-9]$/)
    expect(nav.find(item => item.to === '/settings/apps/projects#project-creation')?.shortcut).toBe('')
    expect(nav.find(item => item.to === '/settings/company#branding')?.shortcut).toBe('i')
  })
})

describe('subscription navigation', () => {
  const settingsAdmin = { role: 'admin', capabilities: ['settings.branding.manage', 'access.users.read'] }
  it('is shown to settings readers only when the customer commercial flag is on', () => {
    expect(useNav(settingsAdmin).map(i => i.to)).not.toContain('/subscription')
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { customerCommercialEnabled: true } }))
    try {
      const nav = useNav(settingsAdmin)
      expect(nav.find(i => i.to === '/subscription')).toMatchObject({ group: 'settings', module: 'settings', labelKey: 'settings.sections.billing.package' })
      expect(useNav({ role: 'employee', capabilities: ['pmo.tasks.read'] }).map(i => i.to)).not.toContain('/subscription')
      expect(nav.map(i => i.to)).not.toContain('/settings/billing')
      const shortcuts = nav.map(i => i.shortcut).filter(Boolean)
      expect(new Set(shortcuts).size).toBe(shortcuts.length)
      expect(activeShellModule('/subscription/invoices/1')).toBe('settings')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('contextual module links', () => {
  it('gates and pins meeting and chat creation links', () => {
    const internal = { capabilities: ['webvue.internal', 'meetings.read', 'meetings.create'] }
    expect(contextLinksForModule('meetings', internal)[0]).toMatchObject({ id: 'new-meeting', pinned: true, capability: 'meetings.create' })
    expect(contextLinksForModule('meetings', employee).some(link => link.id === 'new-meeting')).toBe(false)
    expect(contextLinksForModule('chat', internal)[0]).toMatchObject({ id: 'new-chat', pinned: true, capability: 'webvue.internal' })
  })

  it('keeps task creation out of the sidebar and selects one HR action for each context', () => {
    const taskCreator = { capabilities: ['pmo.tasks.read', 'pmo.tasks.create'] }
    expect(contextLinksForModule('projects', taskCreator).map(link => link.id)).toEqual(['tasks'])
    expect(contextLinksForModule('projects', full).some(link => link.id === 'new-task')).toBe(false)

    const hrManager = { capabilities: ['hr.employees.read', 'hr.employees.manage', 'hr.departments.read', 'hr.departments.manage', 'documents.items.read', 'documents.items.manage'] }
    expect(contextLinksForModule('hr', hrManager, '/hr').filter(link => link.pinned).map(link => link.id)).toEqual(['new-employee'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments').filter(link => link.pinned).map(link => link.id)).toEqual(['new-department'])
    expect(contextLinksForModule('documents', hrManager, '/documents').filter(link => link.pinned).map(link => link.id)).toEqual(['new-document'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments/7').filter(link => link.pinned).map(link => link.id)).toEqual(['new-department'])
  })

  it('lists the fixed settings pages on top and the open page\'s parts under its heading', () => {
    expect(contextLinksForModule('settings', employee)).toEqual([])
    const ids = (identity: typeof admin, path?: string) => contextLinksForModule('settings', identity, path).map(link => link.id)
    expect(ids(admin)).toEqual(['settings-overview', 'settings-company', 'settings-team'])
    expect(ids(admin, '/settings/team/roles/3')).toEqual(['settings-overview', 'settings-company', 'settings-team', 'users', 'roles', 'access-log'])
    expect(ids(admin, '/settings/company')).toEqual(['settings-overview', 'settings-company', 'settings-team', 'branding'])
    expect(ids({ ...admin, capabilities: [...admin.capabilities, 'settings.company.read'] }, '/settings/company#contact')).toEqual(['settings-overview', 'settings-company', 'settings-team', 'profile', 'address', 'contact', 'branding'])
    const open = contextLinksForModule('settings', admin, '/settings/team/users').filter(link => link.section)
    expect(open.every(link => link.section === 'settings.sections.team.title')).toBe(true)
    // The page link opens its first part; the page is active through its prefix, not its own path.
    expect(contextLinksForModule('settings', admin).find(link => link.id === 'settings-team')).toMatchObject({ to: '/settings/team', within: '/settings/team' })
    expect(contextLinksForModule('settings', admin).find(link => link.id === 'settings-company')).toMatchObject({ to: '/settings/company', within: '/settings/company' })
    expect(contextLinksForModule('settings', admin).find(link => link.id === 'settings-overview')).toMatchObject({ to: '/settings', exact: true })
  })
  it('scrolls a card of the open page, and a card with a full list page stays lit there', () => {
    const company = { capabilities: ['settings.company.read', 'settings.branding.manage', 'access.users.read'] }
    const links = contextLinksForModule('settings', company, '/settings/company')
    expect(links.find(link => link.id === 'contact')).toMatchObject({ to: { path: '/settings/company', hash: '#contact' }, section: 'settings.sections.company.title' })
    expect(contextLinksForModule('settings', company, '/settings/team').find(link => link.id === 'users')).toMatchObject({ to: { path: '/settings/team', hash: '#users' }, within: '/settings/team/users' })
  })
  it('lists one link per application under the Applications heading, gated by capability and feature', () => {
    const pmoAdmin = { capabilities: ['pmo.settings.manage', 'operations.processes.manage'] }
    const apps = (identity: typeof pmoAdmin, path: string) => contextLinksForModule('settings', identity, path)
    expect(apps(pmoAdmin, '/settings/apps/projects').map(link => link.id)).toEqual(['settings-overview', 'settings-projects', 'settings-operations', 'project-creation', 'project-defaults', 'project-reminders', 'catalogs'])
    expect(apps(pmoAdmin, '/settings/apps/projects').filter(link => link.group).map(link => link.group)).toEqual(['settings.sections.apps.title', 'settings.sections.apps.title'])
    expect(apps(pmoAdmin, '/settings/apps/operations/processes').map(link => link.id)).toEqual(['settings-overview', 'settings-projects', 'settings-operations', 'processes'])
    const noOperations = { ...pmoAdmin, platform: { readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'] } }
    expect(apps(noOperations, '/settings/apps/projects').map(link => link.id)).toEqual(['settings-overview', 'settings-projects', 'project-creation', 'project-defaults', 'project-reminders', 'catalogs'])
    expect(visibleSettingsPages(pmoAdmin).map(({ page }) => page.id)).toEqual(['projects', 'operations'])
    expect(contextLinksForModule('projects', full).map(link => link.id).at(-1)).not.toBe('project-settings')
    expect(contextLinksForModule('projects', employee).map(link => link.id)).not.toContain('project-settings')
  })
  it('lists the subscription pages in the settings sidebar only where the commercial flag is on', () => {
    const settingsAdmin = { role: 'admin', capabilities: ['settings.branding.manage'] }
    expect(contextLinksForModule('settings', settingsAdmin, '/subscription').map(link => link.id)).not.toContain('settings-billing')
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { customerCommercialEnabled: true } }))
    try {
      const links = contextLinksForModule('settings', settingsAdmin, '/subscription/status')
      expect(links.map(link => link.id)).toEqual(['settings-overview', 'settings-company', 'settings-billing', 'subscription', 'subscription-change', 'subscription-status', 'subscription-branches', 'subscription-invoices'])
      expect(links.find(link => link.id === 'subscription')).toMatchObject({ exact: true, section: 'settings.sections.billing.title' })
      expect(links.find(link => link.id === 'subscription-status')?.exact).toBeUndefined()
      expect(activeShellModule('/subscription/invoices')).toBe('settings')
    } finally { vi.unstubAllGlobals() }
  })
})

// Additional applications may join the rail without editing these tests: compare only today's module ids.
const TODAY = ['home', 'projects', 'meetings', 'chat', 'hr', 'settings']
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
  it('orders rail modules home, projects, meetings, chat, hr with utilities anchored after them', () => {
    expect(today(visibleShellModules(full).map(item => item.id))).toEqual(['home', 'projects', 'meetings', 'chat', 'hr', 'settings'])
    expect(visibleShellModules(full).find(item => item.id === 'home')?.to).toBe('/')
    expect(visibleShellModules(full).find(item => item.id === 'projects')?.to).toBe('/projects')
    expect(visibleShellModules(full).find(item => item.id === 'hr')?.labelKey).toBe('nav.hr')
    expect(visibleShellModules(full).map(item => item.id as string)).not.toContain('tasks')
    expect(visibleShellModules(full).map(item => item.id as string)).not.toContain('reports')
  })

  it('selects permitted module destinations without legacy group leakage', () => {
    const taskOnly = visibleShellModules({ capabilities: ['pmo.tasks.read'] })
    expect(today(taskOnly.map(item => item.id))).toEqual(['home', 'projects', 'chat'])
    expect(taskOnly.find(item => item.id === 'projects')?.to).toBe('/tasks')
    const departmentOnly = visibleShellModules({ capabilities: ['hr.departments.read'] })
    expect(departmentOnly.find(item => item.id === 'hr')?.to).toBe('/hr/departments')
    expect(visibleShellModules(undefined)).toEqual([])
  })
})

describe('projects dashboard navigation', () => {
  it('opens foundation Home at the root and Projects at the list without a separate Reports module', () => {
    const modules = visibleShellModules(employee)
    expect(modules.find(item => item.id === 'home')?.to).toBe('/')
    expect(modules.find(item => item.id === 'projects')?.to).toBe('/projects')
    expect(modules.map(item => item.id as string)).not.toContain('reports')
    expect(activeShellModule('/projects/dashboard')).toBe('projects')
  })
  it('orders creation, overview, all projects, and tasks with real capability gates', () => {
    const creator = { capabilities: ['pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read'] }
    expect(contextLinksForModule('projects', creator).map(link => link.id)).toEqual(['new-project', 'project-dashboard', 'projects', 'tasks'])
    expect(contextLinksForModule('home', creator)).toEqual([])
    expect(contextLinksForModule('projects', employee).map(link => link.id)).toEqual(['project-dashboard', 'projects', 'tasks'])
    expect(contextLinksForModule('projects', { capabilities: ['pmo.projects.read'] }).map(link => link.id)).toEqual(['project-dashboard', 'projects'])
    expect(contextLinksForModule('projects', employee).map(link => link.labelKey)).toEqual(['projects.dashboard.title', 'nav.projects', 'nav.tasks'])
    expect(contextLinksForModule('projects', full).some(link => ['my-projects', 'archived-tasks', 'project-system-settings', 'summary', 'current-project-settings'].includes(link.id))).toBe(false)
    expect(contextLinksForModule('projects', undefined)).toEqual([])
  })
  it('hides the pinned new-project action on the list, create form and inside a project', () => {
    expect(hidePinnedNewProject('/projects')).toBe(true)
    expect(hidePinnedNewProject('/projects/new')).toBe(true)
    expect(hidePinnedNewProject('/projects/40')).toBe(true)
    expect(hidePinnedNewProject('/projects/40/tasks/701')).toBe(true)
    expect(hidePinnedNewProject('/projects/dashboard')).toBe(false)
    // hidePinnedNewProject shares normalizedPath with the route helpers, so a
    // trailing slash or a query string must not reopen the pinned action.
    expect(hidePinnedNewProject('/projects/')).toBe(true)
    expect(hidePinnedNewProject('/projects?mine=1')).toBe(true)
    expect(hidePinnedNewProject('/projects/40/?tab=tasks')).toBe(true)
  })
  it('orders meetings as list, calendar, recurring series after the pinned create action', () => {
    expect(contextLinksForModule('meetings', full).map(link => link.id)).toEqual(['new-meeting', 'meetings', 'meeting-followup', 'meeting-calendar', 'meeting-series'])
    expect(contextLinksForModule('hr', full, '/hr').map(link => link.labelKey)).toEqual(['hr.nav.people', 'nav.employees', 'nav.departments'])
  })
})

const pilot: AppManifest = {
  id: 'pilot',
  feature: 'pilot.enabled',
  routePrefixes: ['/pilot'],
  rail: [{ id: 'pilot', labelKey: 'nav.pilot', icon: 'i-lucide-handshake', to: '/pilot', order: 60 }],
  nav: [
    { to: '/pilot', labelKey: 'nav.pilotLeads', icon: 'i-lucide-handshake', shortcut: 'j', capability: 'pilot.leads.read' },
    { to: '/pilot/deals', labelKey: 'nav.pilotDeals', icon: 'i-lucide-banknote', shortcut: 'd', capability: 'pilot.deals.read' },
  ],
  contextLinks: () => [{ id: 'new-lead', labelKey: 'nav.newLead', icon: 'i-lucide-plus', to: '/pilot/leads/new', capability: 'pilot.leads.create', pinned: true }],
}
const pilotIdentity = {
  role: 'employee',
  capabilities: ['pilot.leads.read', 'pilot.leads.create', 'pilot.deals.read'],
  platform: { readable_features: ['pilot.enabled'], writable_features: ['pilot.enabled'] },
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
    withManifests([...appManifests, pilot], () => {
      expect(useNav(pilotIdentity).map(item => [item.to, item.group, item.module])).toEqual([['/', undefined, 'home'], ['/pilot', 'pilot', 'pilot'], ['/pilot/deals', 'pilot', 'pilot']])
      expect(shellModuleList().map(module => module.id)).toContain('pilot')
      expect(visibleShellModules(pilotIdentity).map(module => module.id)).toEqual(['home', 'pilot'])
      expect(activeShellModule('/pilot/deals/4')).toBe('pilot')
      expect(contextLinksForModule('pilot', pilotIdentity).map(link => link.id)).toEqual(['new-lead'])
      expect(featureForRailModule('pilot')).toBe('pilot.enabled')
    })
    expect(activeShellModule('/pilot')).toBeNull()
    expect(useNav(pilotIdentity).map(item => item.to)).toEqual(['/'])
    expect(shellModuleList().map(module => module.id)).not.toContain('pilot')
  })
  it('hides a new application whose feature is closed and treats unknown rail modules as gated', () => {
    withManifests([...appManifests, pilot], () => {
      const closed = { ...pilotIdentity, platform: { readable_features: ['hr.enabled'], writable_features: [] } }
      expect(useNav(closed).map(item => item.to)).toEqual(['/'])
      expect(featureForRailModule('nope')).toBeUndefined()
      expect(featureForRailModule('settings')).toBeNull()
    })
  })
  it('hides an internal-access item whose rail module no manifest declares', () => {
    const ghost: AppManifest = { ...pilot, nav: [{ to: '/pilot/ghost', labelKey: 'nav.ghost', icon: 'i-lucide-ghost', shortcut: '', capability: 'webvue.internal', module: 'ghost' }] }
    withManifests([...appManifests, ghost], () => {
      expect(featureForRailModule('ghost')).toBeUndefined()
      expect(useNav(pilotIdentity).map(item => item.to)).not.toContain('/pilot/ghost')
    })
  })


})

describe('areaLabelKey', () => {
  it('names the module, then «التطبيقات» on the launcher, then the product', () => {
    expect(areaLabelKey({ labelKey: 'nav.home' }, 'home')).toBe('nav.home')
    expect(areaLabelKey(null, 'apps')).toBe('nav.apps')
    expect(areaLabelKey(null, null)).toBe('app.productName')
  })
})
