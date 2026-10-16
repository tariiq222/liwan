import { describe, expect, it } from 'vitest'
import { deltaOf, deltaTone, figureNumber, formatFigure, periodFromQuery, presetRange, toCsv } from '../vendorAnalytics'

describe('presetRange', () => {
  it('starts at the first day of the month, quarter or year', () => {
    expect(presetRange('month', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' })
    expect(presetRange('quarter', '2026-11-20')).toEqual({ from: '2026-10-01', to: '2026-11-20' })
    expect(presetRange('quarter', '2026-03-02')).toEqual({ from: '2026-01-01', to: '2026-03-02' })
    expect(presetRange('year', '2026-10-15')).toEqual({ from: '2026-01-01', to: '2026-10-15' })
  })
})

describe('periodFromQuery', () => {
  const today = '2026-10-15'
  it('defaults to this month', () => {
    expect(periodFromQuery({}, today)).toEqual({ preset: 'month', from: '2026-10-01', to: today })
    expect(periodFromQuery({ period: 'decade' }, today).preset).toBe('month')
  })
  it('reads a valid custom range from the URL', () => {
    expect(periodFromQuery({ period: 'custom', from: '2026-01-05', to: '2026-02-05' }, today)).toEqual({ preset: 'custom', from: '2026-01-05', to: '2026-02-05' })
  })
  it('ignores a disordered, malformed or oversized custom range', () => {
    for (const query of [{ from: '2026-02-05', to: '2026-01-05' }, { from: 'x', to: '2026-01-05' }, { from: '2020-01-01', to: '2026-01-05' }, {}]) {
      expect(periodFromQuery({ period: 'custom', ...query }, today).preset).toBe('month')
    }
  })
})

describe('figures', () => {
  const money = { available: true as const, value: { currency: 'SAR', exponent: 2, minor: 123456 } }
  it('reads numbers and money in minor units, and nothing from an unavailable figure', () => {
    expect(figureNumber(money)).toBe(123456)
    expect(figureNumber({ available: true, value: 0.5 })).toBe(0.5)
    expect(figureNumber({ available: false, reason: 'no_data' })).toBeNull()
  })
  it('formats by kind and leaves an unavailable figure empty', () => {
    expect(formatFigure({ available: true, value: 0.256 }, 'percent', 'en')).toBe('25.6%')
    expect(formatFigure({ available: true, value: 1234 }, 'count', 'en')).toBe('1,234')
    expect(formatFigure(money, 'money', 'en')).toContain('1,234.56')
    expect(formatFigure({ available: false, reason: 'no_cancellation_date' }, 'money', 'en')).toBeNull()
  })
})

describe('delta', () => {
  it('compares with the previous period', () => {
    expect(deltaOf(150, 100)).toEqual({ change: 'up', percent: 0.5 })
    expect(deltaOf(50, 100)).toEqual({ change: 'down', percent: 0.5 })
    expect(deltaOf(100, 100)).toEqual({ change: 'flat', percent: 0 })
    expect(deltaOf(10, 0)).toEqual({ change: 'up', percent: null })
    expect(deltaOf(null, 5)).toBeNull()
  })
  it('judges a change by what a rise means for the figure', () => {
    expect(deltaTone('up', 'up')).toBe('good')
    expect(deltaTone('up', 'down')).toBe('bad')
    expect(deltaTone('down', 'down')).toBe('good')
    expect(deltaTone('flat', 'up')).toBe('neutral')
    expect(deltaTone('up', 'neutral')).toBe('neutral')
  })
})

describe('toCsv', () => {
  it('writes a BOM, quotes cells with commas or quotes, and ends each line with CRLF', () => {
    const csv = toCsv(['a', 'b', 'c', 'd'], [{ section: 'S', metric: 'He said "hi", ok', current: '1', previous: '2' }])
    expect(csv).toBe('﻿a,b,c,d\r\nS,"He said ""hi"", ok",1,2\r\n')
  })
})
