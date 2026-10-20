import { describe, expect, it } from 'vitest'
import { LEDGER_PAGE_SIZE, reportActiveFilterCount, reportFiltersFromQuery, reportParams, reportReady } from '../reportParams'

const TODAY = '2026-10-20'
const filters = (query: Record<string, unknown> = {}) => reportFiltersFromQuery(query, TODAY)

describe('report filters from the URL', () => {
  it('defaults the period to this month up to today and the options to the server defaults', () => {
    expect(filters()).toEqual({ dateFrom: '2026-10-01', dateTo: TODAY, targetMove: 'posted', kind: 'receivable', type: 'activity', partnerId: null, accountId: null, planId: null, page: 1 })
  })

  it('reads every supported filter', () => {
    expect(filters({ date_from: '2026-01-01', date_to: '2026-03-31', target_move: 'all', kind: 'payable', type: 'outstanding', partner_id: '7', account_id: '3', plan_id: '5', page: '2' }))
      .toEqual({ dateFrom: '2026-01-01', dateTo: '2026-03-31', targetMove: 'all', kind: 'payable', type: 'outstanding', partnerId: 7, accountId: 3, planId: 5, page: 2 })
  })

  it('drops what the API would refuse and never lets the period run backwards', () => {
    expect(filters({ target_move: 'draft', kind: 'x', type: 'y', partner_id: '-1', account_id: 'a', plan_id: '0', page: '0', date_from: 'soon' }))
      .toMatchObject({ dateFrom: '2026-10-01', targetMove: 'posted', kind: 'receivable', type: 'activity', partnerId: null, accountId: null, planId: null, page: 1 })
    expect(filters({ date_to: '2026-09-10' })).toMatchObject({ dateFrom: '2026-09-10', dateTo: '2026-09-10' })
    expect(filters({ date_from: '2026-11-01', date_to: '2026-10-01' })).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-01' })
  })
})

describe('report params', () => {
  it('sends the period and the posting filter of a trial balance', () => {
    expect(reportParams('trial-balance', filters({ target_move: 'all' }))).toEqual({ date_from: '2026-10-01', date_to: TODAY, target_move: 'all' })
  })

  it('sends only date_to for balances as of a day', () => {
    expect(reportParams('aged-partner-balance', filters({ kind: 'payable' }))).toEqual({ date_to: TODAY, target_move: 'posted', kind: 'payable' })
  })

  it('sends the period and nothing else for the tax reports', () => {
    expect(reportParams('vat', filters({ kind: 'payable', target_move: 'all' }))).toEqual({ date_from: '2026-10-01', date_to: TODAY })
    expect(reportParams('withholding', filters())).toEqual({ date_from: '2026-10-01', date_to: TODAY })
  })

  it('pages the ledger lines only once an account is named', () => {
    expect(reportParams('general-ledger', filters())).toEqual({ date_from: '2026-10-01', date_to: TODAY, target_move: 'posted' })
    expect(reportParams('general-ledger', filters({ account_id: '4', page: '3' })))
      .toEqual({ date_from: '2026-10-01', date_to: TODAY, target_move: 'posted', account_id: 4, limit: LEDGER_PAGE_SIZE, offset: 2 * LEDGER_PAGE_SIZE })
  })

  it('sends the period and the plan of the cost center report, never the open cost center', () => {
    expect(reportParams('analytic', filters())).toEqual({ date_from: '2026-10-01', date_to: TODAY })
    expect(reportParams('analytic', filters({ plan_id: '4', account_id: '9', page: '2', target_move: 'all' }))).toEqual({ date_from: '2026-10-01', date_to: TODAY, plan_id: 4 })
  })

  it('asks for an activity statement with its period and an outstanding one with date_to alone', () => {
    expect(reportParams('partner-statement', filters({ partner_id: '9' }))).toEqual({ date_from: '2026-10-01', date_to: TODAY, kind: 'receivable', type: 'activity', partner_id: 9 })
    expect(reportParams('partner-statement', filters({ partner_id: '9', type: 'outstanding', kind: 'payable' }))).toEqual({ date_to: TODAY, kind: 'payable', type: 'outstanding', partner_id: 9 })
  })
})

describe('report readiness and active filters', () => {
  it('needs a partner for the statement only', () => {
    expect(reportReady('partner-statement', filters())).toBe(false)
    expect(reportReady('partner-statement', filters({ partner_id: '2' }))).toBe(true)
    expect(reportReady('trial-balance', filters())).toBe(true)
  })

  it('counts the filters changed from their defaults that the report takes', () => {
    expect(reportActiveFilterCount('trial-balance', filters(), TODAY)).toBe(0)
    expect(reportActiveFilterCount('trial-balance', filters({ date_from: '2026-10-05', target_move: 'all', kind: 'payable' }), TODAY)).toBe(2)
    expect(reportActiveFilterCount('aged-partner-balance', filters({ date_from: '2026-10-05', date_to: '2026-10-10' }), TODAY)).toBe(1)
    expect(reportActiveFilterCount('partner-statement', filters({ partner_id: '2', type: 'outstanding', kind: 'payable' }), TODAY)).toBe(3)
    expect(reportActiveFilterCount('vat', filters({ target_move: 'all' }), TODAY)).toBe(0)
    expect(reportActiveFilterCount('analytic', filters({ plan_id: '3', account_id: '9' }), TODAY)).toBe(1)
  })
})
