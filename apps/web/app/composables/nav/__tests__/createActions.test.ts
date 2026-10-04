import { describe, expect, it } from 'vitest'
import { createLinkTo, createListReturnTo } from '../createActions'

type Route = { path: string; fullPath: string; query: Record<string, unknown>; params: Record<string, unknown> }

function routeOf(path: string, query: Record<string, unknown> = {}, params: Record<string, unknown> = {}): Route {
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()
  return { path, fullPath: search ? `${path}?${search}` : path, query, params }
}

describe('createListReturnTo', () => {
  it('returns the current list when already on it', () => {
    expect(createListReturnTo('new-project', '/projects', '/projects?q=a', { q: 'a' })).toBe('/projects?q=a')
    expect(createListReturnTo('new-project', '/projects/dashboard', '/projects/dashboard', {})).toBe('/projects/dashboard')
    expect(createListReturnTo('new-meeting', '/meetings/series', '/meetings/series', {})).toBe('/meetings/series')
    expect(createListReturnTo('new-employee', '/hr', '/hr?q=b', { q: 'b' })).toBe('/hr?q=b')
    expect(createListReturnTo('new-department', '/hr/departments', '/hr/departments', {})).toBe('/hr/departments')
    expect(createListReturnTo('new-document', '/hr/documents', '/hr/documents', {})).toBe('/hr/documents')
  })

  it('treats a department document list as the document list', () => {
    expect(createListReturnTo('new-document', '/hr/departments/4/documents', '/hr/departments/4/documents?q=c', { q: 'c' }))
      .toBe('/hr/departments/4/documents?q=c')
  })

  it('ignores a trailing slash when matching the list', () => {
    expect(createListReturnTo('new-project', '/projects/', '/projects/', {})).toBe('/projects/')
  })

  it('falls back to the module list elsewhere', () => {
    expect(createListReturnTo('new-project', '/projects/7/tasks', '/projects/7/tasks', {})).toBe('/projects')
    expect(createListReturnTo('new-meeting', '/projects/7', '/projects/7', {})).toBe('/meetings')
    expect(createListReturnTo('new-employee', '/hr/employees/3', '/hr/employees/3', {})).toBe('/hr')
    expect(createListReturnTo('new-department', '/hr', '/hr', {})).toBe('/hr/departments')
    expect(createListReturnTo('new-document', '/hr/employees/3', '/hr/employees/3', {})).toBe('/hr/documents')
  })

  it('honours a safe returnTo inside the module and rejects an unsafe one', () => {
    expect(createListReturnTo('new-project', '/tasks', '/tasks', { returnTo: '/projects?mine=1' })).toBe('/projects?mine=1')
    expect(createListReturnTo('new-project', '/tasks', '/tasks', { returnTo: '//evil.test' })).toBe('/projects')
    expect(createListReturnTo('new-employee', '/tasks', '/tasks', { returnTo: '/projects?mine=1' })).toBe('/hr')
  })

  it('keeps the current route for any other create action', () => {
    expect(createListReturnTo('new-task', '/tasks', '/tasks?state=done', { state: 'done' })).toBe('/tasks?state=done')
  })
})

describe('createLinkTo', () => {
  it('carries the chat list state into a new conversation', () => {
    const to = createLinkTo({ id: 'new-chat', to: '/chat/new' }, routeOf('/chat', { q: 'ali', filter: 'unread' }))
    expect(to).toMatchObject({ path: '/chat/new' })
    expect((to as { query: Record<string, unknown> }).query).toMatchObject({ q: 'ali', filter: 'unread' })
  })

  it('builds the meeting create route with its project and series context', () => {
    const to = createLinkTo({ id: 'new-meeting', to: '/meetings/new' }, routeOf('/meetings', { project_id: '3', series_id: '9' }))
    expect(to).toMatchObject({
      path: '/meetings/new',
      query: { project_id: '3', series_id: '9', returnTo: '/meetings?project_id=3&series_id=9' },
    })
  })

  it('carries the department into a new document', () => {
    const to = createLinkTo(
      { id: 'new-document', to: '/hr/documents/new' },
      routeOf('/hr/departments/4/documents', {}, { departmentId: '4' }),
    )
    expect(to).toMatchObject({ path: '/hr/documents/new' })
    expect((to as { query: Record<string, string> }).query.department_id).toBe('4')
    expect((to as { query: Record<string, string> }).query.returnTo).toBe('/hr/departments/4/documents')
  })

  it('prefers an explicit department_id query over the route param', () => {
    const to = createLinkTo(
      { id: 'new-document', to: '/hr/documents/new' },
      routeOf('/hr/departments/4/documents', { department_id: '9' }, { departmentId: '4' }),
    )
    expect((to as { query: Record<string, string> }).query.department_id).toBe('9')
  })

  it('leaves the department out when the route carries none', () => {
    const to = createLinkTo({ id: 'new-document', to: '/hr/documents/new' }, routeOf('/hr/documents'))
    expect((to as { query: Record<string, string> }).query.department_id).toBeUndefined()
  })

  it('takes the HR create target from the link the path chose', () => {
    // `new-employee` on /hr and `new-department` on /hr/departments are two
    // different links; each keeps its own list as the return target.
    expect(createLinkTo({ id: 'new-employee', to: '/hr/employees/new' }, routeOf('/hr', { q: 'x' })))
      .toMatchObject({ path: '/hr/employees/new', query: { returnTo: '/hr?q=x' } })
    expect(createLinkTo({ id: 'new-department', to: { path: '/hr/departments/new' } }, routeOf('/hr', { q: 'x' })))
      .toMatchObject({ path: '/hr/departments/new', query: { returnTo: '/hr/departments' } })
  })

  it('returns the link untouched when it has no resolvable path', () => {
    const to = { name: 'somewhere' }
    expect(createLinkTo({ id: 'new-project', to }, routeOf('/projects'))).toBe(to)
  })
})

describe('vendor bundle and plan create return targets', () => {
  it('keeps list filters and rejects foreign targets', () => {
    expect(createListReturnTo('new-bundle', '/vendor/bundles', '/vendor/bundles?status=draft', {})).toBe('/vendor/bundles?status=draft')
    expect(createListReturnTo('new-plan', '/vendor/overview', '/vendor/overview', { returnTo: '/vendor/plans?q=a' })).toBe('/vendor/plans?q=a')
    expect(createListReturnTo('new-plan', '/vendor/overview', '/vendor/overview', { returnTo: '/vendor/bundles' })).toBe('/vendor/plans')
  })
})
