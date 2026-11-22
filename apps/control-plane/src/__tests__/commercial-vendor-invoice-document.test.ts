import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { customerInvoiceExtrasSchema } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { getCustomerInvoice, issueInvoiceFromQuote } from '../commercial/invoices.js'
import { setBillingSettings } from '../commercial/billing-settings.js'
import { routesB } from '../commercial/routes-b.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const m = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const SELLER = { seller_legal_name_ar: 'شركة ليوان المحدودة', seller_legal_name_en: 'Liwan Co.', seller_commercial_registration: '1010000000', seller_address: 'Olaya St\nBuilding 4', seller_city: 'Riyadh', seller_country: 'Saudi Arabia', seller_email: 'billing@liwan.example', seller_phone: '+966110000000' }

suite('GET /invoices/:id/document: the vendor reads what the customer prints', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const call = async (path: string, capabilities: any[] = ['vendor.read', 'vendor.billing.manage']) => {
    const target = new URL(`/v1/commercial${path}`, 'http://liwan.test')
    return routesB(pool, { method: 'GET', pathname: target.pathname, raw: '', actor: 7, issuer: 'document-test', capabilities, stepUpFresh: true }, target)
  }
  async function seed(name = 'Buyer Co') {
    const customer = randomUUID(), sub = randomUUID(), order = randomUUID(), quote = randomUUID(), rid = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, name])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
    await pool.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [rid, sub, quote])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'d',10000,'SAR',2)`, [order, customer, sub, quote, rid, randomUUID()])
    const quoted: any = { effective_date: '2026-01-01', next_renewal_at: '2026-02-01', due_now: m(10000), next_renewal: m(10000),
      lines: [{ key: 'base', kind: 'base', timing: 'now', description: 'Base', quantity: 1, amount: m(10000), period_start: '2026-01-01', period_end: '2026-02-01', source_revision_id: rid }] }
    const client = await pool.connect()
    try {
      const invoice = (await issueInvoiceFromQuote(client, { order: { id: order, customer_id: customer, subscription_id: sub, kind: 'new' }, quote: quoted }))!
      return { invoice, customer }
    } finally { client.release() }
  }
  const settings = (fields: Record<string, unknown>) => setBillingSettings(pool, { operator: 'vendor:7', reason: 'seller identity test', ...fields } as any)
  const clear = () => pool.query("UPDATE billing_settings SET seller_legal_name_ar='',seller_legal_name_en='',seller_commercial_registration='',seller_address='',seller_city='',seller_country='',seller_email='',seller_phone='' WHERE singleton")

  beforeAll(async () => { await migrate(pool); await clear() })
  afterAll(async () => { await clear(); await pool.end() })

  it('returns exactly the shape the customer route returns, for any customer', async () => {
    await settings(SELLER)
    const { invoice, customer } = await seed('Buyer Legal Name')
    const read = (await call(`/invoices/${invoice.id}/document`))!
    expect(read.status).toBe(200)
    expect(read.data).toEqual(await getCustomerInvoice(pool, invoice.id, { customer_id: customer }))
    const doc = read.data as any
    expect(doc.customer_name).toBe('Buyer Legal Name')
    expect(customerInvoiceExtrasSchema.safeParse({ customer_name: doc.customer_name, seller: doc.seller, credit_notes: doc.credit_notes }).success).toBe(true)
  })

  it('shows the seller copied at issue, and the current identity for an invoice that has none', async () => {
    await settings(SELLER)
    const { invoice } = await seed()
    await settings({ seller_legal_name_en: 'Liwan Renamed', seller_city: 'Jeddah' })
    expect(((await call(`/invoices/${invoice.id}/document`))!.data as any).seller).toMatchObject({ legal_name_en: 'Liwan Co.', city: 'Riyadh' })
    await pool.query('ALTER TABLE invoices DISABLE TRIGGER invoice_guard')
    await pool.query('UPDATE invoices SET seller = NULL WHERE id = $1', [invoice.id])
    await pool.query('ALTER TABLE invoices ENABLE TRIGGER invoice_guard')
    expect(((await call(`/invoices/${invoice.id}/document`))!.data as any).seller).toMatchObject({ legal_name_en: 'Liwan Renamed', city: 'Jeddah' })
  })

  it('carries no operator text: no free-text reason, no operator name, no payment attempt', async () => {
    await settings(SELLER)
    const { invoice, customer } = await seed()
    await pool.query(
      `INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,origin,cause,created_by)
       VALUES($1,$2,$3,'credit_note','internal: customer called Ali',1000,'SAR',2,'pending','vendor','vendor_refund','operator-ali')`, [randomUUID(), invoice.id, customer])
    const doc = (await call(`/invoices/${invoice.id}/document`))!.data as any
    expect(doc.credit_notes).toHaveLength(1)
    expect(doc.credit_notes[0].cause).toBe('vendor_refund')
    expect(JSON.stringify(doc)).not.toMatch(/internal|Ali|operator|provider_ref|attempts|adjustments/i)
  })

  it('answers 403 without the billing grant and 404 for an unknown or malformed id', async () => {
    const { invoice } = await seed()
    await expect(call(`/invoices/${invoice.id}/document`, ['vendor.read'])).rejects.toMatchObject({ status: 403 })
    await expect(call(`/invoices/${randomUUID()}/document`)).rejects.toMatchObject({ status: 404 })
    await expect(call('/invoices/not-a-uuid/document')).rejects.toMatchObject({ status: 404 })
  })
})
