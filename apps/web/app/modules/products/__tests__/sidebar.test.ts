import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { productsSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => productsSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the products sidebar menu', () => {
  it('is the products manifest menu: a create link, one flat row and no recent records', () => {
    expect(manifest.sidebar).toBe(productsSidebar)
    expect(manifest.contextLinks?.('/products').find(link => link.id === productsSidebar.create)).toMatchObject({ pinned: true, capability: 'products.manage' })
    expect(productsSidebar.rows.map(item => [item.id, item.capability])).toEqual([['products', 'products.read']])
    expect(productsSidebar.recent).toBeUndefined()
  })

  it('keeps the catalog lit on its records', () => {
    expect(activeRows(route('/products'))).toEqual(['products'])
    expect(activeRows(route('/products/', { type: 'service' }))).toEqual(['products'])
    expect(activeRows(route('/products/new'))).toEqual(['products'])
    expect(activeRows(route('/products/12/edit'))).toEqual(['products'])
    expect(activeRows(route('/settings/apps/products'))).toEqual([])
  })

  it('loads the catalog count as the list total asked for one row', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 25 })
    const loader = productsSidebar.counts![0]!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ products: 25 })
    expect(api).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining({ query: { limit: 1 } }))
    expect(loader.queryKey.slice(0, 1)).toEqual(['products'])
  })
})
