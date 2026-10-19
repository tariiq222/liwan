import { describe, expect, it } from 'vitest'
import { FINANCE_PARTNER_PAGE_SIZE, parsePartnerListQuery, partnerKinds, partnerListQuery } from '../financePartnerParams'
import { financePartnerQuery } from '../useFinancePartners'

describe('partner list URL state', () => {
  it('reads the filters from the query and falls back for anything unknown', () => {
    expect(parsePartnerListQuery({})).toEqual({ q: '', kind: null, archived: false, offset: 0 })
    expect(parsePartnerListQuery({ q: '  النخبة ', kind: 'vendor', archived: '1', offset: '50' })).toEqual({ q: 'النخبة', kind: 'vendor', archived: true, offset: 50 })
    expect(parsePartnerListQuery({ kind: 'supplier', archived: 'true', offset: '-5' })).toEqual({ q: '', kind: null, archived: false, offset: 0 })
    expect(parsePartnerListQuery({ kind: ['customer', 'vendor'], offset: ['25'] })).toMatchObject({ kind: 'customer', offset: 25 })
    expect(parsePartnerListQuery({ offset: 'abc' }).offset).toBe(0)
  })

  it('writes a clean URL for the default list and keeps every active filter', () => {
    expect(partnerListQuery({ q: '', kind: null, archived: false, offset: 0 })).toEqual({ q: undefined, kind: undefined, archived: undefined, offset: undefined })
    expect(partnerListQuery({ q: 'x', kind: 'customer', archived: true, offset: 25 })).toEqual({ q: 'x', kind: 'customer', archived: '1', offset: '25' })
  })

  it('round-trips through the parser', () => {
    const state = { q: 'x', kind: 'vendor' as const, archived: true, offset: 75 }
    expect(parsePartnerListQuery(partnerListQuery(state) as Record<string, string>)).toEqual(state)
  })

  it('names the kinds of a partner, both when it is a customer and a vendor', () => {
    expect(partnerKinds({ customer: true, vendor: false })).toEqual(['customer'])
    expect(partnerKinds({ customer: true, vendor: true })).toEqual(['customer', 'vendor'])
    expect(partnerKinds({ customer: false, vendor: false })).toEqual([])
  })

  it('asks the server with the contract query: archived as the string the route accepts, one page of rows', () => {
    expect(financePartnerQuery({})).toEqual({ q: undefined, kind: undefined, archived: undefined, limit: FINANCE_PARTNER_PAGE_SIZE, offset: 0 })
    expect(financePartnerQuery({ q: 'x', kind: 'vendor', archived: true, limit: 1, offset: 25 })).toEqual({ q: 'x', kind: 'vendor', archived: 'true', limit: 1, offset: 25 })
  })
})
