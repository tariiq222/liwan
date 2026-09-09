import { describe, it, expect } from 'vitest'
import { activeShellModule, contextGroupsForModule, contextLinksForModule, projectContextId, projectContextLinks, projectSidebarLinks, projectWorkspaceLinks, visibleShellModules, useNav } from '../useNav'
import { projectSectionRoot, shellSectionRoot } from '../useShellNavigation'

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
    expect(nav.map(item => item.to)).toEqual(['/chat', '/projects/dashboard', '/tasks', '/meetings', '/meetings/calendar', '/meetings/series', '/hr', '/hr/departments', '/hr/documents', '/settings/appearance'])
    expect(nav.filter(item => item.group === 'hr')).toHaveLength(3)
    expect(nav.filter(item => item.group === 'chat')).toHaveLength(1)
    expect(nav.filter(item => item.group === 'settings').map(item => item.to)).toEqual(['/settings/appearance'])
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).toEqual(['/projects/dashboard', '/tasks'])
  })
  it('an access administrator does not inherit project settings', () => {
    const nav = useNav(admin)
    const paths = nav.map(item => item.to)
    expect(paths).toContain('/settings/users')
    expect(paths).toContain('/settings/roles')
    expect(paths).toContain('/settings/appearance')
    expect(paths).toContain('/settings/branding')
    expect(paths).not.toContain('/settings/projects')
    expect(paths).not.toContain('/odoo')
    expect(nav.find(item => item.to === '/settings/users')?.group).toBe('settings')
  })
  it('puts project settings only in the settings group', () => {
    const nav = useNav({ ...admin, capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    const projects = nav.find(item => item.to === '/settings/projects')
    expect(projects?.group).toBe('settings')
    expect(projects?.labelKey).toBe('settings.projects.title')
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).not.toContain('/settings/projects')
  })
  it('combines capabilities without duplicate paths or shortcuts', () => {
    const nav = useNav({ ...admin, role: 'vendor', capabilities: [...admin.capabilities, 'pmo.settings.manage'] })
    expect(nav.at(-1)?.to).toBe('/odoo')
    expect(new Set(nav.map(item => item.to)).size).toBe(nav.length)
    expect(new Set(nav.map(item => item.shortcut)).size).toBe(nav.length)
    for (const item of nav) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})

describe('shell route classification', () => {
  it('classifies every visible non-pinned context root and excludes creation links', () => {
    const full = {
      role: 'admin',
      capabilities: [
        'nasq.internal', 'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read',
        'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read',
        'hr.documents.read', 'pmo.settings.manage', 'access.users.read',
        'access.roles.read', 'access.audit.read', 'settings.branding.manage',
      ],
    }
    const links = (['projects', 'tasks', 'meetings', 'chat', 'hr', 'settings'] as const).flatMap(module => contextLinksForModule(module, full))
    const pathOf = (to: unknown) => typeof to === 'string' ? to.split(/[?#]/, 1)[0] : (to as { path?: string }).path
    for (const link of links.filter(item => !item.pinned)) expect(shellSectionRoot(pathOf(link.to)!)).not.toBeNull()
    for (const link of links.filter(item => item.pinned)) expect(shellSectionRoot(pathOf(link.to)!)).toBeNull()
  })

  it('normalizes root classification across trailing slashes and query strings', () => {
    expect(shellSectionRoot('/projects/dashboard/')).toBe('/projects/dashboard')
    expect(shellSectionRoot('/projects?mine=1')).toBe('/projects')
    expect(shellSectionRoot('/settings/access-log/?offset=20')).toBe('/settings/access-log')
    expect(shellSectionRoot('/projects/new')).toBeNull()
  })

  it('keeps the primary module active for direct and nested routes', () => {
    expect(activeShellModule('/projects/12/tasks/44')).toBe('projects')
    expect(activeShellModule('/archived-tasks')).toBe('tasks')
    expect(activeShellModule('/meetings/calendar')).toBe('meetings')
    expect(activeShellModule('/settings/users/18/access')).toBe('settings')
    expect(activeShellModule('/search')).toBe('projects')
    expect(activeShellModule('/notifications')).toBeNull()
    expect(activeShellModule('/notification-digests')).toBeNull()
    expect(activeShellModule('/notification-digests/12')).toBeNull()
  })

  it('maps every project area to one contextual section', () => {
    expect(projectContextId('/projects/12', {})).toBe('planning')
    expect(projectContextId('/projects/12', { tab: 'summary', view: 'board' })).toBe('summary')
    expect(projectContextId('/projects/12', { tab: 'tasks' })).toBe('planning')
    expect(projectContextId('/projects/12/schedule', {})).toBe('planning')
    expect(projectContextId('/projects/12/raci', {})).toBe('stakeholders')
    expect(projectContextId('/projects/12/register/3/edit', {})).toBe('risks')
    expect(projectContextId('/projects/12/finance', {})).toBe('finance')
    expect(projectContextId('/projects/12/charter', {})).toBe('charter')
    expect(projectContextId('/projects/12/settings', {})).toBe('settings')
  })

  it('classifies only normalized project section roots', () => {
    expect(projectSectionRoot('/projects/12')).toBe('planning')
    expect(projectSectionRoot('/projects/12/', {})).toBe('planning')
    expect(projectSectionRoot('/projects/12', { tab: 'tasks' })).toBe('planning')
    expect(projectSectionRoot('/projects/12', { tab: 'summary', view: 'board' })).toBe('summary')
    expect(projectSectionRoot('/projects/12', { view: 'board' })).toBe('planning')
    expect(projectSectionRoot('/projects/12/schedule')).toBe('planning')
    expect(projectSectionRoot('/projects/12/stakeholders/')).toBe('stakeholders')
    expect(projectSectionRoot('/projects/12/raci')).toBe('stakeholders')
    expect(projectSectionRoot('/projects/12/register')).toBe('risks')
    expect(projectSectionRoot('/projects/12/finance')).toBe('finance')
    expect(projectSectionRoot('/projects/12/charter')).toBe('charter')
    expect(projectSectionRoot('/projects/12/settings')).toBe('settings')
    expect(projectSectionRoot('/projects/12/schedule/tasks/44')).toBeNull()
    expect(projectSectionRoot('/projects/12/unknown')).toBeNull()
    expect(projectSectionRoot('/projects/0')).toBeNull()
    expect(projectSectionRoot('/projects/not-a-project')).toBeNull()
  })

  it('gates and pins meeting and chat creation links', () => {
    const internal = { capabilities: ['nasq.internal', 'meetings.read', 'meetings.create'] }
    expect(contextLinksForModule('meetings', internal)[0]).toMatchObject({ id: 'new-meeting', pinned: true, capability: 'meetings.create' })
    expect(contextLinksForModule('meetings', employee).some(link => link.id === 'new-meeting')).toBe(false)
    expect(contextLinksForModule('chat', internal)[0]).toMatchObject({ id: 'new-chat', pinned: true, capability: 'nasq.internal' })
  })

  it('pins task creation only for task creators and selects one HR action for each context', () => {
    const taskCreator = { capabilities: ['pmo.tasks.read', 'pmo.tasks.create'] }
    expect(contextLinksForModule('tasks', taskCreator).map(link => link.id)).toEqual(['new-task', 'tasks', 'archived-tasks'])
    expect(contextLinksForModule('tasks', employee).some(link => link.id === 'new-task')).toBe(false)

    const hrManager = { capabilities: ['hr.employees.read', 'hr.employees.manage', 'hr.departments.read', 'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage'] }
    expect(contextLinksForModule('hr', hrManager, '/hr').filter(link => link.pinned).map(link => link.id)).toEqual(['new-employee'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments').filter(link => link.pinned).map(link => link.id)).toEqual(['new-department'])
    expect(contextLinksForModule('hr', hrManager, '/hr/documents').filter(link => link.pinned).map(link => link.id)).toEqual(['new-document'])
    expect(contextLinksForModule('hr', hrManager, '/hr/departments/7/documents').filter(link => link.pinned).map(link => link.id)).toEqual(['new-document'])
  })
})


describe('module rail and project context continuity', () => {
  it('orders rail modules with settings utilities anchored after primary modules', () => {
    expect(visibleShellModules(full).map(item => item.id)).toEqual(['chat', 'meetings', 'projects', 'tasks', 'hr', 'settings'])
    expect(visibleShellModules({ ...full, role: 'vendor' }).map(item => item.id)).toEqual(['chat', 'meetings', 'projects', 'tasks', 'hr', 'settings', 'vendor'])
  })

  it('groups only settings context links and hides groups with no permitted links', () => {
    expect(contextGroupsForModule('settings', employee).map(group => ({ id: group.id, links: group.links.map(link => link.id) }))).toEqual([{ id: 'personal', links: ['account', 'appearance'] }])
    expect(contextGroupsForModule('settings', full).map(group => ({ id: group.id, links: group.links.map(link => link.id) }))).toEqual([
      { id: 'personal', links: ['account', 'appearance'] },
      { id: 'administration', links: ['project-settings', 'users', 'roles', 'access-log'] },
    ])
    expect(contextGroupsForModule('settings', admin).map(group => ({ id: group.id, links: group.links.map(link => link.id) }))).toEqual([
      { id: 'personal', links: ['account', 'appearance'] },
      { id: 'administration', links: ['branding', 'users', 'roles', 'access-log'] },
    ])
    expect(contextGroupsForModule('projects', full)).toHaveLength(1)
  })

  it('selects permitted module destinations without legacy group leakage', () => {
    const taskOnly = visibleShellModules({ capabilities: ['pmo.tasks.read'] })
    expect(taskOnly.map(item => item.id)).not.toContain('projects')
    expect(taskOnly.find(item => item.id === 'tasks')?.to).toBe('/tasks')
    const departmentOnly = visibleShellModules({ capabilities: ['hr.departments.read'] })
    expect(departmentOnly.find(item => item.id === 'hr')?.to).toBe('/hr/departments')
    expect(visibleShellModules(undefined)).toEqual([])
  })
  it('preserves scoped task filters across finance without carrying edit flags or applying task search to finance', () => {
    const links = projectContextLinks(12, employee, true, false, { tab: 'tasks', q: 'needle', closed: '1', view: 'board', edit: '1' })
    const finance = links.find(item => item.id === 'finance')!.to as { path: string; query: Record<string, string> }
    expect(finance.query.q).toBeUndefined()
    expect(finance.query.edit).toBeUndefined()
    const back = projectContextLinks(12, employee, true, false, finance.query).find(item => item.id === 'planning')!.to as { query: Record<string, string> }
    expect(back.query).toMatchObject({ tab: 'tasks', q: 'needle', closed: '1', view: 'board' })
  })
  it('maps direct milestone forms to planning and gates project settings by record management', () => {
    expect(projectContextId('/projects/12/milestones/new')).toBe('planning')
    expect(projectContextId('/projects/12/milestones/3/edit')).toBe('planning')
    expect(projectContextLinks(12, employee, true, false).some(item => item.id === 'settings')).toBe(false)
    expect(projectContextLinks(12, employee, true, true).some(item => item.id === 'settings')).toBe(true)
  })
})


describe('projects dashboard navigation', () => {
  it('opens the Projects module at its dashboard without a separate Reports module', () => {
    const modules = visibleShellModules(employee)
    expect(modules.find(item => item.id === 'projects')?.to).toBe('/projects/dashboard')
    expect(modules.some(item => item.id === 'reports')).toBe(false)
    expect(activeShellModule('/reports')).toBe('projects')
    expect(activeShellModule('/projects/dashboard')).toBe('projects')
  })
  it('orders dashboard, creation, all projects and mine with real capability gates', () => {
    const creator = { capabilities: ['pmo.projects.read', 'pmo.projects.create'] }
    expect(contextLinksForModule('projects', creator).map(link => link.id)).toEqual(['new-project', 'project-dashboard', 'projects', 'my-projects'])
    expect(contextLinksForModule('projects', employee).map(link => link.id)).toEqual(['project-dashboard', 'projects', 'my-projects'])
    expect(contextLinksForModule('projects', undefined)).toEqual([])
  })
})

// A section's "back to project" must never accidentally target the projects list.
describe('project section return destinations', () => {
  it('returns from settings to the project while retaining the filtered list origin', () => {
    const links = projectContextLinks(12, employee, true, true, { returnTo: '/projects?mine=1&q=site', tab: 'tasks', q: 'late', view: 'board' })
    const settings = links.find(item => item.id === 'settings')!.to as { query: Record<string, string> }
    const target = new URL(settings.query.returnTo!, 'http://nasq.local')
    expect(target.pathname).toBe('/projects/12')
    expect(target.searchParams.get('returnTo')).toBe('/projects?mine=1&q=site')
    const summary = projectContextLinks(12, employee, true, true, settings.query).find(item => item.id === 'summary')!.to as { query: Record<string, string> }
    expect(summary.query.returnTo).toBe('/projects?mine=1&q=site')
    const planning = projectContextLinks(12, employee, true, true, settings.query).find(item => item.id === 'planning')!.to as { query: Record<string, string> }
    expect(planning.query).toMatchObject({ tab: 'tasks', q: 'late', view: 'board', returnTo: '/projects?mine=1&q=site' })
  })
  it('does not nest section return paths or carry unsafe origins on repeated switches', () => {
    let query: Record<string, string> = { returnTo: '//evil.test/projects' }
    for (let step = 0; step < 10; step++) {
      query = (projectContextLinks(12, employee, true, true, query).find(item => item.id === 'finance')!.to as { query: Record<string, string> }).query
      expect(new URL(query.returnTo!, 'http://nasq.local').pathname).toBe('/projects/12')
      expect(query.returnTo!.length).toBeLessThan(220)
    }
    const summary = projectContextLinks(12, employee, true, true, query).find(item => item.id === 'summary')!.to as { query: Record<string, string> }
    expect(summary.query.returnTo).toBe('/projects')
  })
})

describe('project workspace tabs', () => {
  it('exposes direct tabs in workspace order and preserves task context', () => {
    const links = projectWorkspaceLinks(12, full, true, true, {
      returnTo: '/projects?mine=1&q=site', tab: 'board', q: 'late', view: 'board', closed: '1',
    }, true)
    expect(links.map(link => link.id)).toEqual(['tasks', 'summary', 'milestones', 'stakeholders', 'risks', 'finance', 'charter'])
    const tasks = links.find(link => link.id === 'tasks')!.to as { query: Record<string, string> }
    expect(tasks.query).toMatchObject({ tab: 'tasks', q: 'late', view: 'board', closed: '1' })
    const summary = links.find(link => link.id === 'summary')!.to as { query: Record<string, string> }
    expect(summary.query).toMatchObject({ tab: 'summary', returnTo: '/projects?mine=1&q=site' })
    const milestones = links.find(link => link.id === 'milestones')!.to as { query: Record<string, string> }
    expect(milestones.query.tab).toBe('milestones')
    expect(milestones.query.view).toBeUndefined()
  })

  it('preserves implicit root task filters when switching from summary to tasks', () => {
    const links = projectWorkspaceLinks(12, full, true, true, {
      returnTo: '/projects?mine=1', q: 'late', state: 'in_progress', closed: '1',
    }, true)
    const tasks = links.find(link => link.id === 'tasks')!.to as { query: Record<string, string> }
    expect(tasks.query).toMatchObject({ tab: 'tasks', q: 'late', state: 'in_progress', closed: '1' })
  })

  it('does not treat section filters as implicit task context', () => {
    const links = projectWorkspaceLinks(12, full, true, true, { q: 'budget' })
    const tasks = links.find(link => link.id === 'tasks')!.to as { query: Record<string, string> }
    expect(tasks.query.q).toBeUndefined()
  })

  it('keeps archived projects from exposing active-only workspace tabs', () => {
    const links = projectWorkspaceLinks(12, full, false, true)
    expect(links.map(link => link.id)).toEqual(['summary', 'finance'])
  })

  it('separates the project menu from module navigation and grants settings only to record managers', () => {
    const ordinary = projectSidebarLinks(12, full, true, false)
    expect(ordinary.map(link => link.id)).toEqual([
      ...projectWorkspaceLinks(12, full, true, false).map(link => link.id),
    ])
    const managed = projectSidebarLinks(12, full, true, true, { q: 'late', returnTo: '/projects?mine=1' }, true)
    expect(managed.map(link => link.id)).toContain('current-project-settings')
    const settings = managed.find(link => link.id === 'current-project-settings')!.to as { path: string; query: Record<string, string> }
    expect(settings.path).toBe('/projects/12/settings')
    expect(settings.query.projectListReturnTo).toBe('/projects?mine=1')
    expect(JSON.parse(settings.query.taskContext!)).toMatchObject({ q: 'late' })
    expect(projectSidebarLinks(12, full, false, true).map(link => link.id)).toContain('current-project-settings')
  })
})
