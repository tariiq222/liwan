import { beforeEach, describe, expect, it } from 'vitest'
import { SALES_REPORT_EXPORT_COLUMNS, SalesOrderListSchema, SalesReportBreakdownSchema, SalesReportSummarySchema } from '@liwan/contracts'
import { handlePublicSales, handleSales } from '../../../../e2e/sales-mock-routes.mjs'

// The reports mock answers the shapes of the contracts and adds up the same documents the list shows, so it cannot drift.
async function call(path: string, cookie = ''): Promise<{ status: number; body: unknown; text: string }> {
  let answer = { status: 0, body: undefined as unknown, text: '' }
  const url = new URL(`http://mock.example.test${path}`)
  const handled = await handleSales(
    { method: 'GET', headers: { cookie } },
    { writeHead: (status: number) => { answer.status = status }, end: (text: string) => { answer.text = text } },
    url.pathname,
    url,
    { json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload, text: '' } }, readBody: async () => '{}' },
  )
  expect(handled).toBe(true)
  return answer
}
const SUMMARY = '/api/v1/sales/reports/summary'
const BREAKDOWN = '/api/v1/sales/reports/breakdown'
const EXPORT = '/api/v1/sales/reports/export'

describe('sales reports mock', () => {
  beforeEach(async () => {
    await handlePublicSales({ method: 'POST', headers: {} }, { writeHead: () => {}, end: () => {} }, '/api/v1/public/sales/__mock/reset', new URL('http://mock.example.test/api/v1/public/sales/__mock/reset'), { json: () => {}, readBody: async () => '{}' })
  })

  it('adds up what the list shows: confirmed, open and cancelled documents', async () => {
    const summary = SalesReportSummarySchema.parse((await call(SUMMARY)).body)
    const list = SalesOrderListSchema.parse((await call('/api/v1/sales/orders?limit=200')).body)
    const total = (states: string[]) => Math.round(list.items.filter(item => states.includes(item.state)).reduce((sum, item) => sum + item.amount_total, 0) * 100) / 100
    expect(summary.confirmed.orders).toBe(list.items.filter(item => item.state === 'confirmed').length)
    expect(summary.confirmed.amount_total).toBe(total(['confirmed']))
    expect(summary.quotations).toMatchObject({ orders: list.items.filter(item => ['draft', 'sent'].includes(item.state)).length, amount_total: total(['draft', 'sent']) })
    expect(summary.cancelled.amount_total).toBe(total(['cancelled']))
  })

  it('groups by every dimension and counts confirmed orders unless the state says otherwise', async () => {
    const byPeriod = SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=period`)).body)
    expect(byPeriod).toMatchObject({ by: 'period', period: 'month', total: 1 })
    expect(byPeriod.items[0]).toMatchObject({ key: '2026-11-01', quantity: null })
    const bySalesperson = SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=salesperson`)).body)
    expect(bySalesperson.items.map(item => item.key).sort()).toEqual([null, 7].sort())
    expect(bySalesperson.items.find(item => item.key === null)).toMatchObject({ label: null, orders: 1 })
    const byProduct = SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=product`)).body)
    expect(byProduct.items.every(item => typeof item.quantity === 'number')).toBe(true)
    const all = SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=customer&state=draft,sent,confirmed,cancelled`)).body)
    expect(all.total).toBeGreaterThan(SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=customer`)).body).total)
  })

  it('pages the groups and narrows them by the filters', async () => {
    const page = SalesReportBreakdownSchema.parse((await call(`${BREAKDOWN}?by=customer&state=draft,sent,confirmed,cancelled&limit=1&offset=1`)).body)
    expect(page.items).toHaveLength(1)
    expect(page.total).toBeGreaterThan(1)
    const online = SalesReportSummarySchema.parse((await call(`${SUMMARY}?source=online`)).body)
    expect(online.confirmed.orders).toBe(1)
    expect(SalesReportSummarySchema.parse((await call(`${SUMMARY}?date_from=2027-01-01`)).body).confirmed.orders).toBe(0)
  })

  it('refuses a bad filter with a 422 on its field', async () => {
    for (const [query, field] of [['?date_from=soon', 'date_from'], ['?date_from=2026-12-01&date_to=2026-01-01', 'date_from'], ['?customer_id=0', 'customer_id'], ['?state=paid', 'state'], ['?source=fax', 'source']] as const) {
      expect((await call(`${SUMMARY}${query}`)).body).toMatchObject({ code: 'invalid', field })
    }
    expect((await call(BREAKDOWN)).body).toMatchObject({ code: 'invalid', field: 'by' })
    expect((await call(`${BREAKDOWN}?by=period&period=year`)).body).toMatchObject({ code: 'invalid', field: 'period' })
  })

  it('needs the reports capability, which a read-only session keeps and an agent does not hold', async () => {
    for (const path of [SUMMARY, `${BREAKDOWN}?by=period`, EXPORT]) {
      expect((await call(path, 'mock_caps=reader')).status).toBe(200)
      expect((await call(path, 'mock_sales=agent')).status).toBe(403)
    }
  })

  it('exports the rows behind the filters as CSV with the contract header', async () => {
    const answer = await call(EXPORT)
    expect(answer.status).toBe(200)
    const [header, ...rows] = answer.text.replace(/^﻿/, '').trim().split('\n')
    expect(header!.split(',')).toEqual([...SALES_REPORT_EXPORT_COLUMNS])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.includes(',confirmed,'))).toBe(true)
  })
})
