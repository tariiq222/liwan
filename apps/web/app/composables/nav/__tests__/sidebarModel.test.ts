import { describe, expect, it } from 'vitest'
import type { ShellContextLink, ShellModuleDefinition } from '../shellModules'
import { contextLinkTestId, groupSections, pinnedCreateLinks, railModel } from '../sidebarModel'

const link = (id: string, extra: Partial<ShellContextLink> = {}): ShellContextLink =>
  ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, capability: 'x.y.read', ...extra })

describe('rail model', () => {
  const module = (id: string, extra: Partial<ShellModuleDefinition> = {}): ShellModuleDefinition => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, ...extra })
  const modules = [
    module('home', { to: '/' }), module('tasks', { core: 2 }), module('meetings', { core: 3 }), module('projects'), module('documents', { core: 5 }),
    module('chat', { core: 4 }), module('assistant', { core: 1 }), module('crm'), module('settings'),
  ]

  it('puts home and the core applications by their position first, then the pinnable applications, then settings', () => {
    const rail = railModel(modules)
    expect(rail.core.map(item => item.id)).toEqual(['home', 'assistant', 'tasks', 'meetings', 'chat', 'documents'])
    expect(rail.applications.map(item => item.id)).toEqual(['projects', 'crm'])
    expect(rail.utility.map(item => item.id)).toEqual(['settings'])
    expect(rail.all.map(item => item.id)).toEqual(['home', 'assistant', 'tasks', 'meetings', 'chat', 'documents', 'projects', 'crm', 'settings'])
  })

  it('never inserts an application not supplied by the permission-filtered model', () => {
    const rail = railModel(modules.filter(item => item.id !== 'chat' && item.id !== 'crm'))
    expect(rail.core.map(item => item.id)).toEqual(['home', 'assistant', 'tasks', 'meetings', 'documents'])
    expect(rail.applications.map(item => item.id)).toEqual(['projects'])
    expect(railModel([]).applications).toEqual([])
    expect(railModel([]).core.map(item => item.id)).toEqual(['apps'])
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
