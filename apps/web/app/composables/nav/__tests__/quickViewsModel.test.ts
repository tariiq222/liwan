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

describe('pages whose presets live in the page', () => {
  it('shows no card on the projects and tasks pages: their presets are chips and filters of the page', () => {
    for (const path of ['/projects', '/projects/12', '/projects/dashboard', '/tasks', '/tasks/new', '/projects/12/tasks']) expect(model(path), path).toEqual({ views: [], actions: [] })
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
