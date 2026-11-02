import { describe, expect, it } from 'vitest'
import type { ProjectEvm } from '@liwan/contracts'
import { evmLineChart, formatIndex, indexBadgeTone, indexTone } from '../evm'

describe('earned value presentation', () => {
  it('colours the index bands: below 0.9 danger, 0.9 to under 1 warning, 1 or more success', () => {
    expect(indexTone(0.89)).toBe('danger')
    expect(indexTone(0)).toBe('danger')
    expect(indexTone(0.9)).toBe('warning')
    expect(indexTone(0.99)).toBe('warning')
    expect(indexTone(1)).toBe('success')
    expect(indexTone(1.4)).toBe('success')
    expect(indexTone(null)).toBe('neutral')
    expect(indexBadgeTone(0.5)).toBe('destructive')
  })

  it('shows two decimals, and the not-enough-data label for a null index', () => {
    expect(formatIndex(0.7, 'n/a')).toBe('0.70')
    expect(formatIndex(1.08, 'n/a')).toBe('1.08')
    expect(formatIndex(null, 'n/a')).toBe('n/a')
  })

  it('builds a line chart with today\'s earned value and actual cost as markers, clamped into the plotted span', () => {
    const evm = {
      as_of: '2026-03-15', pv: 60000, ev: 42000, ac: 48000, planned_curve: [{ date: '2026-03-01', pv: 0 }, { date: '2026-03-30', pv: 120000 }],
    } as ProjectEvm
    const labels = { pv: 'PV', ev: 'EV', ac: 'AC' }
    const chart = evmLineChart(evm, labels, value => `${value} SAR`)!
    expect(chart.data.at(-1)!.x - chart.data[0]!.x).toBe(29)
    expect(chart.markers.map(marker => [marker.key, marker.y, marker.display])).toEqual([['ev', 42000, '42000 SAR'], ['ac', 48000, '48000 SAR']])
    expect(chart.markers[0]!.x - chart.data[0]!.x).toBe(14)
    expect(evmLineChart({ ...evm, as_of: '2026-01-01' }, labels, String)!.markers[0]!.x).toBe(chart.data[0]!.x)
    expect(evmLineChart({ ...evm, as_of: '2027-01-01' }, labels, String)!.markers[0]!.x).toBe(chart.data.at(-1)!.x)
  })

  it('draws nothing without a curve or without plan figures', () => {
    const labels = { pv: 'PV', ev: 'EV', ac: 'AC' }
    expect(evmLineChart({ as_of: '2026-03-15', pv: 0, ev: 0, ac: 0, planned_curve: [] } as unknown as ProjectEvm, labels, String)).toBeNull()
    expect(evmLineChart({ as_of: '2026-03-15', pv: null, ev: null, ac: 5, planned_curve: [] } as unknown as ProjectEvm, labels, String)).toBeNull()
  })
})
