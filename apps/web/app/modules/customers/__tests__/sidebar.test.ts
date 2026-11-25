import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { customersSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => customersSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the customers sidebar menu', () => {
  it('is the customers manifest menu: a create link, one flat row and no recent records', () => {
    expect(manifest.sidebar).toBe(customersSidebar)
    expect(manifest.contextLinks?.('/customers').find(link => link.id === customersSidebar.create)).toMatchObject({ pinned: true, capability: 'customers.manage' })
    expect(customersSidebar.rows.map(item => [item.id, item.capability])).toEqual([['customers', 'customers.read']])
    expect(customersSidebar.recent).toBeUndefined()
  })

  it('keeps the directory lit on its records', () => {
    expect(activeRows(route('/customers'))).toEqual(['customers'])
    expect(activeRows(route('/customers/', { q: 'noor' }))).toEqual(['customers'])
    expect(activeRows(route('/customers/new'))).toEqual(['customers'])
    expect(activeRows(route('/customers/12'))).toEqual(['customers'])
    expect(activeRows(route('/settings/apps/customers'))).toEqual([])
  })

  it('loads the directory count as the list total asked for one row', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 42 })
    const loader = customersSidebar.counts![0]!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ customers: 42 })
    expect(api).toHaveBeenCalledWith('/api/v1/customers', expect.objectContaining({ query: { limit: 1 } }))
    expect(loader.queryKey.slice(0, 1)).toEqual(['customers'])
  })
})
