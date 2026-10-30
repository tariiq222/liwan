import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { url } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { routesB } from '../commercial/routes-b.js'

const suite = url ? describe : describe.skip
suite('vendor invoice list and detail', () => {
  const pool = new Pool({ connectionString: url })
  const tag = randomUUID().slice(0, 8)
  const [a, b] = [randomUUID(), randomUUID()]
  const caps: any[] = ['vendor.read', 'vendor.billing.manage']
  const call = async (path: string, capabilities = caps) => {
    const target = new URL(`/v1/commercial${path}`, 'http://liwan.test')
    return routesB(pool, { method: 'GET', pathname: target.pathname, raw: '', actor: 7, issuer: 'invoice-test', capabilities, stepUpFresh: true }, target)
  }
  const invoice = (customer: string, subscription: string, status: string, total: number, due: string | null) => pool.query(
    `INSERT INTO invoices(id,customer_id,subscription_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
     VALUES($1,$2,$3,'renewal',$4,'SAR',2,$5,0,$5,'2026-01-01','2026-02-01',$6)`, [randomUUID(), customer, subscription, status, total, due])
  beforeAll(async () => {
    await migrate(pool)
    const subs = [randomUUID(), randomUUID()]
    for (const [i, c] of [a, b].entries()) {
      await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [c, `Invoice ${tag} ${i}`])
      await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subs[i], c])
    }
    await invoice(a, subs[0]!, 'issued', 1000, '2020-01-01T00:00:00Z')
    await invoice(a, subs[0]!, 'issued', 500, '2999-01-01T00:00:00Z')
    await invoice(a, subs[0]!, 'paid', 700, null)
    await invoice(b, subs[1]!, 'issued', 300, '2020-01-01T00:00:00Z')
  })
  afterAll(async () => pool.end())

  it('carries the customer name and a server-side summary scoped to the customer', async () => {
    const r = (await call(`/invoices?customer_id=${a}`))!.data as any
    expect(r.total).toBe(3)
    expect(r.items.every((i: any) => i.customer_name === `Invoice ${tag} 0`)).toBe(true)
    expect(r.summary).toEqual({ outstanding: [{ currency: 'SAR', exponent: 2, minor: 1500 }] })
  })
  it('filters by status and pages in SQL while the summary ignores the status filter', async () => {
    const r = (await call(`/invoices?customer_id=${a}&status=paid&limit=1`))!.data as any
    expect(r.total).toBe(1)
    expect(r.items).toHaveLength(1)
    expect(r.summary.outstanding).toEqual([{ currency: 'SAR', exponent: 2, minor: 1500 }])
    expect(((await call(`/invoices?customer_id=${a}&limit=2&offset=2`))!.data as any).items).toHaveLength(1)
  })
  it('returns the name on detail and rejects bad filters and missing capability', async () => {
    const id = (await pool.query('SELECT id FROM invoices WHERE customer_id=$1 LIMIT 1', [b])).rows[0].id
    expect(((await call(`/invoices/${id}`))!.data as any).customer_name).toBe(`Invoice ${tag} 1`)
    for (const q of ['status=bogus', 'limit=0', 'limit=201', 'offset=-1', 'customer_id=x'])
      await expect(call(`/invoices?${q}`)).rejects.toMatchObject({ status: 422 })
    await expect(call('/invoices', ['vendor.read'])).rejects.toMatchObject({ status: 403 })
  })
})
