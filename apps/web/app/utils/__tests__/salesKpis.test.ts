import { describe, expect, it } from 'vitest'
import { salesKpiTiles } from '../salesKpis'

const t = (key: string) => key

describe('salesKpiTiles', () => {
  it('builds quotations, orders, and cancelled tiles preserving q, source, and mine in to and clearTo', () => {
    const tiles = salesKpiTiles(
      { quotations: 6, orders: 14, cancelled: 2 },
      { q: 'S00', source: 'staff', mine: true },
      t,
    )
    const base = '/sales?q=S00&source=staff&mine=1'
    expect(tiles).toEqual([
      { id: 'quotations', label: 'sales.kpi.quotations', icon: 'i-lucide-file-text', tone: 'neutral', value: 6, to: `${base}&state=quotations`, clearTo: base },
      { id: 'orders', label: 'sales.kpi.orders', icon: 'i-lucide-circle-check', tone: 'success', value: 14, to: `${base}&state=orders`, clearTo: base },
      { id: 'cancelled', label: 'sales.kpi.cancelled', icon: 'i-lucide-circle-x', tone: 'danger', value: 2, to: `${base}&state=cancelled`, clearTo: base },
    ])
  })

  it('uses neutral tone when cancelled is zero and null values while counts are pending', () => {
    const zero = salesKpiTiles({ quotations: 0, orders: 0, cancelled: 0 }, {}, t)
    expect(zero[2]?.tone).toBe('neutral')
    expect(zero.map(tile => tile.clearTo)).toEqual(['/sales', '/sales', '/sales'])

    const pending = salesKpiTiles({}, { source: null, mine: false }, t)
    expect(pending.map(tile => tile.value)).toEqual([null, null, null])
    expect(pending.map(tile => tile.to)).toEqual([
      '/sales?state=quotations',
      '/sales?state=orders',
      '/sales?state=cancelled',
    ])
  })
})
