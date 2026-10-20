import { describe, expect, it } from 'vitest'
import { activeManifests, withManifests } from '../manifests'
import { bellKindFor, manifestRoutePrefixes, recordLinkFor, recordPickerFor, routeScopeOf, searchProviders, sidebarPanelFor } from '../surfaces'
import { projectsSearch, tasksSearch } from '../pmo/search'
import type { AppManifest, AppSearchApi } from '../types'

const sales: AppManifest = {
  id: 'sales',
  feature: 'sales.enabled',
  routePrefixes: ['/sales'],
  rail: [{ id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', to: '/sales', order: 90 }],
  nav: [],
  bell: {
    capabilities: ['sales.orders.read'],
    kinds: [{ kind: 'sales_order_assigned', href: row => `/sales/${row.order_id}`, title: row => String(row.title) }],
  },
  search: [{
    id: 'sales-orders',
    labelKey: 'nav.sales',
    capability: 'sales.orders.read',
    icon: 'i-lucide-receipt',
    serverSearch: true,
    queryKey: q => ['search', 'orders', q],
    search: async (_api, q) => ({ rows: [{ id: 1, label: `SO ${q}`, to: '/sales/1' }] }),
  }],
}

describe('manifest search providers', () => {
  it('lists PMO projects then tasks, then finance partners and invoices, in rail order', () => {
    expect(searchProviders().map(p => p.id)).toEqual(['pmo-projects', 'pmo-tasks', 'finance-partners', 'finance-invoices'])
  })
  it('adds a section for a fake application without touching foundation files', () => {
    withManifests([...activeManifests(), sales], () => {
      expect(searchProviders().map(p => p.id)).toEqual(['pmo-projects', 'pmo-tasks', 'finance-partners', 'finance-invoices', 'sales-orders'])
      expect(manifestRoutePrefixes()).toContain('/sales')
    })
    expect(searchProviders().map(p => p.id)).toEqual(['pmo-projects', 'pmo-tasks', 'finance-partners', 'finance-invoices'])
  })
  it('keeps the PMO API urls and shapes', async () => {
    const calls: Array<[string, unknown]> = []
    const api = (async (url: string, options: { query?: unknown, schema: { parse: (d: unknown) => unknown } }) => {
      calls.push([url, options.query])
      return url.endsWith('/projects') ? [{ id: 3, name: 'P' }] : { items: [], total: 0 }
    }) as unknown as AppSearchApi
    expect((await projectsSearch.search(api, 'x', 0)).rows).toEqual([{ id: 3, label: 'P', to: '/projects/3' }])
    await tasksSearch.search(api, 'x', 40)
    expect(calls).toEqual([
      ['/api/v1/projects', { minimal: 1 }],
      ['/api/v1/tasks', { filter: 'mine', q: 'x', limit: 20, offset: 40 }],
    ])
    expect(projectsSearch.queryKey('anything')).toEqual(['search', 'projects'])
    expect(tasksSearch.queryKey('x')).toEqual(['search', 'tasks', 'x'])
  })
})

describe('manifest bell kinds', () => {
  it('routes today\'s kinds', () => {
    expect(bellKindFor('comment')?.href({ task_id: 44 })).toBe('/tasks/44')
    expect(bellKindFor('meeting_invite')?.href({ meeting_id: 7 })).toBe('/meetings/7')
    expect(bellKindFor('overdue_digest')?.href({ digest_id: 90 })).toBe('/notification-digests/90')
    const titleArgs: unknown[][] = []
    bellKindFor('overdue_digest')?.title?.({ overdue_count: '3' }, (...args) => { titleArgs.push(args); return '' })
    expect(titleArgs).toEqual([['tasks.digest.count', 3]])
    for (const kind of ['charter_review', 'charter_approved', 'charter_returned']) {
      expect(bellKindFor(kind)?.href({ project_id: 12 }), kind).toBe('/projects/12/charter')
      expect(bellKindFor(kind)?.title?.({ project_name: 'Alpha' }, key => key), kind).toBe('Alpha')
    }
    expect(bellKindFor('meeting_future_change')).toBeUndefined()
    expect(bellKindFor('sales_order_assigned')).toBeUndefined()
  })
  it('resolves a fake application kind href and title', () => {
    withManifests([...activeManifests(), sales], () => {
      const kind = bellKindFor('sales_order_assigned')
      expect(kind?.href({ order_id: 5 })).toBe('/sales/5')
      expect(kind?.title?.({ title: 'SO-0005' }, key => key)).toBe('SO-0005')
    })
  })
})

describe('manifest sidebar panels', () => {
  it('gives chat a wide panel and no other module one', () => {
    expect(sidebarPanelFor('chat')?.width).toBe('wide')
    expect(typeof sidebarPanelFor('chat')?.load).toBe('function')
    expect(sidebarPanelFor('projects')).toBeUndefined()
    expect(sidebarPanelFor(null)).toBeUndefined()
  })
  it('finds a panel a newer application registers', () => {
    const panel = { module: 'sales', width: 'default' as const, load: async () => ({ default: {} }) }
    withManifests([...activeManifests(), { ...sales, sidebarPanel: panel }], () => {
      expect(sidebarPanelFor('sales')).toBe(panel)
    })
  })
})

describe('manifest record pickers', () => {
  it('gives PMO the project picker and no other kind', () => {
    expect(recordPickerFor('project')?.capability).toBe('pmo.projects.read')
    expect(recordPickerFor('project')?.taskCapability).toBe('pmo.tasks.create')
    expect(recordPickerFor('order')).toBeUndefined()
  })
  it('finds a picker a newer application declares', () => {
    const picker = { kind: 'order', capability: 'sales.orders.read', queryKey: ['orders'] as const, options: async () => [{ id: 1, name: 'SO-1' }] }
    withManifests([...activeManifests(), { ...sales, recordPickers: [picker] }], () => {
      expect(recordPickerFor('order')).toBe(picker)
    })
    expect(recordPickerFor('order')).toBeUndefined()
  })
})

describe('manifest record links', () => {
  it('gives the documents application the document link and no other kind', () => {
    const link = recordLinkFor('document')
    expect(link?.capability).toBe('documents.items.read')
    expect(link?.to(7)).toBe('/documents/7')
    expect(recordLinkFor('order')).toBeUndefined()
  })
  it('finds a link a newer application declares', () => {
    const link = { kind: 'order', capability: 'sales.orders.read', to: (id: number) => `/sales/${id}` }
    withManifests([...activeManifests(), { ...sales, recordLinks: [link] }], () => {
      expect(recordLinkFor('order')).toBe(link)
    })
    expect(recordLinkFor('order')).toBeUndefined()
  })
})

describe('manifest route scopes', () => {
  it('reads the project a PMO path lives inside', () => {
    expect(routeScopeOf('/projects/12/tasks')).toEqual({ kind: 'project', id: 12 })
    expect(routeScopeOf('/projects/dashboard')).toBeNull()
    expect(routeScopeOf('/meetings/12')).toBeNull()
  })
  it('reads the record a newer application declares', () => {
    const scope = { kind: 'order', idFromPath: (path: string) => Number(path.match(/^\/sales\/(\d+)/)?.[1]) || null }
    withManifests([...activeManifests(), { ...sales, routeScopes: [scope] }], () => {
      expect(routeScopeOf('/sales/9/lines')).toEqual({ kind: 'order', id: 9 })
      expect(routeScopeOf('/projects/4')).toEqual({ kind: 'project', id: 4 })
    })
  })
})
