import { describe, expect, it } from 'vitest'
import { isWorkspaceThemeRoute, isWorkspaceOverlayRoute, deriveWorkspaceOverlayBackground, workspaceOverlayTitleKey } from '../workspacePresentation'

describe('approved workspace rollout excluding chat', () => {
  it('keeps chat, login and printable documents outside the shared theme', () => {
    for (const path of ['/chat', '/chat/7', '/chat/new', '/login', '/meetings/7/print']) expect(isWorkspaceThemeRoute(path)).toBe(false)
    for (const path of ['/projects', '/hr', '/tasks/7', '/settings/appearance', '/notifications', '/account', '/search', '/reports']) expect(isWorkspaceThemeRoute(path)).toBe(true)
  })
  it('opens business workflows in one sheet while section roots and print stay pages', () => {
    for (const path of ['/hr/employees/new', '/hr/employees/7/access', '/hr/departments/3', '/hr/departments/3/documents/9/edit', '/hr/documents/new', '/tasks/new', '/tasks/7', '/meetings/7', '/meetings/7/minutes', '/meetings/series/new', '/meetings/series/3/edit', '/settings/users/7/security', '/settings/roles/2/edit', '/settings/access-log/7', '/notification-digests/7']) expect(isWorkspaceOverlayRoute({path, query: {}}), path).toBe(true)
    for (const path of ['/hr', '/hr/departments', '/hr/documents', '/tasks', '/meetings', '/meetings/calendar', '/meetings/series', '/settings/users', '/settings/appearance', '/projects/7/settings', '/chat/7', '/meetings/7/print', '/tasks/0', '/settings/users/nope']) expect(isWorkspaceOverlayRoute({path, query: {}}), path).toBe(false)
  })
  it('preserves same-module filtered returns and derives safe direct-link roots', () => {
    expect(deriveWorkspaceOverlayBackground('/hr/employees/7/edit', {returnTo: '/hr?department_id=3#results'})).toBe('/hr?department_id=3#results')
    expect(deriveWorkspaceOverlayBackground('/settings/users/7', {q:'ali', status:'active', offset:'25', fullPage:'1'})).toBe('/settings/users?q=ali&status=active&offset=25')
    expect(deriveWorkspaceOverlayBackground('/meetings/series/3/edit', {})).toBe('/meetings/series')
    expect(deriveWorkspaceOverlayBackground('/hr/departments/3/documents/9', {})).toBe('/hr/documents')
    expect(deriveWorkspaceOverlayBackground('/tasks/7', {returnTo:'/archived-tasks?q=old'})).toBe('/archived-tasks?q=old')
    for (const returnTo of ['https://evil.example', '//evil.example', '/chat', '/settings/users', '/hr/employees/8']) expect(deriveWorkspaceOverlayBackground('/hr/employees/7', {returnTo})).toBe('/hr')
  })
  it('names task sheets after tasks, not the projects module', () => {
    expect(workspaceOverlayTitleKey('/projects/40/tasks/701')).toBe('nav.tasks')
    expect(workspaceOverlayTitleKey('/tasks/7')).toBe('nav.tasks')
    expect(workspaceOverlayTitleKey('/projects/40/stakeholders/3')).toBe('projects.title')
  })
  it('unwraps nested record returns on edit refresh without accepting external context', () => {
    expect(deriveWorkspaceOverlayBackground('/hr/employees/7/edit', {
      returnTo: '/hr/employees/7?returnTo=%2Fhr%3Fdepartment_id%3D3%23results',
    })).toBe('/hr?department_id=3#results')
    expect(deriveWorkspaceOverlayBackground('/hr/employees/7/edit', {
      returnTo: '/hr/employees/7?returnTo=https%3A%2F%2Fevil.example',
    })).toBe('/hr')
    expect(deriveWorkspaceOverlayBackground('/settings/users/7/security', {
      returnTo: '/settings/users/7?q=ali&status=active',
    })).toBe('/settings/users?q=ali&status=active')
  })
})
