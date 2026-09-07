import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

const employee = { role: 'employee', capabilities: ['pmo.tasks.read', 'pmo.projects.read', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read'] }
const admin = { role: 'admin', capabilities: [...employee.capabilities, 'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage'] }

describe('capability-based navigation', () => {
  it('has no links before authenticated capabilities arrive', () => {
    expect(useNav(undefined)).toEqual([])
    expect(useNav({ role: 'admin' })).toEqual([])
  })
  it('groups the employee product pages without administrative links', () => {
    const nav = useNav(employee)
    expect(nav.map(item => item.to)).toEqual(['/chat', '/projects', '/tasks', '/hr', '/hr/departments', '/hr/documents', '/settings/appearance'])
    expect(nav.filter(item => item.group === 'hr')).toHaveLength(3)
    expect(nav.filter(item => item.group === 'chat')).toHaveLength(1)
    expect(nav.filter(item => item.group === 'settings').map(item => item.to)).toEqual(['/settings/appearance'])
    expect(nav.filter(item => item.group === 'projects').map(item => item.to)).toEqual(['/projects', '/tasks'])
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
