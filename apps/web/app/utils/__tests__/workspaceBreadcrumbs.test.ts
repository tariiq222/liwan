import { describe, expect, it } from 'vitest'
import { projectBreadcrumbs } from '../projectBreadcrumbs'
import { workspaceBreadcrumbs } from '../workspaceBreadcrumbs'
import { projectSidebarLinks, type ShellContextLink } from '../../composables/useNav'

const identity = { is_admin: true, capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'pmo.settings.manage'] }
const projectLinks = projectSidebarLinks(1, identity, true, true)
const noLinks: ShellContextLink[] = []

describe('workspace sidebar breadcrumbs', () => {
  it('delegates project and project-system paths to the existing implementation', () => {
    expect(workspaceBreadcrumbs('/projects/1/finance/9/edit', { returnTo: '/projects/1/finance?kind=cost' }, projectLinks, 'Alpha'))
      .toEqual(projectBreadcrumbs('/projects/1/finance/9/edit', { returnTo: '/projects/1/finance?kind=cost' }, projectLinks, 'Alpha'))
    expect(workspaceBreadcrumbs('/settings/projects/catalogs/types/1/edit', {}, projectLinks))
      .toEqual(projectBreadcrumbs('/settings/projects/catalogs/types/1/edit', {}, projectLinks))
  })

  it('keeps chat and global utility pages without breadcrumbs', () => {
    expect(workspaceBreadcrumbs('/chat/7', {}, noLinks)).toEqual([])
    expect(workspaceBreadcrumbs('/search', {}, noLinks)).toEqual([])
    expect(workspaceBreadcrumbs('/notifications', {}, noLinks)).toEqual([])
  })

  it('maps task detail and edit routes while retaining a safe list return', () => {
    const crumbs = workspaceBreadcrumbs('/tasks/42/edit', { returnTo: '/tasks?state=done#late' }, noLinks)
    expect(crumbs.map(crumb => crumb.key)).toEqual(['tasks', 'record', 'edit'])
    expect(crumbs[0]?.to).toBe('/tasks?state=done#late')
    expect(crumbs[1]?.to).toEqual({ path: '/tasks/42', query: { returnTo: '/tasks?state=done#late' } })
    expect(crumbs[2]?.labelKey).toBe('app.edit')
  })

  it('maps meeting, HR, and settings actions to their actual ancestors', () => {
    expect(workspaceBreadcrumbs('/meetings/series/new', {}, noLinks).map(crumb => crumb.labelKey))
      .toEqual(['nav.meetings', 'nav.meetingSeries', 'nav.breadcrumbCreate'])
    expect(workspaceBreadcrumbs('/hr/departments/3/documents/9/edit', {}, noLinks).map(crumb => crumb.key))
      .toEqual(['employees', 'departments', 'documents', 'record', 'edit'])
    expect(workspaceBreadcrumbs('/settings/users/4/access', {}, noLinks).at(-1)?.labelKey)
      .toBe('access.users.editAccess')
  })

  it('maps meeting editor workflows to the meeting detail ancestor', () => {
    const minutes = workspaceBreadcrumbs('/meetings/12/minutes', { returnTo: '/meetings?state=done#minutes' }, noLinks)
    expect(minutes.map(crumb => crumb.key))
      .toEqual(['meetings', 'record', 'action'])
    expect(minutes.at(-1)?.labelKey).toBe('meetingsUx.minutesEditorTitle')
    expect(workspaceBreadcrumbs('/meetings/12/resolutions/new', {}, noLinks).map(crumb => crumb.key))
      .toEqual(['meetings', 'record', 'create'])
    expect(workspaceBreadcrumbs('/meetings/12/resolutions/5/edit', {}, noLinks).map(crumb => crumb.key))
      .toEqual(['meetings', 'record', 'edit'])
  })

  it('uses the real department detail page for department documents', () => {
    const crumbs = workspaceBreadcrumbs('/hr/departments/3/documents/9/edit', {
      returnTo: '/hr/departments/3?returnTo=%2Fhr%2Fdepartments%3Foffset%3D20%23list',
    }, noLinks)
    expect(crumbs.find(crumb => crumb.key === 'documents')?.to)
      .toBe('/hr/departments/3?returnTo=%2Fhr%2Fdepartments%3Foffset%3D20%23list')
  })

  it('preserves nested employee list return context in the employee ancestor', () => {
    const crumbs = workspaceBreadcrumbs('/hr/employees/42/edit', {
      returnTo: '/hr/employees/42?returnTo=%2Fhr%3Fdepartment_id%3D3%26offset%3D20%23list',
    }, noLinks)
    expect(crumbs[0]?.to).toBe('/hr?department_id=3&offset=20#list')
  })

  it('rejects an unsafe returnTo while retaining the module fallback', () => {
    const record = workspaceBreadcrumbs('/tasks/42/edit', { returnTo: '//evil.test/path' }, noLinks)[1]
    expect(record?.to).toEqual({ path: '/tasks/42', query: { returnTo: '/tasks' } })
  })
})
