import { describe, expect, it } from 'vitest'
import { canWritePlan, mustChooseParent } from '../analyticAccess'
import { ANALYTIC_LINE_PAGE_SIZE, ANALYTIC_PAGE_SIZE, analyticAccountParams, analyticActiveFilterCount, analyticFiltersFromQuery, analyticLineParams } from '../analyticParams'

describe('cost center filters from the URL', () => {
  it('defaults to the active cost centers on the first page', () => {
    expect(analyticFiltersFromQuery({})).toEqual({ q: '', planId: null, archived: false, page: 1 })
  })

  it('reads every supported filter and drops what the API would refuse', () => {
    expect(analyticFiltersFromQuery({ q: ' مشروع ', plan_id: '4', archived: 'true', page: '3' })).toEqual({ q: 'مشروع', planId: 4, archived: true, page: 3 })
    expect(analyticFiltersFromQuery({ plan_id: '-1', archived: 'yes', page: '0' })).toEqual({ q: '', planId: null, archived: false, page: 1 })
  })

  it('counts the filters applied', () => {
    expect(analyticActiveFilterCount(analyticFiltersFromQuery({}))).toBe(0)
    expect(analyticActiveFilterCount(analyticFiltersFromQuery({ q: 'x', plan_id: '2', archived: 'true' }))).toBe(3)
  })
})

describe('cost center params', () => {
  it('always names the archived state and pages from the page number', () => {
    expect(analyticAccountParams(analyticFiltersFromQuery({}))).toEqual({ archived: 'false', limit: ANALYTIC_PAGE_SIZE, offset: 0 })
    expect(analyticAccountParams(analyticFiltersFromQuery({ q: 'a', plan_id: '2', archived: 'true', page: '2' })))
      .toEqual({ q: 'a', plan_id: 2, archived: 'true', limit: ANALYTIC_PAGE_SIZE, offset: ANALYTIC_PAGE_SIZE })
  })

  it('pages the items of one cost center in the report period', () => {
    expect(analyticLineParams(5, { dateFrom: '2026-10-01', dateTo: '2026-10-20' }, 3))
      .toEqual({ account_id: 5, date_from: '2026-10-01', date_to: '2026-10-20', limit: ANALYTIC_LINE_PAGE_SIZE, offset: 2 * ANALYTIC_LINE_PAGE_SIZE })
  })
})

describe('plan write access', () => {
  const can = (...granted: string[]) => (capability: string) => granted.includes(capability)

  it('needs the manage capability for every plan and the setup capability for a root plan', () => {
    expect(canWritePlan(can(), false)).toBe(false)
    expect(canWritePlan(can('finance.analytic.manage'), false)).toBe(true)
    expect(canWritePlan(can('finance.analytic.manage'), true)).toBe(false)
    expect(canWritePlan(can('finance.analytic.manage', 'finance.setup.manage'), true)).toBe(true)
    expect(canWritePlan(can('finance.setup.manage'), true)).toBe(false)
  })

  it('requires a parent for a new plan without the setup capability', () => {
    expect(mustChooseParent(can('finance.analytic.manage'))).toBe(true)
    expect(mustChooseParent(can('finance.analytic.manage', 'finance.setup.manage'))).toBe(false)
  })
})
