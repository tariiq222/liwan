import { describe, expect, it } from 'vitest'
import { curveSeries, dayNumber, formatIndex, indexBadgeTone, indexTone } from '../evm'

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

  it('plots the curve on a day axis and keeps today inside the plotted span', () => {
    const curve = [{ date: '2026-03-01', pv: 0 }, { date: '2026-03-30', pv: 120000 }]
    const series = curveSeries(curve, '2026-03-15')
    expect(series.last - series.first).toBe(29)
    expect(series.today - series.first).toBe(14)
    expect(curveSeries(curve, '2026-01-01').today).toBe(series.first)
    expect(curveSeries(curve, '2027-01-01').today).toBe(series.last)
    expect(curveSeries([], '2026-03-15')).toMatchObject({ points: [], today: dayNumber('2026-03-15') })
  })
})
