import { describe, expect, it } from 'vitest'
import { applicationNavigation } from '../applicationNavigation'
import { contextLinksForModule } from '../shellModules'

const identity = { capabilities: ['webvue.internal', 'meetings.read', 'meetings.create', 'operations.requests.read', 'operations.requests.create'] }
const route = (path = '/meetings', query: Record<string, unknown> = {}) => ({ path, fullPath: path, query, params: {} })
const build = (path = '/meetings', query: Record<string, unknown> = {}, actor = identity) => applicationNavigation({
  identity: actor, route: route(path, query), activeId: path.startsWith('/meetings') ? 'meetings' : 'operations',
  contextLinks: contextLinksForModule(path.startsWith('/meetings') ? 'meetings' : 'operations', actor, path).map(link => ({ ...link, active: link.to === path })),
  translate: key => key,
})

describe('unified application navigation', () => {
  it('keeps all meeting destinations and presets inside their application', () => {
    const item = build().find(item => item.id === 'meetings')!
    expect(item).toBeDefined()
    expect(item.sections.flatMap(section => section.items.map(row => row.to))).toEqual(['/meetings', '/meetings/follow-up', '/meetings/series'])
    expect(item.views.map(view => view.to)).toContainEqual({ path: '/meetings', query: { state: 'done' } })
    expect(item.actions.filter(action => typeof action.to === 'object' && action.to.path === '/meetings/new')).toHaveLength(1)
  })
  it('does not carry an operations filter into an unopened meetings menu', () => {
    const item = build('/operations', { state: 'done', project_id: '99' }).find(item => item.id === 'meetings')!
    expect(item.active).toBe(false)
    expect(item.views.every(view => !view.active)).toBe(true)
    const create = item.actions.find(action => action.id === 'new-meeting')!
    expect(create.to).toEqual({ path: '/meetings/new', query: { returnTo: '/meetings' } })
  })
  it('keeps creation and unavailable applications out of a read-only menu', () => {
    const items = build('/meetings', {}, { capabilities: ['webvue.internal', 'meetings.read'] })
    const meetings = items.find(item => item.id === 'meetings')!
    expect(meetings.actions).toEqual([])
    expect(items.some(item => item.id === 'operations')).toBe(false)
  })
  it('marks only the selected meeting preset as active', () => {
    const item = build('/meetings', { state: 'done' }).find(item => item.id === 'meetings')!
    expect(item.views.filter(view => view.active).map(view => view.to)).toEqual([{ path: '/meetings', query: { state: 'done' } }])
  })
  it('keeps the landing destination under View all without repeating its application name', () => {
    const item = build().find(item => item.id === 'meetings')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.filter(link => link.label === item.label)).toEqual([])
    expect(links.find(link => link.to === '/meetings')).toMatchObject({ label: 'nav.viewAll', active: true })
  })
  it('does not mark View all selected while a meeting preset is active', () => {
    const item = build('/meetings', { state: 'done' }).find(item => item.id === 'meetings')!
    expect(item.sections.flatMap(section => section.items).find(link => link.to === '/meetings')?.active).toBe(false)
  })
  it('disambiguates the projects landing link while retaining overview and task destinations', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/projects'), activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, '/projects'), translate: key => key }).find(item => item.id === 'projects')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.find(link => link.to === '/projects')).toMatchObject({ label: 'nav.viewAll' })
    expect(links.filter(link => link.label === item.label)).toEqual([])
    expect(links.map(link => link.to)).toContain('/projects/dashboard')
    expect(links.map(link => link.to)).toContain('/tasks')
  })
  it('View all clears project filters while preserving the chosen layout', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read'] }
    const current = route('/projects', { mine: '1', status: 'at_risk', view: 'board' })
    const links = contextLinksForModule('projects', actor, '/projects').map(link => link.to === '/projects' ? { ...link, to: { path: '/projects', query: { mine: '1', status: 'at_risk', view: 'board' } } } : link)
    const item = applicationNavigation({ identity: actor, route: current, activeId: 'projects', contextLinks: links, translate: key => key }).find(item => item.id === 'projects')!
    expect(item.sections.flatMap(section => section.items).find(link => link.id === 'projects')?.to).toEqual({ path: '/projects', query: { view: 'board' } })
  })
  it('keeps the Tasks landing page reachable alongside its work destination', () => {
    const actor = { capabilities: ['webvue.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/work'), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/work'), translate: key => key }).find(item => item.id === 'tasks')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.find(link => link.to === '/my-tasks')).toMatchObject({ label: 'nav.viewAll', active: false })
    expect(links.map(link => link.to)).toContain('/work')
  })
  it('marks only Archive selected on the archived project list', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.projects.manage'] }
    const item = applicationNavigation({ identity: actor, route: route('/projects', { archived: '1' }), activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, '/projects').map(link => ({ ...link, active: link.to === '/projects' })), translate: key => key }).find(item => item.id === 'projects')!
    expect(item.actions.find(action => action.id === 'archived-projects')?.active).toBe(true)
    expect(item.sections.flatMap(section => section.items).find(link => link.to === '/projects')?.active).toBe(false)
  })
  it('preserves the Tasks cards layout on its fallback landing link', () => {
    const actor = { capabilities: ['webvue.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/my-tasks', { view: 'cards', q: 'test' }), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/my-tasks'), translate: key => key }).find(item => item.id === 'tasks')!
    expect(item.sections.flatMap(section => section.items).find(link => link.label === 'nav.viewAll')?.to).toEqual({ path: '/my-tasks', query: { view: 'cards' } })
  })
})
