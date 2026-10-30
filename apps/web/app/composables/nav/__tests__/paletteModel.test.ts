import { describe, expect, it } from 'vitest'
import { appManifests, withManifests } from '../../../modules/manifests'
import type { AppCommand, AppManifest } from '../../../modules/types'
import { allNavItems, type NavItem } from '../shellModules'
import {
  commandItems, goKeyProblems, goKeyTargets, goToItems, helpItems, paletteGroups,
  PALETTE_SECTION_LIMIT, visibleCommands, type PaletteSearchSection,
} from '../paletteModel'

const FEATURES = ['pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled']
const identity = (capabilities: string[], writable: string[] = FEATURES) =>
  ({ capabilities, platform: { readable_features: FEATURES, writable_features: writable } })
const writer = identity([
  'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create',
  'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.employees.manage',
])
const ids = (commands: AppCommand[]) => commands.map(command => command.id)
const item = (to: string, goKey?: string): NavItem =>
  ({ to, labelKey: 'nav.x', icon: 'i-lucide-house', shortcut: '', capability: 'x.read', ...(goKey ? { goKey } : {}) })

describe('visibleCommands', () => {
  it('keeps the commands whose capability, feature and route the user holds', () => {
    const visible = ids(visibleCommands(writer))
    expect(visible).toEqual(expect.arrayContaining(['pmo.new-project', 'pmo.new-task', 'meetings.new-meeting', 'hr.new-employee', 'chat.new-conversation']))
    expect(visible).not.toContain('hr.new-department')
  })

  it('hides create commands from a reader', () => {
    const visible = ids(visibleCommands(identity(['pmo.projects.read', 'pmo.tasks.read'])))
    expect(visible).not.toContain('pmo.new-project')
    expect(visible).not.toContain('pmo.new-task')
  })

  it('hides every command in a read-only tenant, whatever the capabilities', () => {
    expect(visibleCommands(identity([...writer.capabilities], []))).toEqual([])
  })

  it('hides the commands of an application whose feature is closed', () => {
    const pmoOnly = { capabilities: writer.capabilities, platform: { readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'] } }
    expect(ids(visibleCommands(pmoOnly)).filter(id => !id.startsWith('pmo.'))).toEqual([])
  })
})

describe('go keys', () => {
  it('reports a reserved g, a malformed key and a letter two destinations claim', () => {
    expect(goKeyProblems([item('/a', 'p'), item('/b', 'p'), item('/c', 'g'), item('/d', 'P'), item('/e')])).toEqual([
      '/c: go key "g" is reserved',
      '/d: go key "P" is not one lower-case letter',
      'go key "p" is declared by /a and /b',
    ])
  })

  it('a new application that reuses p makes the real navigation fail', () => {
    const crm: AppManifest = {
      id: 'crm', feature: 'crm.enabled', routePrefixes: ['/crm'],
      rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 60 }],
      nav: [{ to: '/crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', shortcut: 'q', goKey: 'p', capability: 'crm.leads.read' }],
    }
    withManifests([...appManifests, crm], () => {
      expect(goKeyProblems(allNavItems())).toEqual(['go key "p" is declared by /projects and /crm'])
    })
  })

  it('maps each letter to the first item the user can see', () => {
    expect([...goKeyTargets([item('/a', 'p'), item('/b'), item('/c', 'q'), item('/d', 'p')]).entries()].map(([key, target]) => [key, target.to]))
      .toEqual([['p', '/a'], ['q', '/c']])
  })
})

describe('palette items', () => {
  it('Go to rows carry their G letter as a hidden hint', () => {
    const rows = goToItems([item('/projects', 'p'), item('/tasks')], navItem => navItem.to)
    expect(rows[0]).toMatchObject({ id: 'goto:/projects', label: '/projects', to: '/projects', kbds: ['G', 'P'], kbdsHidden: true })
    expect(rows[1]).toMatchObject({ to: '/tasks' })
    expect(rows[1]!.kbds).toBeUndefined()
  })

  it('commands open their form with a return path', () => {
    const [row] = commandItems(
      [{ id: 'pmo.new-project', labelKey: 'nav.newProject', icon: 'i-lucide-folder-kanban', to: '/projects/new', capability: 'pmo.projects.create' }],
      key => `t:${key}`,
      '/tasks?q=a',
    )
    expect(row).toEqual({ id: 'command:pmo.new-project', label: 't:nav.newProject', icon: 'i-lucide-folder-kanban', to: { path: '/projects/new', query: { returnTo: '/tasks?q=a' } } })
  })

  it('help lists the fixed shortcuts, then one spoken G row per visible letter', () => {
    const rows = helpItems([item('/tasks', 't'), item('/projects', 'p'), item('/x')], key => key, navItem => `go ${navItem.to}`)
    expect(rows[0]).toEqual({ id: 'help:palette', label: 'shortcuts.palette', kbds: ['meta', 'K'], action: { kind: 'none' } })
    expect(rows.slice(-2)).toEqual([
      { id: 'help:go:p', label: 'go /projects', kbds: ['G', 'P'], action: { kind: 'none' } },
      { id: 'help:go:t', label: 'go /tasks', kbds: ['G', 'T'], action: { kind: 'none' } },
    ])
    expect(rows.some(row => row.kbdsHidden)).toBe(false)
  })
})

const labels = { goTo: 'Go to', actions: 'Actions', shortcuts: 'Shortcuts', loading: 'Searching…', error: 'Search failed', loadMore: 'Load more' }
const section = (patch: Partial<PaletteSearchSection> = {}): PaletteSearchSection => ({
  id: 'pmo-tasks', label: 'Tasks', icon: 'i-lucide-check-square', rows: [], waiting: false, error: false,
  hasNext: false, notice: null, ...patch,
})
const base = {
  view: 'main' as const,
  term: '',
  goTo: goToItems([item('/projects', 'p')], () => 'Projects'),
  search: [section({ rows: [{ id: 1, label: 'Fix login', to: '/tasks/1' }] })],
  actions: [{ id: 'command:pmo.new-project', label: 'New project' }],
  help: [],
  returnTo: '/tasks?q=1',
  labels,
}

describe('paletteGroups', () => {
  it('shows Go to then Actions before a term is typed', () => {
    expect(paletteGroups(base).map(group => group.id)).toEqual(['goto', 'actions'])
  })

  it('puts one unfiltered Search group per provider between Go to and Actions; rows return to the page', () => {
    const groups = paletteGroups({ ...base, term: 'fix' })
    expect(groups.map(group => group.id)).toEqual(['goto', 'search-pmo-tasks', 'actions'])
    expect(groups[1]).toEqual({
      id: 'search-pmo-tasks', label: 'Tasks', ignoreFilter: true,
      items: [{ id: 'search:pmo-tasks:1', label: 'Fix login', icon: 'i-lucide-check-square', to: { path: '/tasks/1', query: { returnTo: '/tasks?q=1' } } }],
    })
  })

  it('shows a row caption (tax number, party name) as the option suffix', () => {
    const groups = paletteGroups({ ...base, term: 'vat', search: [section({ rows: [{ id: 1, label: 'Acme', to: '/finance/partners/1', caption: '300000000000003' }] })] })
    expect(groups[1]!.items[0]).toMatchObject({ label: 'Acme', suffix: '300000000000003' })
  })

  it('renders waiting, failed, capped and paged sections as rows', () => {
    const term = 'fix'
    expect(paletteGroups({ ...base, term, search: [section({ waiting: true })] })[1]!.items)
      .toEqual([{ id: 'search:pmo-tasks:loading', label: 'Searching…', loading: true, disabled: true }])
    expect(paletteGroups({ ...base, term, search: [section({ error: true, hasNext: true })] })[1]!.items.map(row => row.action))
      .toEqual([{ kind: 'retry', section: 'pmo-tasks' }])
    expect(paletteGroups({ ...base, term, search: [section({ rows: [{ id: 1, label: 'a', to: '/tasks/1' }], hasNext: true })] })[1]!.items.at(-1))
      .toMatchObject({ label: 'Load more', to: { path: '/search', query: { q: term, provider: 'pmo-tasks', returnTo: base.returnTo } } })
    expect(paletteGroups({ ...base, term, search: [section({ notice: 'Only the first 200' })] })[1]!.items)
      .toEqual([{ id: 'search:pmo-tasks:notice', label: 'Only the first 200', icon: 'i-lucide-info', disabled: true }])
  })

  it(`caps a section at ${PALETTE_SECTION_LIMIT} rows and drops empty groups`, () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ id: index, label: `t${index}`, to: `/tasks/${index}` }))
    const groups = paletteGroups({ ...base, term: 't', goTo: [], actions: [], search: [section({ rows })] })
    expect(groups.map(group => group.id)).toEqual(['search-pmo-tasks'])
    expect(groups[0]!.items).toHaveLength(PALETTE_SECTION_LIMIT + 1)
  })

  it('the shortcuts view shows only the help', () => {
    expect(paletteGroups({ ...base, term: 'x', view: 'shortcuts', help: [{ id: 'help:x', label: 'x' }] }))
      .toEqual([{ id: 'shortcuts', label: 'Shortcuts', items: [{ id: 'help:x', label: 'x' }] }])
  })
})
