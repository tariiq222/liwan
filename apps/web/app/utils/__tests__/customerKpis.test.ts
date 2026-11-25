import { describe, expect, it } from 'vitest'
import { customerKpiTiles } from '../customerKpis'

const t = (key: string) => key

describe('customerKpiTiles', () => {
  it('computes total from active + archived, leaves the total unlinked, and preserves search scope on to/clearTo', () => {
    const tiles = customerKpiTiles({ active: 18, archived: 4 }, { q: 'noor' }, t)
    const base = '/customers?q=noor'
    expect(tiles).toEqual([
      { id: 'total', label: 'customers.kpi.total', icon: 'i-lucide-users', tone: 'neutral', value: 22, active: false },
      { id: 'active', label: 'customers.kpi.active', icon: 'i-lucide-user-check', tone: 'success', value: 18, to: base, clearTo: base },
      { id: 'archived', label: 'customers.kpi.archived', icon: 'i-lucide-archive', tone: 'neutral', value: 4, to: '/customers?q=noor&archived=1', clearTo: base },
    ])
  })

  it('leaves total null until both active and archived totals arrive', () => {
    const partial = customerKpiTiles({ active: 10 }, {}, t)
    expect(partial.map(tile => tile.value)).toEqual([null, 10, null])
    expect(partial.map(tile => tile.clearTo)).toEqual([undefined, '/customers', '/customers'])
    expect(partial[0]?.to).toBeUndefined()
    expect(partial[2]?.to).toBe('/customers?archived=1')
  })

  it('leaves the tile reusing the list total null while that total is a placeholder', () => {
    // The archived list is open: its count comes from the list total, the active count from its own query.
    const tiles = customerKpiTiles({ active: 18, archived: undefined }, {}, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, 18, null])
  })
})
