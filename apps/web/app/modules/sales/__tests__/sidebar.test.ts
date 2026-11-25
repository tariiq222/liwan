import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { salesSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => salesSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the sales sidebar menu', () => {
  it('is the sales manifest menu: a create link, the list and its reports, and no recent records', () => {
    expect(manifest.sidebar).toBe(salesSidebar)
    expect(manifest.contextLinks?.('/sales').find(link => link.id === salesSidebar.create)).toMatchObject({ pinned: true, capability: 'sales.quotations.manage' })
    expect(salesSidebar.rows.map(item => [item.id, item.capability])).toEqual([
      ['sales', 'sales.read'],
      ['sales-reports', 'sales.reports.read'],
    ])
    expect(salesSidebar.recent).toBeUndefined()
  })

  it('lights one row per page', () => {
    expect(activeRows(route('/sales'))).toEqual(['sales'])
    expect(activeRows(route('/sales/', { state: 'orders' }))).toEqual(['sales'])
    expect(activeRows(route('/sales/new'))).toEqual(['sales'])
    expect(activeRows(route('/sales/12'))).toEqual(['sales'])
    expect(activeRows(route('/sales/12/edit'))).toEqual(['sales'])
    expect(activeRows(route('/sales/reports'))).toEqual(['sales-reports'])
    expect(activeRows(route('/settings/apps/sales'))).toEqual([])
  })

  it('loads the list count as its total asked for one row', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 31 })
    const loader = salesSidebar.counts![0]!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ sales: 31 })
    expect(api).toHaveBeenCalledWith('/api/v1/sales/orders', expect.objectContaining({ query: { limit: 1 } }))
    expect(loader.queryKey.slice(0, 1)).toEqual(['sales'])
  })
})
