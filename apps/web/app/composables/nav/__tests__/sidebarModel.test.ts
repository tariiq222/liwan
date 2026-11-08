import { describe, expect, it } from 'vitest'
import type { ShellContextLink, ShellModuleDefinition } from '../shellModules'
import { contextLinkTestId, groupSections, pinnedCreateLinks, railModel } from '../sidebarModel'

const link = (id: string, extra: Partial<ShellContextLink> = {}): ShellContextLink =>
  ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, capability: 'x.y.read', ...extra })

describe('rail model', () => {
  const module = (id: string, extra: Partial<ShellModuleDefinition> = {}): ShellModuleDefinition => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, ...extra })
  const modules = [
    module('home', { to: '/' }), module('tasks'), module('meetings', { fixed: 'first' }), module('projects'), module('documents', { fixed: 'last' }),
    module('chat'), module('assistant', { fixed: 'top' }), module('settings'),
  ]

  it('puts the assistant and home on top, meetings first, the applications, documents last, then settings', () => {
    const rail = railModel(modules)
    expect(rail.top.map(item => item.id)).toEqual(['assistant', 'home'])
    expect(rail.first.map(item => item.id)).toEqual(['meetings'])
    expect(rail.applications.map(item => item.id)).toEqual(['tasks', 'projects', 'chat'])
    expect(rail.last.map(item => item.id)).toEqual(['documents'])
    expect(rail.utility.map(item => item.id)).toEqual(['settings'])
    expect(rail.all.map(item => item.id)).toEqual(['assistant', 'home', 'meetings', 'tasks', 'projects', 'chat', 'documents', 'settings'])
  })

  it('never inserts an application not supplied by the permission-filtered model', () => {
    expect(railModel(modules.filter(item => item.id !== 'chat')).applications.map(item => item.id)).toEqual(['tasks', 'projects'])
    expect(railModel([]).applications).toEqual([])
    expect(railModel([]).top.map(item => item.id)).toEqual(['apps'])
  })
})

describe('create links', () => {
  const links = [link('new-project', { pinned: true, to: '/projects/new' }), link('new-task', { pinned: true }), link('tasks')]
  it('lists the pinned links first for the open page and hides «مشروع جديد» on the projects list and inside a project', () => {
    expect(pinnedCreateLinks(links, '/tasks').map(item => item.id)).toEqual(['new-project', 'new-task'])
    for (const path of ['/projects', '/projects/new', '/projects/7', '/projects/7/tasks/3']) expect(pinnedCreateLinks(links, path).map(item => item.id)).toEqual(['new-task'])
  })
})

describe('section grouping', () => {
  it('groups consecutive links by section with unique ids', () => {
    const sections = groupSections([link('a'), link('b', { section: 'nav.s1' }), link('c', { section: 'nav.s1' }), link('d')])
    expect(sections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([[null, ['a']], ['nav.s1', ['b', 'c']], [null, ['d']]])
    expect(new Set(sections.map(section => section.id)).size).toBe(3)
  })

  it('keeps the three legacy Playwright ids', () => {
    expect(contextLinkTestId('users')).toBe('sidebar-settings')
    expect(contextLinkTestId('settings-projects')).toBe('settings-projects-tab')
    expect(contextLinkTestId('branding')).toBe('settings-branding-tab')
    expect(contextLinkTestId('tasks')).toBe('context-link-tasks')
  })
})
