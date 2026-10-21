import { describe, expect, it } from 'vitest'
import { createLinkTo } from '../createActions'
import { quickViewsModel, type QuickViewsModel } from '../quickViewsModel'

const ALL = () => true

function model(path: string, query: Record<string, unknown> = {}, can: (capability: string) => boolean = ALL): QuickViewsModel {
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()
  const route = { path, fullPath: search ? `${path}?${search}` : path, query, params: {} }
  return quickViewsModel({ path, query, can, createTo: link => createLinkTo(link, route) })
}
const ids = (items: Array<{ id: string }>) => items.map(item => item.id)
const activeIds = (items: Array<{ id: string; active: boolean }>) => items.filter(item => item.active).map(item => item.id)

describe('tasks quick views', () => {
  it('links each preset with the keys the tasks filters read', () => {
    const { views } = model('/tasks')
    expect(views.map(view => [view.id, view.to])).toEqual([
      ['assigned', { path: '/tasks', query: { assignee: 'me' } }],
      ['today', { path: '/tasks', query: { deadline: 'today' } }],
      ['week', { path: '/tasks', query: { deadline: 'week' } }],
      ['overdue', { path: '/tasks', query: { deadline: 'overdue' } }],
      ['urgent', { path: '/tasks', query: { priority: '3' } }],
      ['done', { path: '/tasks', query: { closed: '1' } }],
    ])
  })

  it('marks the preset the query holds, and none for a page that ignores the keys', () => {
    expect(activeIds(model('/tasks', { deadline: 'overdue' }).views)).toEqual(['overdue'])
    expect(activeIds(model('/tasks', { closed: '1' }).views)).toEqual(['done'])
    expect(activeIds(model('/tasks', { priority: '3' }).views)).toEqual(['urgent'])
    expect(activeIds(model('/tasks').views)).toEqual([])
    expect(activeIds(model('/tasks', { deadline: ['today', 'week'] }).views)).toEqual(['today'])
    expect(activeIds(model('/tasks', { deadline: 'nonsense' }).views)).toEqual([])
    expect(activeIds(model('/tasks', { scope: 'archived', closed: '1' }).views)).toEqual([])
  })

  it('keeps the board layout when a preset is chosen', () => {
    expect(model('/tasks', { view: 'board', q: 'x' }).views[1]!.to).toEqual({ path: '/tasks', query: { view: 'board', deadline: 'today' } })
  })

  it('offers the create action first with the list as its return target, then the archive', () => {
    const { actions } = model('/tasks', { closed: '1' })
    expect(ids(actions)).toEqual(['new-task-pmo', 'archived-tasks'])
    expect(actions[0]).toMatchObject({ primary: true, icon: 'i-lucide-plus', to: { path: '/tasks/new', query: { returnTo: '/tasks?closed=1' } } })
    expect(actions[1]).toMatchObject({ primary: false, to: { path: '/tasks', query: { scope: 'archived' } }, active: false })
    expect(activeIds(model('/tasks', { scope: 'archived' }).actions)).toEqual(['archived-tasks'])
  })

  it('drops the create action without the capability and while the create panel is open', () => {
    expect(ids(model('/tasks', {}, capability => capability !== 'pmo.tasks.create').actions)).toEqual(['archived-tasks'])
    expect(ids(model('/tasks/new').actions)).toEqual(['archived-tasks'])
    expect(model('/tasks/new').views).toHaveLength(6)
  })

  it('serves a project task list on its own path, without the archive', () => {
    const { views, actions } = model('/projects/12/tasks', { closed: '1' })
    expect(views[5]).toMatchObject({ id: 'done', active: true, to: { path: '/projects/12/tasks', query: { closed: '1' } } })
    expect(ids(actions)).toEqual(['new-task-pmo'])
    expect(actions[0]!.to).toEqual({ path: '/projects/12/tasks/new', query: { returnTo: '/projects/12/tasks?closed=1' } })
  })
})

describe('projects quick views', () => {
  it('lists status presets of the projects list and offers the archive to a manager only', () => {
    const { views, actions } = model('/projects', { status: 'at_risk', view: 'cards' })
    expect(ids(views)).toEqual(['mine', 'at-risk', 'off-track', 'on-hold', 'done'])
    expect(activeIds(views)).toEqual(['at-risk'])
    expect(views[0]!.to).toEqual({ path: '/projects', query: { view: 'cards', mine: '1' } })
    expect(ids(actions)).toEqual(['archived-projects'])
    expect(activeIds(model('/projects', { archived: '1' }).actions)).toEqual(['archived-projects'])
    expect(model('/projects', {}, capability => capability !== 'pmo.projects.manage').actions).toEqual([])
  })

  it('shows no card on a project record or the dashboard', () => {
    expect(model('/projects/12')).toEqual({ views: [], actions: [] })
    expect(model('/projects/dashboard')).toEqual({ views: [], actions: [] })
  })
})

describe('meetings quick views', () => {
  it('lists presets on the meetings list and only the actions on the other meeting lists', () => {
    const list = model('/meetings', { state: 'confirmed' })
    expect(ids(list.views)).toEqual(['mine', 'draft', 'confirmed', 'done'])
    expect(activeIds(list.views)).toEqual(['confirmed'])
    expect(ids(list.actions)).toEqual(['new-meeting', 'new-meeting-series'])
    expect(list.actions[0]!.primary).toBe(true)
    expect(model('/meetings/calendar').views).toEqual([])
    expect(ids(model('/meetings/series').actions)).toEqual(['new-meeting', 'new-meeting-series'])
  })

  it('stays empty without create rights on lists that have no presets', () => {
    expect(model('/meetings/calendar', {}, () => false)).toEqual({ views: [], actions: [] })
  })
})

describe('other modules', () => {
  it('shows no quick card on HR pages, whose lists carry their own create actions', () => {
    for (const path of ['/hr', '/hr/departments', '/hr/leave', '/hr/employees/3']) expect(model(path), path).toEqual({ views: [], actions: [] })
  })

  it('puts the create action of the documents list first', () => {
    expect(ids(model('/documents').actions)[0]).toBe('new-document')
  })

  it('offers request and process creation in operations by capability', () => {
    expect(ids(model('/operations').actions)).toEqual(['new-operation', 'new-operation-process'])
    expect(ids(model('/settings/apps/operations/processes').actions)).toEqual(['new-operation-process', 'new-operation'])
    expect(ids(model('/operations', {}, capability => capability === 'operations.requests.create').actions)).toEqual(['new-operation'])
  })

  it('lists user status presets, then role creation', () => {
    const users = model('/settings/team/users', { status: 'stopped' })
    expect(ids(users.views)).toEqual(['active', 'stopped'])
    expect(activeIds(users.views)).toEqual(['stopped'])
    expect(ids(users.actions)).toEqual(['new-user'])
    expect(ids(model('/settings/team/roles').actions)).toEqual(['new-role'])
    expect(model('/settings/team/access-log')).toEqual({ views: [], actions: [] })
  })

  it('has nothing for chat, the assistant, my to-dos or the home page', () => {
    for (const path of ['/chat', '/chat/new', '/ai', '/my-tasks', '/']) expect(model(path)).toEqual({ views: [], actions: [] })
  })
})
