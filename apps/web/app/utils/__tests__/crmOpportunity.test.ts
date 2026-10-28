import { describe, expect, it } from 'vitest'
import { activeFilterCount, formatPrice, movableStages, derivedDiscountPercent, isCallDue, opportunityFilters, opportunityListLocation, relativeTime, safeCrmReturnTo } from '../crmOpportunity'

describe('opportunityFilters', () => {
  it('reads ids, flags and the search from the route query', () => {
    expect(opportunityFilters({ stage_id: '2', user_id: ['3'], due: '1', unassigned: '1', q: '  ليلى ' })).toEqual({ stage_id: 2, user_id: 3, due: true, unassigned: true, q: 'ليلى' })
  })
  it('ignores bad ids, other flag values and empty text', () => {
    expect(opportunityFilters({ stage_id: 'x', source_id: '-1', due: '0', needs_manager: 'yes', q: '   ' })).toEqual({})
  })
  it('counts every active filter', () => {
    expect(activeFilterCount({ stage_id: '1', due: '1', page: '3', view: 'board' })).toBe(2)
  })
})

describe('opportunityListLocation', () => {
  it('keeps the filters, the view and the page and drops the rest', () => {
    expect(opportunityListLocation({ due: '1', view: 'board', page: '2', returnTo: '/x' }, '#top')).toBe('/crm/opportunities?due=1&view=board&page=2#top')
  })
  it('is the bare path without a query', () => {
    expect(opportunityListLocation({})).toBe('/crm/opportunities')
  })
})

describe('safeCrmReturnTo', () => {
  it('accepts only the opportunity list', () => {
    expect(safeCrmReturnTo('/crm/opportunities?due=1', '/f')).toBe('/crm/opportunities?due=1')
    expect(safeCrmReturnTo('/crm/imports', '/f')).toBe('/f')
    expect(safeCrmReturnTo('//evil.test', '/f')).toBe('/f')
  })
})

describe('derivedDiscountPercent', () => {
  it('matches the server: the share of the package price given away, to two decimals', () => {
    expect(derivedDiscountPercent(120, 108)).toBe(10)
    expect(derivedDiscountPercent(280, 250)).toBe(10.71)
  })
  it('is zero at or above the package price or without a price', () => {
    expect(derivedDiscountPercent(120, 120)).toBe(0)
    expect(derivedDiscountPercent(120, 150)).toBe(0)
    expect(derivedDiscountPercent(0, 10)).toBe(0)
  })
})

describe('relativeTime and isCallDue', () => {
  const now = Date.parse('2026-10-28T10:00:00Z')
  it('speaks in the nearest unit', () => {
    expect(relativeTime('2026-10-28T13:00:00Z', now, 'en')).toBe('in 3 hours')
    expect(relativeTime('2026-10-26T10:00:00Z', now, 'en')).toBe('2 days ago')
    expect(relativeTime('2026-10-28T10:20:00Z', now, 'en')).toBe('in 20 minutes')
  })
  it('is due only for a pending opportunity whose time has passed', () => {
    expect(isCallDue({ status: 'pending', next_call_at: '2026-10-28T09:00:00Z' }, now)).toBe(true)
    expect(isCallDue({ status: 'pending', next_call_at: '2026-10-28T11:00:00Z' }, now)).toBe(false)
    expect(isCallDue({ status: 'won', next_call_at: '2026-10-28T09:00:00Z' }, now)).toBe(false)
    expect(isCallDue({ status: 'pending', next_call_at: null }, now)).toBe(false)
  })
})

describe('movableStages', () => {
  it('leaves out the sold stage and the archived ones: a sale goes through the sale action', () => {
    const stage = (id: number, extra: object = {}) => ({ id, name: `s${id}`, sequence: id, is_won: false, active: true, ...extra })
    expect(movableStages([stage(1), stage(2, { is_won: true }), stage(3, { active: false }), stage(4)]).map(item => item.id)).toEqual([1, 4])
  })
})

describe('formatPrice', () => {
  it('uses Latin digits, grouping and up to two decimals', () => {
    expect(formatPrice(1250)).toBe('1,250')
    expect(formatPrice(108.5)).toBe('108.5')
    expect(formatPrice(0)).toBe('0')
  })
})
