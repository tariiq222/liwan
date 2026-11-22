import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('POST /invoices/export: the audit event of an invoice export', () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  const call = async (body: unknown, capabilities: any[] = ['vendor.read', 'vendor.billing.manage']) => {
    const target = new URL('/v1/commercial/invoices/export', 'http://liwan.test')
    return routesB(pool, { method: 'POST', pathname: target.pathname, raw: typeof body === 'string' ? body : JSON.stringify(body), actor: 7, issuer: 'export-test', capabilities, stepUpFresh: false }, target)
  }
  const events = async (customer: string) => (await pool.query("SELECT * FROM audit_events WHERE action = 'invoices.exported' AND metadata->>'customer_id' = $1", [customer])).rows
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => pool.end())

  it('writes one invoices.exported event with the actor, the filters and the row count', async () => {
    const customer = randomUUID()
    const answer = await call({ customer_id: customer, status: 'issued', row_count: 260 })
    expect(answer).toMatchObject({ status: 201 })
    const rows = await events(customer)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'invoices.exported', actor: 'account:7' })
    expect(rows[0].metadata).toEqual({ customer_id: customer, status: 'issued', row_count: 260 })
    expect(String(rows[0].reason)).toMatch(/\S/)
  })

  it('writes the export of an unfiltered list with no customer and no status', async () => {
    const before = Number((await pool.query("SELECT count(*) FROM audit_events WHERE action = 'invoices.exported'")).rows[0].count)
    await call({ row_count: 0 })
    expect(Number((await pool.query("SELECT count(*) FROM audit_events WHERE action = 'invoices.exported'")).rows[0].count)).toBe(before + 1)
    expect((await pool.query("SELECT metadata FROM audit_events WHERE action = 'invoices.exported' ORDER BY created_at DESC LIMIT 1")).rows[0].metadata).toEqual({ row_count: 0 })
  })

  it('needs the billing grant but no fresh step-up: the call changes nothing', async () => {
    await expect(call({ row_count: 1 }, ['vendor.read'])).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(await call({ row_count: 1 })).toMatchObject({ status: 201 })
  })

  it('refuses without the billing grant and writes nothing', async () => {
    const customer = randomUUID()
    await expect(call({ customer_id: customer, row_count: 1 }, ['vendor.read'])).rejects.toMatchObject({ status: 403 })
    expect(await events(customer)).toHaveLength(0)
  })

  it.each([
    ['a negative count', { row_count: -1 }],
    ['more rows than one export holds', { row_count: 5001 }],
    ['a fractional count', { row_count: 1.5 }],
    ['no count', {}],
    ['an unknown status', { status: 'bogus', row_count: 1 }],
    ['a customer that is not an id', { customer_id: 'x', row_count: 1 }],
    ['a key nobody defined', { row_count: 1, reason: 'free text' }],
  ])('refuses %s with 422 and writes nothing', async (_name, body) => {
    const before = Number((await pool.query("SELECT count(*) FROM audit_events WHERE action = 'invoices.exported'")).rows[0].count)
    await expect(call(body)).rejects.toMatchObject({ status: 422 })
    expect(Number((await pool.query("SELECT count(*) FROM audit_events WHERE action = 'invoices.exported'")).rows[0].count)).toBe(before)
  })
})
