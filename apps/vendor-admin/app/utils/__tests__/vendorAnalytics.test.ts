import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deltaOf, deltaTone, figureNumber, formatFigure, periodFromQuery, presetRange, riyadhToday, signupFunnelLabel, toCsv } from '../vendorAnalytics'

describe('riyadhToday', () => {
  it('reads the calendar day in Asia/Riyadh, not UTC', () => {
    expect(riyadhToday(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16')
    expect(riyadhToday(new Date('2026-10-15T20:30:00Z'))).toBe('2026-10-15')
  })
})

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
  it('writes its own formatted figures as they are, even a negative or signed one', () => {
    expect(toCsv(['a', 'b', 'c', 'd'], [{ section: 'قسم', metric: 'صافي', current: '-SAR 5.00', previous: '+12%' }])).toBe('﻿a,b,c,d\r\nقسم,صافي,-SAR 5.00,+12%\r\n')
  })
})

describe('signupFunnelLabel', () => {
  const localesRoot = resolve(import.meta.dirname, '../../../i18n/locales')
  function makeI18n(lang: 'ar' | 'en') {
    const messages = {
      ...JSON.parse(readFileSync(resolve(localesRoot, lang, 'analytics.json'), 'utf8')),
      ...JSON.parse(readFileSync(resolve(localesRoot, lang, 'vendor.json'), 'utf8')),
    } as Record<string, unknown>
    const lookup = (key: string): string | undefined => {
      let current: unknown = messages
      for (const part of key.split('.')) {
        if (!current || typeof current !== 'object' || !(part in current)) return undefined
        current = (current as Record<string, unknown>)[part]
      }
      return typeof current === 'string' ? current : undefined
    }
    return {
      t: (key: string) => lookup(key) ?? key,
      te: (key: string) => lookup(key) !== undefined,
    }
  }

  it('formats base-only, single-app, multi-app, and unknown cohorts in Arabic and English', () => {
    const en = makeI18n('en')
    const ar = makeI18n('ar')

    expect(signupFunnelLabel({ apps: [] }, en.t, en.te)).toBe('Base only')
    expect(signupFunnelLabel({ apps: [] }, ar.t, ar.te)).toBe('الأساس فقط')

    expect(signupFunnelLabel({ apps: ['projects'] }, en.t, en.te)).toBe('Projects')
    expect(signupFunnelLabel({ apps: ['projects'] }, ar.t, ar.te)).toBe('المشاريع')

    expect(signupFunnelLabel({ apps: ['finance', 'projects'] }, en.t, en.te)).toBe('Finance + Projects')
    expect(signupFunnelLabel({ apps: ['finance', 'projects'] }, ar.t, ar.te)).toBe('المالية + المشاريع')

    expect(signupFunnelLabel({ apps: ['crm', 'inbox'] }, en.t, en.te)).toBe('Customer management + Customer inbox')
    expect(signupFunnelLabel({ apps: ['crm', 'inbox'] }, ar.t, ar.te)).toBe('إدارة العملاء + صندوق رسائل العملاء')

    expect(signupFunnelLabel({ apps: ['custom_app'] }, en.t, en.te)).toBe('custom_app')
  })
})
