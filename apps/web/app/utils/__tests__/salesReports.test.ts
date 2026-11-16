import { describe, expect, it } from 'vitest'
import type { SalesReportSummary } from '@liwan/contracts'
import { periodLabel, salesReportTiles } from '../salesReports'

const summary: SalesReportSummary = {
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' },
  confirmed: { orders: 3, amount_untaxed: 300, amount_total: 345 },
  quotations: { orders: 1, amount_untaxed: 50, amount_total: 57.5 },
  cancelled: { orders: 0, amount_untaxed: 0, amount_total: 0 },
}
const t = (key: string, named?: Record<string, unknown>) => `${key}${named ? JSON.stringify(named) : ''}`

describe('the report tiles', () => {
  it('show confirmed orders and total, open quotations and cancelled documents in the company currency', () => {
    const tiles = salesReportTiles(summary, t, 'en')
    expect(tiles.map(tile => tile.id)).toEqual(['confirmedOrders', 'confirmedTotal', 'quotations', 'cancelled'])
    expect(tiles[0]!.value).toBe(3)
    expect(tiles[1]!.value).toMatch(/345/)
    expect(tiles[1]!.value).toMatch(/SAR/)
    expect(tiles[1]!.hint).toContain('300')
    expect(tiles[2]!.value).toBe(1)
  })

  it('warn only when something was cancelled', () => {
    expect(salesReportTiles(summary, t, 'en')[3]!.tone).toBe('neutral')
    expect(salesReportTiles({ ...summary, cancelled: { orders: 2, amount_untaxed: 10, amount_total: 11 } }, t, 'en')[3]!.tone).toBe('warning')
  })
})

describe('a period label', () => {
  it('names a month by month and year, a day or week by its start day, whatever the time zone', () => {
    expect(periodLabel('2026-01-01', 'month', 'en')).toBe('January 2026')
    expect(periodLabel('2026-01-20', 'day', 'en')).toBe('Jan 20, 2026')
  })

  it('keeps a key it cannot read', () => {
    expect(periodLabel('soon', 'day', 'en')).toBe('soon')
  })
})
