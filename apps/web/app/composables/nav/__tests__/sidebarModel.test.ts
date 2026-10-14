import { describe, expect, it } from 'vitest'
import type { ShellContextLink } from '../shellModules'
import { contextLinkTestId, groupSections, railModel, sidebarModel } from '../sidebarModel'

const link = (id: string, extra: Partial<ShellContextLink> = {}): ShellContextLink =>
  ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, capability: 'x.y.read', ...extra })

describe('rail model', () => {
  it('keeps rail order and puts settings and the console in the utility slot', () => {
    const rail = railModel([
      { id: 'home', labelKey: 'nav.home', icon: 'i-lucide-house', to: '/projects/dashboard' },
      { id: 'settings', labelKey: 'nav.settings', icon: 'i-lucide-settings', to: '/settings/users' },
      { id: 'management', labelKey: 'nav.management', icon: 'i-lucide-building-2', to: '/vendor/overview' },
      { id: 'vendor', labelKey: 'nav.console', icon: 'i-lucide-wrench', to: '/odoo' },
    ])
    expect(rail.all.map(item => item.id)).toEqual(['home', 'settings', 'management', 'vendor'])
    expect(rail.primary.map(item => item.id)).toEqual(['home', 'management'])
    expect(rail.utility.map(item => item.id)).toEqual(['settings', 'vendor'])
    expect(rail.all.filter(item => item.external).map(item => item.id)).toEqual(['vendor'])
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
    expect(model).toEqual({ createLinks: [], sections: [], showNav: false })
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

  it('keeps the three legacy Playwright ids', () => {
    expect(contextLinkTestId('users')).toBe('sidebar-settings')
    expect(contextLinkTestId('project-settings')).toBe('settings-projects-tab')
    expect(contextLinkTestId('branding')).toBe('settings-branding-tab')
    expect(contextLinkTestId('tasks')).toBe('context-link-tasks')
  })
})
