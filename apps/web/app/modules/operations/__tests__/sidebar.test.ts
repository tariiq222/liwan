import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { operationsSidebar } from '../sidebar'
import { applicationNavigation } from '../../../composables/nav/applicationNavigation'
import { contextLinksForModule } from '../../../composables/nav/shellModules'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => operationsSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the operations sidebar menu', () => {
  it('keeps the manifest create action, three flat rows in original order, and no recent section', () => {
    expect(manifest.sidebar).toBe(operationsSidebar)
    expect(manifest.contextLinks?.('/operations').find(link => link.id === operationsSidebar.create)).toMatchObject({ pinned: true, capability: 'operations.requests.create' })
    expect(operationsSidebar.rows.map(item => [item.id, item.labelKey, item.to.path, item.capability])).toEqual([
      ['operation-mine', 'operations.nav.mine', '/operations', 'operations.requests.read'],
      ['operation-pending', 'operations.nav.pending', '/operations/pending', 'operations.requests.read'],
      ['operation-monitoring', 'operations.nav.monitoring', '/operations/monitoring', 'operations.monitoring.read'],
    ])
    expect(manifest.nav.map(item => [item.to, item.shortcut, item.capability])).toEqual([
      ['/operations', 'o', 'operations.requests.read'],
      ['/operations/pending', 'p', 'operations.requests.read'],
      ['/operations/monitoring', 'v', 'operations.monitoring.read'],
    ])
    expect(operationsSidebar.recent).toBeUndefined()
  })

  it('lights the owning row for each operations route', () => {
    expect(activeRows(route('/operations'))).toEqual(['operation-mine'])
    expect(activeRows(route('/operations/new'))).toEqual(['operation-mine'])
    expect(activeRows(route('/operations/42'))).toEqual(['operation-mine'])
    expect(activeRows(route('/operations/42/edit'))).toEqual(['operation-mine'])
    expect(activeRows(route('/operations/pending'))).toEqual(['operation-pending'])
    expect(activeRows(route('/operations/monitoring'))).toEqual(['operation-monitoring'])
  })

  it('loads capability-gated live totals using limit=1 and invalidatable request query keys', async () => {
    expect(operationsSidebar.counts?.map(loader => loader.capability)).toEqual([
      'operations.requests.read',
      'operations.monitoring.read',
    ])

    const requestsApi = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 6 })
      .mockResolvedValueOnce({ items: [], total: 2 })
    const requestsLoader = operationsSidebar.counts![0]!
    expect(await requestsLoader.load(requestsApi as unknown as AppSearchApi)).toEqual({
      'operation-mine': 6,
      'operation-pending': 2,
    })
    expect(requestsApi).toHaveBeenNthCalledWith(1, '/api/v1/operations/requests', expect.objectContaining({ query: { scope: 'mine', purpose: 'work', limit: 1 } }))
    expect(requestsApi).toHaveBeenNthCalledWith(2, '/api/v1/operations/requests', expect.objectContaining({ query: { scope: 'pending', limit: 1 } }))
    expect(requestsLoader.queryKey.slice(0, 2)).toEqual(['operations', 'requests'])

    const monitoringApi = vi.fn().mockResolvedValueOnce({ items: [], total: 11 })
    const monitoringLoader = operationsSidebar.counts![1]!
    expect(await monitoringLoader.load(monitoringApi as unknown as AppSearchApi)).toEqual({
      'operation-monitoring': 11,
    })
    expect(monitoringApi).toHaveBeenCalledWith('/api/v1/operations/requests', expect.objectContaining({ query: { scope: 'monitoring', limit: 1 } }))
    expect(monitoringLoader.queryKey.slice(0, 2)).toEqual(['operations', 'requests'])
  })

  it('renders arrived counts on permitted rows only through applicationNavigation', () => {
    const actor = { capabilities: ['liwan.internal', 'operations.requests.read', 'operations.requests.create'] }
    const item = applicationNavigation({
      identity: actor,
      route: { path: '/operations', fullPath: '/operations', query: {}, params: {} },
      activeId: 'operations',
      contextLinks: contextLinksForModule('operations', actor, '/operations'),
      sidebarCounts: { 'operation-mine': 6, 'operation-pending': 2, 'operation-monitoring': 11 },
      translate: key => key,
    }).find(entry => entry.id === 'operations')!
    const rows = item.sections.flatMap(section => section.items)
    expect(rows.map(row => [row.id, row.count])).toEqual([
      ['operation-mine', 6],
      ['operation-pending', 2],
    ])
    expect(item.actions.map(action => action.id)).toEqual(['new-operation'])
  })
})
