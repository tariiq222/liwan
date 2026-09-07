import { describe, it, expect } from 'vitest'
import { activeShellModule, contextLinksForModule, projectContextId, projectContextLinks, visibleShellModules, useNav } from '../useNav'

const employee = { role: 'employee', capabilities: ['pmo.tasks.read', 'pmo.projects.read', 'meetings.read', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read'] }
const admin = { role: 'admin', capabilities: [...employee.capabilities, 'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage'] }

describe('capability-based navigation', () => {
  it('has no links before authenticated capabilities arrive', () => {
    expect(useNav(undefined)).toEqual([])
    expect(useNav({ role: 'admin' })).toEqual([])
  })
  it('groups the employee product pages without administrative links', () => {
    const nav = useNav(employee)
    expect(nav.map(item => item.to)).toEqual(['/chat', '/projects/dashboard', '/tasks', '/meetings', '/meetings/calendar', '/hr', '/hr/departments', '/hr/documents', '/settings/appearance'])
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
  it('keeps the primary module active for direct and nested routes', () => {
    expect(activeShellModule('/projects/12/tasks/44')).toBe('projects')
    expect(activeShellModule('/archived-tasks')).toBe('tasks')
    expect(activeShellModule('/meetings/calendar')).toBe('meetings')
    expect(activeShellModule('/settings/users/18/access')).toBe('settings')
  })

  it('maps every project area to one contextual section', () => {
    expect(projectContextId('/projects/12', {})).toBe('summary')
    expect(projectContextId('/projects/12', { tab: 'tasks' })).toBe('planning')
    expect(projectContextId('/projects/12/schedule', {})).toBe('planning')
    expect(projectContextId('/projects/12/raci', {})).toBe('stakeholders')
    expect(projectContextId('/projects/12/register/3/edit', {})).toBe('risks')
    expect(projectContextId('/projects/12/finance', {})).toBe('finance')
    expect(projectContextId('/projects/12/charter', {})).toBe('charter')
    expect(projectContextId('/projects/12/settings', {})).toBe('settings')
  })
})


describe('module rail and project context continuity', () => {
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
    expect(contextLinksForModule('projects', creator).map(link => link.id)).toEqual(['project-dashboard', 'new-project', 'projects', 'my-projects'])
    expect(contextLinksForModule('projects', employee).map(link => link.id)).toEqual(['project-dashboard', 'projects', 'my-projects'])
    expect(contextLinksForModule('projects', undefined)).toEqual([])
  })
})
