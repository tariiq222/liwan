import { describe, expect, it } from 'vitest'
import { productKpiTiles } from '../productKpis'

const t = (key: string) => key

describe('productKpiTiles', () => {
  it('builds total, goods, and services tiles preserving q and archived scope', () => {
    const tiles = productKpiTiles(
      { total: 25, goods: 15, services: 10 },
      { q: 'plan', archived: true },
      t,
    )
    const base = '/products?q=plan&archived=1'
    expect(tiles).toEqual([
      { id: 'total', label: 'products.kpi.total', icon: 'i-lucide-package', tone: 'neutral', value: 25, to: base, clearTo: base },
      { id: 'goods', label: 'products.kpi.goods', icon: 'i-lucide-box', tone: 'neutral', value: 15, to: `${base}&type=goods`, clearTo: base },
      { id: 'services', label: 'products.kpi.services', icon: 'i-lucide-briefcase', tone: 'neutral', value: 10, to: `${base}&type=service`, clearTo: base },
    ])
  })

  it('returns clean unfiltered links and null values while pending', () => {
    const tiles = productKpiTiles({}, { q: '', archived: false }, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, null, null])
    expect(tiles.map(tile => tile.to)).toEqual([
      '/products',
      '/products?type=goods',
      '/products?type=service',
    ])
    expect(tiles.map(tile => tile.clearTo)).toEqual(['/products', '/products', '/products'])
  })

  it('leaves the tile reusing the list total null while that total is a placeholder', () => {
    const tiles = productKpiTiles({ total: undefined, goods: 15, services: 10 }, { q: 'plan' }, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, 15, 10])
  })
})
