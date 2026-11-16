import { describe, expect, it } from 'vitest'
import { parseSalesReportQuery, salesReportActiveCount, salesReportBreakdownQuery, salesReportFilters, salesReportSummaryQuery } from '../salesReportParams'

describe('the sales report state of the address', () => {
  it('defaults to confirmed orders by month, with no range', () => {
    expect(parseSalesReportQuery({})).toEqual({ from: '', to: '', stage: 'confirmed', source: null, by: 'period', period: 'month', salesperson: null, customer: null, product: null, page: 1 })
  })

  it('reads every key and ignores what it does not know', () => {
    const state = parseSalesReportQuery({ from: '2026-01-01', to: '2026-03-31', state: 'quotations', source: 'online', by: 'product', period: 'week', salesperson: '7', customer: '3', product: '9', page: '2' })
    expect(state).toMatchObject({ from: '2026-01-01', to: '2026-03-31', stage: 'quotations', source: 'online', by: 'product', period: 'week', salesperson: 7, customer: 3, product: 9, page: 2 })
    expect(parseSalesReportQuery({ state: 'paid', source: 'fax', by: 'team', period: 'year', from: 'soon', salesperson: 'x', customer: '-1', page: '0' }))
      .toMatchObject({ stage: 'confirmed', source: null, by: 'period', period: 'month', from: '', salesperson: null, customer: null, page: 1 })
  })

  it('drops a reversed range instead of sending a request the server refuses', () => {
    expect(parseSalesReportQuery({ from: '2026-03-01', to: '2026-01-01' })).toMatchObject({ from: '', to: '' })
  })

  it('takes the first value of a repeated key', () => {
    expect(parseSalesReportQuery({ by: ['customer', 'product'] }).by).toBe('customer')
  })
})

describe('the report calls', () => {
  const state = parseSalesReportQuery({ from: '2026-01-01', source: 'staff', by: 'period', period: 'day', salesperson: '7', page: '3' })

  it('send the state as the wire states and the picked ids as the server names them', () => {
    expect(salesReportFilters(state)).toEqual({ state: 'confirmed', date_from: '2026-01-01', source: 'staff', salesperson_id: '7' })
    expect(salesReportFilters(parseSalesReportQuery({ state: 'quotations' })).state).toBe('draft,sent')
    expect(salesReportFilters(parseSalesReportQuery({ state: 'all' })).state).toBe('draft,sent,confirmed,cancelled')
  })

  it('keep the state out of the summary, which shows every group', () => {
    expect(salesReportSummaryQuery(state)).toEqual({ date_from: '2026-01-01', source: 'staff', salesperson_id: '7' })
  })

  it('page a breakdown and name the period only for the period dimension', () => {
    expect(salesReportBreakdownQuery(state)).toEqual({ state: 'confirmed', date_from: '2026-01-01', source: 'staff', salesperson_id: '7', by: 'period', period: 'day', limit: 25, offset: 50 })
    expect(salesReportBreakdownQuery(parseSalesReportQuery({ by: 'customer', period: 'day' }))).not.toHaveProperty('period')
  })

  it('count the filters beyond the defaults', () => {
    expect(salesReportActiveCount(parseSalesReportQuery({}))).toBe(0)
    expect(salesReportActiveCount(state)).toBe(3)
    expect(salesReportActiveCount(parseSalesReportQuery({ state: 'all', to: '2026-02-01', product: '4' }))).toBe(3)
  })
})
