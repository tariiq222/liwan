import { beforeEach, describe, expect, it } from 'vitest'
import { SalesOrderListSchema, SalesOrderSchema, SalesSalespeopleSchema, SalesSettingsSchema } from '@liwan/contracts'
import { handleSales } from '../../../../e2e/sales-mock-routes.mjs'

// The sales mock answers the shapes of the contracts and follows the server's rules, so it cannot drift.
async function call(method: string, path: string, body?: object, cookie = ''): Promise<{ status: number; body: unknown }> {
  let answer: { status: number; body: unknown } | undefined
  const url = new URL(`http://mock.example.test${path}`)
  const handled = await handleSales(
    { method, headers: { cookie } },
    {},
    url.pathname,
    url,
    { json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload } }, readBody: async () => JSON.stringify(body ?? {}) },
  )
  expect(handled).toBe(true)
  return answer as { status: number; body: unknown }
}

describe('sales mock', () => {
  beforeEach(async () => { await call('POST', '/api/v1/__mock/reset-sales') })

  it('lists orders by stage, source, mine and search, in the contract shape', async () => {
    const all = SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders')).body)
    expect(all.total).toBe(4)
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=draft,sent')).body).items.map(item => item.id)).toEqual([1])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=confirmed')).body).items.map(item => item.id)).toEqual([2, 4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?state=cancelled,confirmed')).body).items.map(item => item.id)).toEqual([2, 3, 4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?source=online')).body).items.map(item => item.id)).toEqual([4])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?mine=true')).body).items.map(item => item.id)).toEqual([1, 3])
    expect(SalesOrderListSchema.parse((await call('GET', '/api/v1/sales/orders?q=النخيل')).body).items.map(item => item.id)).toEqual([1])
    expect((await call('GET', '/api/v1/sales/orders?state=sale')).body).toMatchObject({ code: 'invalid', field: 'state' })
    expect((await call('GET', '/api/v1/sales/orders?state=draft,sale')).body).toMatchObject({ code: 'invalid', field: 'state' })
  })

  it('reads an order with its actions, and an online order offers none of the writes', async () => {
    const draft = SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/1')).body)
    expect(draft.actions).toMatchObject({ edit: true, confirm: true, cancel: true, assign: true })
    expect(draft.lines.map(line => line.kind)).toEqual(['section', 'product', 'note'])
    const online = SalesOrderSchema.parse((await call('GET', '/api/v1/sales/orders/4')).body)
    expect(online).toMatchObject({ source: 'online', salesperson: null })
    expect(online.actions).toMatchObject({ edit: false, confirm: false, cancel: false, lock: false, unlock: false, assign: false })
    expect((await call('GET', '/api/v1/sales/orders/999')).status).toBe(404)
  })

  it('creates a quotation priced by the server, with the settings defaults', async () => {
    const created = await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 2 }, { kind: 'note', name: 'شكرًا' }] })
    expect(created.status).toBe(201)
    const order = SalesOrderSchema.parse(created.body)
    expect(order).toMatchObject({ state: 'draft', source: 'staff', amount_untaxed: 240, amount_tax: 36, amount_total: 276, terms: 'الأسعار شاملة التوصيل داخل المدينة.' })
    expect(order.validity_date).toBe('2026-12-14')
  })

  it('refuses what the server refuses', async () => {
    expect((await call('POST', '/api/v1/sales/orders', { lines: [] })).body).toMatchObject({ field: 'customer_id' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 0 }] })).body).toMatchObject({ field: 'lines.0.quantity' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 1, unit_price: 5 }] })).body).toMatchObject({ code: 'unknown_field', field: 'lines.0.unit_price' })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2, lines: [{ kind: 'product', product_id: 1, quantity: 1, discount_percent: 30 }] }, 'mock_sales=agent')).body)
      .toMatchObject({ code: 'forbidden', field: 'lines.0.discount_percent', details: { reason: 'discount_above_limit' } })
    expect((await call('POST', '/api/v1/sales/orders', { customer_id: 2 }, 'mock_caps=reader')).status).toBe(403)
  })

  it('moves documents through the state table and refuses any other move', async () => {
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/confirm')).body).state).toBe('confirmed')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/lock')).body).locked).toBe(true)
    expect((await call('POST', '/api/v1/sales/orders/1/cancel')).body).toMatchObject({ code: 'transition_forbidden' })
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/unlock')).body).locked).toBe(false)
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/cancel')).body).state).toBe('cancelled')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/reopen')).body).state).toBe('draft')
    expect((await call('POST', '/api/v1/sales/orders/4/cancel')).body).toMatchObject({ code: 'transition_forbidden' })
    expect((await call('PATCH', '/api/v1/sales/orders/2', { terms: 'x' })).body).toMatchObject({ code: 'transition_forbidden' })
  })

  it('edits a draft, assigns a salesperson and duplicates into a new draft', async () => {
    expect(SalesOrderSchema.parse((await call('PATCH', '/api/v1/sales/orders/1', { terms: 'جديد' })).body).terms).toBe('جديد')
    expect(SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/1/assign', { salesperson_id: 7 })).body).salesperson?.id).toBe(7)
    expect((await call('POST', '/api/v1/sales/orders/3/assign', { salesperson_id: 7 }, 'mock_sales=agent')).status).toBe(403)
    const copy = SalesOrderSchema.parse((await call('POST', '/api/v1/sales/orders/2/duplicate')).body)
    expect(copy).toMatchObject({ state: 'draft', source: 'staff' })
    expect(copy.id).not.toBe(2)
  })

  it('lists the salespeople to an assign holder only', async () => {
    expect(SalesSalespeopleSchema.parse((await call('GET', '/api/v1/sales/salespeople')).body).total).toBe(3)
    expect((await call('GET', '/api/v1/sales/salespeople', undefined, 'mock_sales=agent')).status).toBe(403)
  })

  it('keeps the settings revision and refuses a stale one or a branch manager', async () => {
    expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings')).body)).toMatchObject({ visibility: 'own', revision: 1, can_manage: true })
    expect(SalesSettingsSchema.parse((await call('GET', '/api/v1/sales/settings', undefined, 'mock_sales=branch')).body).can_manage).toBe(false)
    expect((await call('PATCH', '/api/v1/sales/settings', { visibility: 'all', revision: 9 })).body).toMatchObject({ code: 'conflict' })
    expect((await call('PATCH', '/api/v1/sales/settings', { discount_limit_percent: 12.5, revision: 1 })).body).toMatchObject({ field: 'discount_limit_percent' })
    expect(SalesSettingsSchema.parse((await call('PATCH', '/api/v1/sales/settings', { visibility: 'all', revision: 1 })).body).revision).toBe(2)
    expect((await call('PATCH', '/api/v1/sales/settings', { visibility: 'own', revision: 2 }, 'mock_sales=branch')).status).toBe(403)
  })
})
