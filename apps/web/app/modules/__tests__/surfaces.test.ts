import { describe, expect, it } from 'vitest'
import { activeManifests, withManifests } from '../manifests'
import { bellKindFor, manifestRoutePrefixes, searchProviders } from '../surfaces'
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
  it('lists PMO projects then tasks today, tasks on the dialog only', () => {
    expect(searchProviders('dialog').map(p => p.id)).toEqual(['pmo-projects', 'pmo-tasks'])
    expect(searchProviders('page').map(p => p.id)).toEqual(['pmo-projects'])
  })
  it('adds a section for a fake application without touching foundation files', () => {
    withManifests([...activeManifests(), sales], () => {
      expect(searchProviders('page').map(p => p.id)).toEqual(['pmo-projects', 'sales-orders'])
      expect(manifestRoutePrefixes()).toContain('/sales')
    })
    expect(searchProviders('page').map(p => p.id)).toEqual(['pmo-projects'])
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
