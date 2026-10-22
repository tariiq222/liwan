import { describe, expect, it } from 'vitest'
import type { ShellContextLink, ShellModuleDefinition } from '../shellModules'
import { contextLinkTestId, groupSections, pinnableModules, railActiveId, railModel, sidebarModel, subListSections } from '../sidebarModel'

const link = (id: string, extra: Partial<ShellContextLink> = {}): ShellContextLink =>
  ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, capability: 'x.y.read', ...extra })

describe('rail model', () => {
  const module = (id: string, extra: Partial<ShellModuleDefinition> = {}): ShellModuleDefinition => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, ...extra })
  const modules = [
    module('home', { to: '/' }), module('tasks'), module('projects'), module('chat'),
    module('settings', { utility: true }), module('assistant', { utility: true }),
  ]

  it('puts the launcher and today on top, then the pins in pin order, customize, and the utility slot with settings last', () => {
    const rail = railModel(modules, ['chat', 'tasks'])
    expect(rail.top.map(item => [item.id, item.to])).toEqual([['apps', '/apps'], ['home', '/']])
    expect(rail.pinned.map(item => item.id)).toEqual(['chat', 'tasks'])
    expect(rail.customize).toMatchObject({ id: 'customize', to: '/apps', icon: 'i-lucide-plus' })
    expect(rail.utility.map(item => item.id)).toEqual(['assistant', 'settings'])
  })

  it('lists today once, and never lists an unpinned application in the displayed groups', () => {
    const rail = railModel(modules, ['tasks'])
    const shown = [...rail.top, ...rail.pinned, ...rail.utility].map(item => item.id)
    expect(shown.filter(id => id === 'home')).toHaveLength(1)
    expect(shown).not.toContain('projects')
    expect(shown).not.toContain('chat')
  })

  it('keeps every reachable application in the flat list, pinned first, so an unpinned one still resolves', () => {
    const rail = railModel(modules, ['chat'])
    expect(rail.all.map(item => item.id)).toEqual(['apps', 'home', 'chat', 'tasks', 'projects', 'assistant', 'settings'])
  })

  it('drops a pin that is no longer reachable and shows nothing pinned for an empty list', () => {
    expect(railModel(modules, ['gone', 'tasks']).pinned.map(item => item.id)).toEqual(['tasks'])
    expect(railModel(modules, []).pinned).toEqual([])
  })

  it('lists the rail as drawn for the mobile drawer, customize included', () => {
    expect(railModel(modules, ['tasks', 'projects']).drawer.map(item => item.id)).toEqual(['apps', 'home', 'tasks', 'projects', 'customize', 'assistant', 'settings'])
  })

  it('leaves out today when the user cannot reach it', () => {
    expect(railModel(modules.filter(item => item.id !== 'home'), ['tasks']).top.map(item => item.id)).toEqual(['apps'])
  })

  it('lights the active entry, and the launcher stands in for an unpinned application', () => {
    const rail = railModel(modules, ['tasks'])
    expect(railActiveId(rail, 'tasks')).toBe('tasks')
    expect(railActiveId(rail, 'home')).toBe('home')
    expect(railActiveId(rail, 'apps')).toBe('apps')
    expect(railActiveId(rail, 'settings')).toBe('settings')
    expect(railActiveId(rail, 'projects')).toBe('apps')
    expect(railActiveId(rail, null)).toBeNull()
  })

  it('names the pinnable modules: applications only', () => {
    expect(pinnableModules(modules).map(item => item.id)).toEqual(['tasks', 'projects', 'chat'])
  })
})

describe('sidebar model', () => {
  const projects = [link('projects'), link('new-project', { pinned: true, to: '/projects/new' }), link('tasks')]
  const chat = [link('new-chat', { pinned: true }), link('chat')]

  it('puts pinned create actions first and hides new project on the projects list', () => {
    const onTasks = sidebarModel({ links: projects, moduleLabelKey: 'nav.projects', path: '/tasks', panel: null, surface: 'desktop' })
    expect(onTasks.createLinks.map(item => item.id)).toEqual(['new-project'])
    expect(onTasks.sections.flatMap(section => section.links.map(item => item.id))).toEqual(['projects', 'tasks'])
    expect(sidebarModel({ links: projects, moduleLabelKey: 'nav.projects', path: '/projects', panel: null, surface: 'desktop' }).createLinks).toEqual([])
  })

  it('gives an expanded desktop panel the whole sidebar', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: { expanded: true }, surface: 'desktop' })
    expect(model).toEqual({ createLinks: [], sections: [], subSections: [], showNav: false })
  })

  it('shows the links but no create action beside a collapsed panel', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.other', path: '/chat', panel: { expanded: false }, surface: 'desktop' })
    expect(model.createLinks).toEqual([])
    expect(model.sections.flatMap(section => section.links.map(item => item.id))).toEqual(['chat'])
    expect(model.showNav).toBe(true)
  })

  it('hides a lone desktop link that only repeats the heading', () => {
    expect(sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: { expanded: false }, surface: 'desktop' }).showNav).toBe(false)
  })

  it('ignores the panel in the mobile drawer', () => {
    const model = sidebarModel({ links: chat, moduleLabelKey: 'nav.chat', path: '/chat', panel: null, surface: 'mobile' })
    expect(model.createLinks.map(item => item.id)).toEqual(['new-chat'])
    expect(model.showNav).toBe(true)
  })

  it('groups consecutive links by section with unique ids', () => {
    const sections = groupSections([link('a'), link('b', { section: 'nav.s1' }), link('c', { section: 'nav.s1' }), link('d')])
    expect(sections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([[null, ['a']], ['nav.s1', ['b', 'c']], [null, ['d']]])
    expect(new Set(sections.map(section => section.id)).size).toBe(3)
  })

  it('keeps untitled links in the first card and moves titled sections to the sub-list', () => {
    const links = [link('users'), link('apps', { section: 'nav.apps' }), link('billing', { section: 'nav.apps' })]
    for (const surface of ['desktop', 'mobile'] as const) {
      const model = sidebarModel({ links, moduleLabelKey: 'nav.settings', path: '/settings', panel: null, surface })
      expect(model.sections.map(section => section.links.map(item => item.id))).toEqual([['users']])
      expect(model.subSections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([['nav.apps', ['apps', 'billing']]])
      expect(model.showNav).toBe(true)
    }
  })

  it('heads a run of first-card links with their group', () => {
    const links = [link('overview'), link('company'), link('finance', { group: 'nav.apps' }), link('projects', { group: 'nav.apps' }), link('system'), link('card', { section: 'nav.finance' })]
    const model = sidebarModel({ links, moduleLabelKey: 'nav.settings', path: '/settings/apps/finance', panel: null, surface: 'desktop' })
    expect(model.sections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([[null, ['overview', 'company']], ['nav.apps', ['finance', 'projects']], [null, ['system']]])
    expect(model.subSections.map(section => [section.titleKey, section.links.map(item => item.id)])).toEqual([['nav.finance', ['card']]])
  })

  it('lists no first-card navigation when every link sits under a heading', () => {
    const model = sidebarModel({ links: [link('a', { section: 'nav.s' })], moduleLabelKey: 'nav.other', path: '/a', panel: null, surface: 'desktop' })
    expect(model.sections).toEqual([])
    expect(model.showNav).toBe(false)
    expect(model.subSections).toHaveLength(1)
  })

  it('builds the sub-list rows with translated labels and test ids', () => {
    const [section] = subListSections(groupSections([link('apps', { section: 'nav.s1', active: true })]), key => `t:${key}`, id => `hook-${id}`)
    expect(section).toMatchObject({ title: 't:nav.s1', items: [{ id: 'apps', label: 't:nav.apps', to: '/apps', active: true, testId: 'hook-apps' }] })
  })

  it('keeps the three legacy Playwright ids', () => {
    expect(contextLinkTestId('users')).toBe('sidebar-settings')
    expect(contextLinkTestId('settings-projects')).toBe('settings-projects-tab')
    expect(contextLinkTestId('branding')).toBe('settings-branding-tab')
    expect(contextLinkTestId('tasks')).toBe('context-link-tasks')
  })
})
