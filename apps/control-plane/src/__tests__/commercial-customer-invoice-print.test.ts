import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { customerInvoiceExtrasSchema } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { getCustomerInvoice, issueInvoiceFromQuote } from '../commercial/invoices.js'
import { setBillingSettings } from '../commercial/billing-settings.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const m = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const SELLER = { seller_legal_name_ar: 'شركة ليوان المحدودة', seller_legal_name_en: 'Liwan Co.', seller_commercial_registration: '1010000000', seller_address: 'Olaya St\nBuilding 4', seller_city: 'Riyadh', seller_country: 'Saudi Arabia', seller_email: 'billing@liwan.example', seller_phone: '+966110000000' }

suite('customer invoice for printing: seller, buyer and credit notes', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  async function seed(name = 'Buyer Co') {
    const customer = randomUUID(), sub = randomUUID(), order = randomUUID(), quote = randomUUID(), rid = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, name])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer])
    await pool.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [rid, sub, quote])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'d',10000,'SAR',2)`, [order, customer, sub, quote, rid, randomUUID()])
    return { order: { id: order, customer_id: customer, subscription_id: sub, kind: 'new' }, rid }
  }
  const quote = (rid: string): any => ({ effective_date: '2026-01-01', next_renewal_at: '2026-02-01', due_now: m(10000), next_renewal: m(10000),
    lines: [{ key: 'base', kind: 'base', timing: 'now', description: 'Base', quantity: 1, amount: m(10000), period_start: '2026-01-01', period_end: '2026-02-01', source_revision_id: rid }] })
  async function issue(a: Awaited<ReturnType<typeof seed>>) {
    const client = await pool.connect()
    try { return (await issueInvoiceFromQuote(client, { order: a.order, quote: quote(a.rid) }))! } finally { client.release() }
  }
  const settings = (fields: Record<string, unknown>) => setBillingSettings(pool, { operator: 'vendor:7', reason: 'seller identity test', ...fields } as any)
  const clear = () => pool.query("UPDATE billing_settings SET seller_legal_name_ar='',seller_legal_name_en='',seller_commercial_registration='',seller_address='',seller_city='',seller_country='',seller_email='',seller_phone='' WHERE singleton")
  const note = (invoice: string, customer: string, fields: Record<string, unknown> = {}) => pool.query(
    `INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,origin,cause,created_by,refund_reference,refunded_at,refunded_by)
     VALUES($1,$2,$3,$4,$5,$6,'SAR',2,$7,'vendor','vendor_refund','operator-ali',$8,$9,$10)`,
    [randomUUID(), invoice, customer, fields.kind ?? 'credit_note', fields.reason ?? 'internal: customer called Ali', fields.amount ?? 10000, fields.status ?? 'pending', fields.ref ?? null, fields.refunded_at ?? null, fields.status === 'refunded' ? 'operator-bob' : null])

  beforeAll(async () => { await migrate(pool); await clear() })
  afterAll(async () => { await clear(); await pool.end() })

  it('returns the buyer legal name and the seller identity, and the shape parses', async () => {
    await settings(SELLER)
    const a = await seed('Buyer Legal Name')
    const invoice = await issue(a)
    const read = (await getCustomerInvoice(pool, invoice.id, { customer_id: a.order.customer_id }))!
    expect(read.customer_name).toBe('Buyer Legal Name')
    expect(read.seller).toEqual({ legal_name_ar: SELLER.seller_legal_name_ar, legal_name_en: SELLER.seller_legal_name_en, commercial_registration: '1010000000',
      address: 'Olaya St\nBuilding 4', city: 'Riyadh', country: 'Saudi Arabia', email: 'billing@liwan.example', phone: '+966110000000' })
    expect(JSON.stringify(read)).not.toMatch(/vat_number|tax_number/i)
    expect(customerInvoiceExtrasSchema.safeParse({ customer_name: read.customer_name, seller: read.seller, credit_notes: read.credit_notes }).success).toBe(true)
  })

  it('snapshots the seller when the invoice is issued, so a later settings change does not rewrite it', async () => {
    await settings(SELLER)
    const a = await seed()
    const invoice = await issue(a)
    await settings({ seller_legal_name_en: 'Liwan Renamed', seller_city: 'Jeddah' })
    const read = (await getCustomerInvoice(pool, invoice.id, { customer_id: a.order.customer_id }))!
    expect(read.seller).toMatchObject({ legal_name_en: 'Liwan Co.', city: 'Riyadh' })
    const later = await issue(await seed())
    expect((await getCustomerInvoice(pool, later.id, { customer_id: later.customer_id }))!.seller).toMatchObject({ legal_name_en: 'Liwan Renamed', city: 'Jeddah' })
    await expect(pool.query("UPDATE invoices SET seller='{}'::jsonb WHERE id=$1", [invoice.id])).rejects.toThrow(/invoice_immutable/)
  })

  it('shows the current identity for an invoice with no snapshot and none when no legal name was ever set', async () => {
    await settings(SELLER)
    const a = await seed()
    const old = await issue(a)
    await pool.query('ALTER TABLE invoices DISABLE TRIGGER invoice_guard')
    await pool.query('UPDATE invoices SET seller=NULL WHERE id=$1', [old.id])
    await pool.query('ALTER TABLE invoices ENABLE TRIGGER invoice_guard')
    await settings({ seller_city: 'Dammam' })
    expect((await getCustomerInvoice(pool, old.id, { customer_id: a.order.customer_id }))!.seller).toMatchObject({ city: 'Dammam' })
    await clear()
    const b = await seed()
    const bare = await issue(b)
    expect((await getCustomerInvoice(pool, bare.id, { customer_id: b.order.customer_id }))!.seller).toBeNull()
  })

  it('returns only non-void credit notes with a typed cause and no operator names or free text', async () => {
    const a = await seed()
    const invoice = await issue(a)
    const customer = a.order.customer_id
    await note(invoice.id, customer, { status: 'refunded', ref: 'BANK-REF-77', refunded_at: '2026-01-05T10:00:00Z' })
    await note(invoice.id, customer, { status: 'void', amount: 500 })
    await note(invoice.id, customer, { kind: 'debit_note', amount: 700 })
    const read = (await getCustomerInvoice(pool, invoice.id, { customer_id: customer }))!
    expect(read.credit_notes).toHaveLength(1)
    expect(read.credit_notes[0]).toMatchObject({ amount: m(10000), cause: 'vendor_refund', status: 'refunded', refund_reference: 'BANK-REF-77', refunded_at: '2026-01-05T10:00:00.000Z' })
    const wire = JSON.stringify(read)
    expect(wire).not.toContain('operator-ali')
    expect(wire).not.toContain('operator-bob')
    expect(wire).not.toContain('customer called Ali')
  })

  it('answers null for another customer\'s invoice and an unknown id', async () => {
    const a = await seed(), b = await seed()
    const invoice = await issue(a)
    expect(await getCustomerInvoice(pool, invoice.id, { customer_id: b.order.customer_id })).toBeNull()
    expect(await getCustomerInvoice(pool, randomUUID(), { customer_id: a.order.customer_id })).toBeNull()
  })

  it('audits a seller identity change with its reason and before/after, and rejects a bad email', async () => {
    await clear()
    const operator = `vendor:${randomUUID().slice(0, 6)}`
    await setBillingSettings(pool, { operator, reason: 'first seller identity', ...SELLER })
    const event = (await pool.query("SELECT reason, metadata FROM audit_events WHERE action='billing.settings_updated' AND actor=$1", [operator])).rows[0]
    expect(event.reason).toBe('first seller identity')
    expect(event.metadata.before.seller_legal_name_en).toBe('')
    expect(event.metadata.after.seller_legal_name_en).toBe('Liwan Co.')
    await expect(settings({ seller_email: 'not-an-email' })).rejects.toThrow()
  })
})
